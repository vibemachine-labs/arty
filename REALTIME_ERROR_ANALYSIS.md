# OpenAI Realtime API Error Analysis

## Error 1: `invalid_tool_call_id`

**Error Message:**
```
Tool call ID 'call_AlUXNlVIRpcZtphj' not found in conversation.
```

### Root Cause Hypothesis

**Race Condition in Tool Response Flow:**

The tool call lifecycle is:
1. OpenAI sends `response.function_call_arguments.done` with a `call_id`
2. Swift side dispatches tool execution (async)
3. Tool executes (may take time - especially MCP tools)
4. Tool response is sent via `conversation.item.create` with the `call_id`
5. Swift sends `response.create` to continue conversation

**The Problem:**
Between step 1 and step 4, OpenAI may have:
- Pruned old conversation items due to `maxConversationTurns` limit
- Deleted the original function call item from the conversation
- The `call_id` reference is now orphaned

**Evidence:**
- The error occurs AFTER turn limit pruning (based on the conversation management code in WebRTCEventHandler.swift:783-898)
- When pruning happens, we delete conversation items including function calls
- But the tool is still executing asynchronously
- When the tool finishes and tries to send its output, the `call_id` no longer exists in OpenAI's conversation

### Code Flow Analysis

**Location: OpenAIWebRTCClient.swift:595-629**
```swift
func sendToolCallResult(callId: String, result: String) {
    let outputDict: [String: Any] = [
      "type": "conversation.item.create",
      "item": [
        "type": "function_call_output",
        "call_id": callId,  // ← This call_id may be stale!
        "output": result
      ]
    ]

    let didSend = sendEvent(outputDict)  // ← Sends conversation.item.create

    if didSend {
      sendEvent(["type": "response.create"])  // ← Then triggers response.create
    }
}
```

**Location: WebRTCEventHandler.swift:783-898**
- `pruneOldestConversationItems()` deletes conversation items to enforce turn limits
- This includes function_call items with their `call_id`s
- But there's NO tracking of pending/in-flight tool executions

**Problem:** No coordination between:
1. Conversation item deletion (pruning)
2. In-flight tool executions that will reference deleted `call_id`s

---

## Error 2: `conversation_already_has_active_response`

**Error Message:**
```
Conversation already has an active response in progress: resp_Ccy0kXATLT1auevL8PTjd.
Wait until the response is finished before creating a new one.
```

### Root Cause Hypothesis

**Multiple `response.create` Calls Without Proper Sequencing:**

**Location: OpenAIWebRTCClient.swift:595-644**

Both `sendToolCallResult()` and `sendToolCallError()` send `response.create`:

```swift
func sendToolCallResult(callId: String, result: String) {
    // ... sends conversation.item.create
    sendEvent(["type": "response.create"])  // ← Creates response
}

func sendToolCallError(callId: String, error: String) {
    // ... sends conversation.item.create
    sendEvent(["type": "response.create"])  // ← Also creates response
}
```

**The Problem:**
If multiple tools complete in rapid succession (or even the same tool is called multiple times):
1. Tool A completes → sends `response.create`
2. Response A starts (resp_Ccy0kXATLT1auevL8PTjd)
3. Tool B completes → tries to send `response.create`
4. **ERROR**: Response A is still active!

**Compounding Factor:**
- No response state tracking in Swift code
- No queue for pending tool outputs
- No check for "is response already active?"

**Related Issue:**
Looking at the error trace, both errors happen ~130ms apart:
```
[18:13:02.496Z] invalid_tool_call_id
[18:13:02.628Z] conversation_already_has_active_response
```

This suggests:
1. First tool tried to send result with invalid call_id → failed silently?
2. Second tool completed shortly after
3. But a response was still active from another source

---

## Cascading Failure Scenario

**Most Likely Sequence:**

```
T+0ms:   LLM calls multiple tools (Tool A, Tool B)
T+100ms: maxConversationTurns exceeded → pruning starts
T+150ms: Pruning deletes conversation items including Tool A's call_id
T+200ms: Tool A completes execution
T+201ms: sendToolCallResult() for Tool A
         → conversation.item.create with deleted call_id
         → ERROR: invalid_tool_call_id
         → BUT: response.create is sent anyway (no error handling!)
T+202ms: Response A starts (resp_Ccy0kXATLT1auevL8PTjd)
T+330ms: Tool B completes
T+331ms: sendToolCallResult() for Tool B
         → tries to send response.create
         → ERROR: conversation_already_has_active_response (from Tool A's response)
```

---

## High-Level Fix Proposals

### Fix 1: Track Pending Tool Executions

**Location: WebRTCEventHandler.swift**

```swift
// Add tracking of in-flight tool calls
private var pendingToolCalls: Set<String> = []  // Track call_ids

// When dispatching tool:
func handleToolCallEvent(_ event: [String: Any], context: ToolContext) {
    guard let callId = event["call_id"] as? String else { return }

    // Register pending tool call
    conversationQueue.async {
        self.pendingToolCalls.insert(callId)
    }

    // ... existing dispatch logic
}

// When tool completes:
func completeToolCall(callId: String) {
    conversationQueue.async {
        self.pendingToolCalls.remove(callId)
    }
}

// Before pruning:
private func pruneOldestConversationItems(context: ToolContext, targetTurnCount: Int) {
    // BLOCK if any pending tool calls reference items we're about to delete
    let itemsToDelete = /* ... compute items to delete ... */

    for item in itemsToDelete {
        if item.type == "function_call" && pendingToolCalls.contains(item.id) {
            logger.log("[SAFETY] Deferring prune - pending tool call references item")
            // Schedule retry or wait for tool to complete
            return
        }
    }

    // ... proceed with pruning
}
```

### Fix 2: Response State Management

**Location: OpenAIWebRTCClient.swift**

```swift
private var activeResponseId: String? = nil
private var pendingToolOutputs: [(callId: String, result: String)] = []

// Track response lifecycle
func handleResponseStarted(responseId: String) {
    activeResponseId = responseId
}

func handleResponseDone() {
    activeResponseId = nil

    // Process any queued tool outputs
    if let next = pendingToolOutputs.first {
        pendingToolOutputs.removeFirst()
        sendToolCallResult(callId: next.callId, result: next.result)
    }
}

func sendToolCallResult(callId: String, result: String) {
    let outputDict: [String: Any] = [
      "type": "conversation.item.create",
      "item": [
        "type": "function_call_output",
        "call_id": callId,
        "output": result
      ]
    ]

    let didSend = sendEvent(outputDict)

    if !didSend {
        logger.log("Failed to send tool output - call_id may be invalid",
                   metadata: ["callId": callId])
        return  // ← Don't create response if output failed!
    }

    // Check if response is already active
    if activeResponseId != nil {
        logger.log("Response already active - queueing tool output",
                   metadata: ["callId": callId, "activeResponse": activeResponseId])
        pendingToolOutputs.append((callId, result))
        return
    }

    sendEvent(["type": "response.create"])
}
```

### Fix 3: Enhanced Logging (Immediate, No Code Changes)

**Add these log points to make errors more visible:**

**In sendToolCallResult():**
```swift
func sendToolCallResult(callId: String, result: String) {
    logger.log(
        "🔧 [TOOL_OUTPUT] Sending tool call result",
        attributes: [
            "callId": callId,
            "resultLength": result.count,
            "currentConversationItems": conversationItems.count,
            "currentTurnCount": conversationTurnCount,
            "hasActiveResponse": activeResponseId != nil
        ]
    )

    let outputDict: [String: Any] = [/*...*/]
    let didSend = sendEvent(outputDict)

    if !didSend {
        logger.log(
            "❌ [TOOL_OUTPUT_FAILED] conversation.item.create failed",
            attributes: [
                "callId": callId,
                "likelyReason": "call_id not found in conversation (may have been pruned)"
            ]
        )
        return  // Don't trigger response.create!
    }

    logger.log(
        "📤 [RESPONSE_CREATE] Triggering response continuation",
        attributes: ["callId": callId, "hasActiveResponse": activeResponseId != nil]
    )

    sendEvent(["type": "response.create"])
}
```

**In pruneOldestConversationItems():**
```swift
private func pruneOldestConversationItems(context: ToolContext, targetTurnCount: Int) {
    // ... existing code ...

    // LOG ALL ITEMS BEING DELETED WITH THEIR TYPES
    for (item, position) in itemsToDelete {
        logger.log(
            "🗑️ [PRUNE_DELETE] Deleting conversation item",
            attributes: [
                "itemId": item.id,
                "itemType": item.type ?? "unknown",
                "isFunctionCall": item.type == "function_call",
                "callId": item.id,  // If function_call, this IS the call_id!
                "turnNumber": item.turnNumber,
                "ageSeconds": ageSeconds
            ]
        )
    }
}
```

**In handleToolCallEvent():**
```swift
private func handleToolCallEvent(_ event: [String: Any], context: ToolContext) {
    guard let callId = event["call_id"] as? String,
          let toolName = event["name"] as? String,
          let argumentsJSON = event["arguments"] as? String else {
        return
    }

    logger.log(
        "🔨 [TOOL_DISPATCH] Tool call starting",
        attributes: [
            "callId": callId,
            "toolName": toolName,
            "currentConversationItems": conversationItems.count,
            "currentTurnCount": conversationTurnCount,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
    )

    respondToToolCall(callId: callId, toolName: toolName, argumentsJSON: argumentsJSON, context: context)
}
```

### Fix 4: Graceful Error Handling

**Don't send `response.create` if `conversation.item.create` failed:**

```swift
func sendToolCallResult(callId: String, result: String) {
    let outputDict: [String: Any] = [/*...*/]

    let didSend = sendEvent(outputDict)

    if !didSend {
        // Item create failed - likely invalid call_id
        // DON'T create response - will cause cascade errors
        logger.log("Skipping response.create due to failed conversation.item.create")
        return
    }

    // Only create response if output was successfully added
    sendEvent(["type": "response.create"])
}
```

---

## Enhanced Logging Requirements

### Critical Log Points Needed:

1. **Tool Call Lifecycle:**
   - Tool call received: call_id, tool name, conversation state
   - Tool dispatched: call_id, current turn count, conversation items count
   - Tool completed: call_id, execution duration, result size
   - Tool output sent: call_id, success/failure, reason if failed

2. **Conversation Management:**
   - Item created: item_id, type, is_turn, turn_number, conversation_state
   - Item deleted: item_id, type, reason, age, conversation_state_after
   - Pruning triggered: items_to_delete, pending_tool_calls, turn_counts

3. **Response Management:**
   - Response started: response_id, trigger_source (tool_output vs user_input)
   - Response active check: active_response_id, requesting_source
   - Response completed: response_id, duration, queued_outputs_count

4. **Error Correlation:**
   - All errors should include: conversation_items_count, turn_count, pending_tool_calls, active_response_id

---

## Implementation Priority

### Immediate (No Breaking Changes):
1. ✅ Enhanced logging (Fix 3) - can deploy immediately
2. ✅ Error handling in sendToolCallResult() (Fix 4) - prevents cascading errors

### Short-term (Requires Testing):
3. ⚠️ Response state management (Fix 2) - requires tracking response lifecycle
4. ⚠️ Pending tool call tracking (Fix 1) - requires coordination with pruning

### Long-term (Architectural):
5. 🔄 Tool execution queue with retries
6. 🔄 Transactional conversation management (MVCC-style)
7. 🔄 Circuit breaker for rapid tool failures

---

## Testing Recommendations

1. **Reproduce Scenario:**
   - Set `maxConversationTurns` to low value (e.g., 3)
   - Trigger multiple tool calls in rapid succession
   - Verify turn limit exceeded during tool execution
   - Capture full logs with enhanced logging

2. **Load Testing:**
   - Multiple concurrent tool calls
   - Slow tools (simulate network delay)
   - Aggressive turn limit pruning

3. **Edge Cases:**
   - Tool completes after connection closes
   - Tool completes after pruning
   - Multiple tools complete simultaneously
   - Response.create while previous response active

---

## Current Code Locations

**Key Files:**
- `/Users/tleyden/Development/arty/modules/vm-webrtc/ios/OpenAIWebRTCClient.swift`
  - Lines 595-644: sendToolCallResult(), sendToolCallError()

- `/Users/tleyden/Development/arty/modules/vm-webrtc/ios/WebRTCEventHandler.swift`
  - Lines 307-329: handleToolCallEvent() - tool dispatch
  - Lines 519-610: respondToToolCall() - tool routing
  - Lines 783-898: pruneOldestConversationItems() - turn limit enforcement
  - Lines 638-732: handleConversationItemCreated() - item tracking

- `/Users/tleyden/Development/arty/modules/vm-webrtc/ios/ToolkitHelper.swift`
  - Lines 241-284: executeToolkitOperation() - async tool execution
  - Lines 282-283: sendToolCallResult() callback

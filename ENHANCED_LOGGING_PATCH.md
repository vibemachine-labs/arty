# Enhanced Logging Patch for Realtime API Errors

This patch adds comprehensive logging to diagnose `invalid_tool_call_id` and `conversation_already_has_active_response` errors.

## File 1: OpenAIWebRTCClient.swift

### Patch Location: sendToolCallResult() function (around line 595)

**BEFORE:**
```swift
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

    if didSend {
      self.logger.log(
        "[VmWebrtc] " + "Tool call result sent",
        attributes: logAttributes(for: .debug, metadata: [
          "callId": callId,
          "resultLength": result.count,
          "result_preview": String(result.prefix(500)),
          "result": result
        ])
      )
      eventHandler.recordExternalActivity(reason: "tool_call_result")

      // Continue conversation
      sendEvent(["type": "response.create"])
    } else {
      self.logger.log(
        "[VmWebrtc] " + "Failed to send tool call result",
        attributes: logAttributes(for: .error, metadata: [
          "callId": callId
        ])
      )
    }
  }
```

**AFTER (Enhanced Version):**
```swift
func sendToolCallResult(callId: String, result: String) {
    // PRE-SEND DIAGNOSTICS
    self.logger.log(
      "🔧 [TOOL_OUTPUT_START] Preparing to send tool call result",
      attributes: logAttributes(for: .info, metadata: [
        "callId": callId,
        "resultLength": result.count,
        "result_preview": String(result.prefix(500)),
        "result": result,
        "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
        "peerConnectionState": peerConnection?.connectionState.rawValue ?? -1,
        "timestamp": ISO8601DateFormatter().string(from: Date())
      ])
    )

    let outputDict: [String: Any] = [
      "type": "conversation.item.create",
      "item": [
        "type": "function_call_output",
        "call_id": callId,
        "output": result
      ]
    ]

    let didSend = sendEvent(outputDict)

    if didSend {
      self.logger.log(
        "✅ [TOOL_OUTPUT_SENT] Tool call result successfully sent via data channel",
        attributes: logAttributes(for: .info, metadata: [
          "callId": callId,
          "resultLength": result.count,
          "result_preview": String(result.prefix(500)),
          "result": result,
          "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
      )
      eventHandler.recordExternalActivity(reason: "tool_call_result")

      // Continue conversation
      self.logger.log(
        "📤 [RESPONSE_CREATE] Triggering response.create to continue conversation",
        attributes: logAttributes(for: .info, metadata: [
          "trigger": "tool_call_result",
          "callId": callId,
          "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
      )

      let responseCreateSent = sendEvent(["type": "response.create"])

      if !responseCreateSent {
        self.logger.log(
          "❌ [RESPONSE_CREATE_FAILED] Failed to send response.create",
          attributes: logAttributes(for: .error, metadata: [
            "callId": callId,
            "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
            "timestamp": ISO8601DateFormatter().string(from: Date())
          ])
        )
      }
    } else {
      self.logger.log(
        "❌ [TOOL_OUTPUT_FAILED] Failed to send conversation.item.create for tool result",
        attributes: logAttributes(for: .error, metadata: [
          "callId": callId,
          "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
          "peerConnectionState": peerConnection?.connectionState.rawValue ?? -1,
          "likelyReason": "call_id may not exist in conversation (could have been pruned)",
          "recommendation": "Check if conversation pruning deleted this call_id",
          "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
      )

      // CRITICAL: Do NOT send response.create if output failed
      // This prevents cascading "conversation_already_has_active_response" errors
    }
  }
```

### Patch Location: sendToolCallError() function (around line 631)

**BEFORE:**
```swift
func sendToolCallError(callId: String, error: String) {
    let outputDict: [String: Any] = [
      "type": "conversation.item.create",
      "item": [
        "type": "function_call_output",
        "call_id": callId,
        "output": "{\"error\": \"\(error)\"}"
      ]
    ]

    sendEvent(outputDict)
    sendEvent(["type": "response.create"])
    eventHandler.recordExternalActivity(reason: "tool_call_error")
  }
```

**AFTER (Enhanced Version):**
```swift
func sendToolCallError(callId: String, error: String) {
    self.logger.log(
      "⚠️ [TOOL_ERROR] Sending tool call error response",
      attributes: logAttributes(for: .warn, metadata: [
        "callId": callId,
        "error": error,
        "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
        "timestamp": ISO8601DateFormatter().string(from: Date())
      ])
    )

    let outputDict: [String: Any] = [
      "type": "conversation.item.create",
      "item": [
        "type": "function_call_output",
        "call_id": callId,
        "output": "{\"error\": \"\(error)\"}"
      ]
    ]

    let didSend = sendEvent(outputDict)

    if !didSend {
      self.logger.log(
        "❌ [TOOL_ERROR_SEND_FAILED] Failed to send tool error response",
        attributes: logAttributes(for: .error, metadata: [
          "callId": callId,
          "error": error,
          "likelyReason": "call_id may not exist in conversation (could have been pruned)",
          "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
      )
      return  // Don't send response.create if error output failed
    }

    self.logger.log(
      "📤 [RESPONSE_CREATE] Triggering response.create after tool error",
      attributes: logAttributes(for: .info, metadata: [
        "trigger": "tool_call_error",
        "callId": callId,
        "timestamp": ISO8601DateFormatter().string(from: Date())
      ])
    )

    sendEvent(["type": "response.create"])
    eventHandler.recordExternalActivity(reason: "tool_call_error")
  }
```

---

## File 2: WebRTCEventHandler.swift

### Patch Location: handleToolCallEvent() function (around line 307)

**Add this at the BEGINNING of the function:**

```swift
private func handleToolCallEvent(_ event: [String: Any], context: ToolContext) {
    guard let callId = event["call_id"] as? String,
          let toolName = event["name"] as? String,
          let argumentsJSON = event["arguments"] as? String else {
      logger.log(
        "[WebRTCEventHandler] Tool call event missing required fields",
        attributes: logAttributes(for: .warn, metadata: ["event": String(describing: event)])
      )
      return
    }

    // NEW: Enhanced logging at tool call start
    conversationQueue.async {
      self.logger.log(
        "🔨 [TOOL_DISPATCH_START] Tool call received and dispatching",
        attributes: logAttributes(for: .info, metadata: [
          "callId": callId,
          "toolName": toolName,
          "arguments_length": argumentsJSON.count,
          "arguments_preview": String(argumentsJSON.prefix(1000)),
          "currentConversationItems": self.conversationItems.count,
          "currentTurnCount": self.conversationTurnCount,
          "maxTurns": self.maxConversationTurns as Any,
          "dispatchTimestamp": ISO8601DateFormatter().string(from: Date())
        ])
      )
    }

    // ... rest of existing code ...
```

### Patch Location: pruneOldestConversationItems() function (around line 783)

**Add detailed logging for each item being deleted:**

```swift
// After this line: for (item, position) in itemsToDelete {
// Add comprehensive logging:

for (item, position) in itemsToDelete {
  // NEW: Detailed logging for each deleted item
  let ageInSeconds = now.timeIntervalSince(item.createdAt)

  var metadata: [String: Any] = [
    "itemId": item.id,
    "position": position,
    "itemType": item.type as Any,
    "itemRole": item.role as Any,
    "isTurn": item.isTurn,
    "turnNumber": item.turnNumber as Any,
    "ageSeconds": String(format: "%.2f", ageInSeconds),
    "createdAt": formatter.string(from: item.createdAt),
    "contentLength": item.contentSnippet?.count as Any,
    "contentSnippet": item.contentSnippet as Any
  ]

  // CRITICAL: Flag if this is a function call (contains call_id)
  if item.type == "function_call" {
    metadata["WARNING"] = "DELETING FUNCTION CALL - call_id will become invalid"
    metadata["potentiallyOrphanedCallId"] = item.id

    self.logger.log(
      "🚨 [PRUNE_DELETE_FUNCTION_CALL] Deleting function_call item - call_id will be orphaned",
      attributes: logAttributes(for: .warn, metadata: metadata)
    )
  } else if item.isTurn {
    self.logger.log(
      "[WebRTCEventHandler] [TurnLimit] Marking turn for deletion",
      attributes: logAttributes(for: .info, metadata: metadata)
    )
  } else {
    self.logger.log(
      "[WebRTCEventHandler] [TurnLimit] Marking non-turn item for deletion",
      attributes: logAttributes(for: .debug, metadata: metadata)
    )
  }

  // ... rest of existing code for sending delete event ...
}
```

### Patch Location: handleConversationItemCreated() function (around line 638)

**Add detection for function_call items:**

```swift
// After extracting metadata, add this:

// Detect if this is a function_call item (tool invocation)
let isFunctionCall = (type == "function_call")
if isFunctionCall {
  self.logger.log(
    "🔧 [FUNCTION_CALL_CREATED] Function call item added to conversation",
    attributes: logAttributes(for: .info, metadata: [
      "itemId": itemId,
      "callId": itemId,  // For function_call items, itemId IS the call_id
      "role": role as Any,
      "currentTurnCount": self.conversationTurnCount,
      "totalItems": self.conversationItems.count + 1,
      "maxTurns": self.maxConversationTurns as Any,
      "timestamp": ISO8601DateFormatter().string(from: Date())
    ])
  )
}
```

---

## File 3: ToolkitHelper.swift

### Patch Location: executeToolkitOperation() callback (around line 241-284)

**Add logging when tool completes and sends result:**

```swift
registerStringCallback(requestId: requestId) { result, error in
  let completionTimestamp = ISO8601DateFormatter().string(from: Date())

  if let error = error {
    self.logger.log(
      "❌ [TOOLKIT_EXECUTION_ERROR] Toolkit operation failed",
      attributes: [
        "callId": callId,
        "requestId": requestId,
        "groupName": groupName,
        "toolName": toolName,
        "error": error.localizedDescription,
        "completionTimestamp": completionTimestamp
      ]
    )

    // About to send error response
    self.logger.log(
      "🔧 [TOOLKIT_SENDING_ERROR] About to call sendToolCallError",
      attributes: [
        "callId": callId,
        "requestId": requestId,
        "errorMessage": error.localizedDescription,
        "timestamp": completionTimestamp
      ]
    )

    self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
    return
  }

  guard let result = result else {
    self.logger.log(
      "[ToolkitHelper] Toolkit operation returned no result",
      attributes: [
        "callId": callId,
        "requestId": requestId,
        "groupName": groupName,
        "toolName": toolName
      ]
    )
    self.responder?.sendToolCallError(callId: callId, error: "No result from toolkit operation")
    return
  }

  self.logger.log(
    "✅ [TOOLKIT_EXECUTION_SUCCESS] Toolkit operation result received",
    attributes: [
      "callId": callId,
      "requestId": requestId,
      "groupName": groupName,
      "toolName": toolName,
      "result_length": result.count,
      "result_preview": String(result.prefix(1000)),
      "result": result,
      "completionTimestamp": completionTimestamp
    ]
  )

  // About to send successful result
  self.logger.log(
    "🔧 [TOOLKIT_SENDING_RESULT] About to call sendToolCallResult",
    attributes: [
      "callId": callId,
      "requestId": requestId,
      "resultLength": result.count,
      "timestamp": completionTimestamp
    ]
  )

  // Send the result back to OpenAI
  self.responder?.sendToolCallResult(callId: callId, result: result)
}
```

---

## Usage: How to Diagnose Issues with Enhanced Logging

### When `invalid_tool_call_id` occurs:

Look for this sequence in logs:

1. `🔨 [TOOL_DISPATCH_START]` - Tool was dispatched with call_id
2. `🚨 [PRUNE_DELETE_FUNCTION_CALL]` - Function call was deleted (call_id orphaned)
3. `✅ [TOOLKIT_EXECUTION_SUCCESS]` - Tool completed (but call_id is already gone)
4. `🔧 [TOOL_OUTPUT_START]` - Trying to send result
5. `❌ [TOOL_OUTPUT_FAILED]` - Failed because call_id not found

**Diagnosis:** Tool took too long, conversation was pruned during execution

### When `conversation_already_has_active_response` occurs:

Look for this sequence:

1. `📤 [RESPONSE_CREATE]` with trigger="tool_call_result" and callId="A"
2. Response starts (resp_XXX)
3. `📤 [RESPONSE_CREATE]` with trigger="tool_call_result" and callId="B"
4. Error: conversation already has active response

**Diagnosis:** Multiple tools completed rapidly, both tried to create responses

### Timestamp Analysis:

All enhanced logs include ISO8601 timestamps. Use these to:
- Calculate tool execution duration
- Identify race conditions
- Correlate pruning events with tool completions
- Detect rapid-fire response.create calls

---

## Testing the Enhanced Logging

1. Deploy with enhanced logging
2. Trigger the error conditions:
   - Set `maxConversationTurns` to 3
   - Call multiple tools in rapid succession
   - Ensure some tools are slow (>1 second)
3. Capture logs and search for emoji markers:
   - 🔨 Tool dispatch
   - 🚨 Function call deletion
   - 🔧 Tool output attempts
   - ✅ Successes
   - ❌ Failures
   - 📤 Response creates

---

## Recommended Next Steps After Deploying Logging

1. Collect logs from error occurrences
2. Analyze timestamp gaps between:
   - Tool dispatch → Tool completion
   - Tool completion → Result sent
   - Pruning → Tool completion
3. Determine if fix priority should be:
   - A) Defer pruning while tools execute
   - B) Queue tool outputs if response active
   - C) Both

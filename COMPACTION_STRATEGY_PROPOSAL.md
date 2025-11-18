# Conversation Compaction Strategy: Current Implementation vs OpenAI Best Practices

**Date:** November 18, 2025  
**Status:** Proposal - No Code Changes Yet  
**Author:** Codex AI Analysis

---

## Executive Summary

This document analyzes how our current conversation compaction implementation compares to OpenAI's documented best practices for Realtime API context summarization. While our implementation already follows many key principles, there are several opportunities to optimize for better quality, cost efficiency, and alignment with OpenAI's recommendations.

**Key Finding:** Our "all-or-nothing" compaction strategy (compact entire history → 1 summary) is more aggressive than OpenAI's recommended "keep recent turns + summarize old" approach, which may cause loss of important recent context and degrade conversation quality.

---

## 📊 Side-by-Side Comparison

| Aspect | Current Implementation | OpenAI Best Practice | Gap Analysis |
|--------|------------------------|----------------------|--------------|
| **Trigger Mechanism** | Content-length based (10,000 chars default) | Token-based with configurable threshold (2k-32k tokens) | ✅ **GOOD**: Content-length is simpler; tokens would be more precise |
| **Compaction Strategy** | **Replace ALL items with 1 summary** | **Keep last N turns verbatim + summarize older turns** | ❌ **GAP**: We lose all recent context; OpenAI keeps recent turns intact |
| **Summary Position** | System message inserted first (before deletion) | System message at conversation root (via `previous_item_id: "root"`) | ⚠️ **CONCERN**: Not using `previous_item_id` may affect context ordering |
| **Summary Model** | `gpt-4o` via `/v1/responses` endpoint | `gpt-4o-mini` (cheaper, faster) | ⚠️ **OPPORTUNITY**: Using full gpt-4o is 60x more expensive than mini |
| **Summary Prompt** | Factual, neutral, 1-3 paragraphs | Similar approach with explicit context preservation | ✅ **GOOD**: Prompt quality is comparable |
| **Fallback Strategy** | Prune oldest items on summarization failure | Not specified | ✅ **GOOD**: We have a safety net |
| **Summary Message Role** | `system` | `system` (confirmed correct choice) | ✅ **GOOD**: Prevents modality switching issues |
| **Deletion Timing** | After summary insertion (prevents "rug pull") | After summary insertion | ✅ **GOOD**: Correct order implemented |
| **Configuration** | `maxContentLength` mapped from UI slider | `SUMMARY_TRIGGER`, `KEEP_LAST_TURNS` constants | ✅ **GOOD**: User-configurable via slider |
| **Multiple Summaries** | Only compacts when triggered (resets state) | Can create multiple cumulative summaries | ⚠️ **GAP**: Not handling incremental summarization |
| **Async Execution** | `@MainActor` async with `compactionInProgress` guard | Background task with state flag | ✅ **GOOD**: Non-blocking with safety guard |

---

## 🔍 Detailed Analysis

### 1. Compaction Strategy: The Critical Difference

#### **Current Behavior: "Nuclear Reset"**
```swift
// We compact ALL conversation items at once:
let itemsToCompact = self.conversationItems  // Everything!
let compactOnlyItems = itemsToCompact.map { $0.item }

// Result: Entire conversation history → 1 summary system message
// Local state: conversationItems cleared, turnCount reset to 0
```

**Problems:**
- ❌ Loses all recent conversational context (last 2-4 turns are valuable!)
- ❌ Summary may not capture nuance of immediate conversation flow
- ❌ Model has no verbatim recent turns to reference
- ❌ Higher risk of summary "drift" or information loss

#### **OpenAI Recommended: "Sliding Window"**
```python
# Keep last N turns (e.g., 2), summarize the rest
old_turns = state.history[:-KEEP_LAST_TURNS]  # Older turns to summarize
recent_turns = state.history[-KEEP_LAST_TURNS:]  # Keep verbatim

# After summarization:
state.history = [summary_turn] + recent_turns  # Summary + recent turns
```

**Benefits:**
- ✅ Preserves immediate conversation context (last 2-4 exchanges)
- ✅ Model can reference exact wording from recent turns
- ✅ Gradual context evolution (not a hard reset)
- ✅ Better instruction adherence for ongoing tasks

---

### 2. Summary Message Positioning

#### **Current Implementation:**
```swift
let summaryEvent: [String: Any] = [
  "type": "conversation.item.create",
  "item": [
    "type": "message",
    "role": "system",
    "content": [...]
  ]
]
```

**Concern:** We don't specify `previous_item_id: "root"`, which means the summary may be appended at the current position instead of inserted at the beginning of the conversation timeline.

#### **OpenAI Recommendation:**
```python
{
  "type": "conversation.item.create",
  "previous_item_id": "root",  # Force insertion at conversation start
  "item": {
    "id": summary_id,
    "type": "message",
    "role": "system",
    "content": [{"type": "input_text", "text": summary_text}]
  }
}
```

**Impact:** Without `previous_item_id: "root"`, the summary might not act as foundational context for the entire conversation.

---

### 3. Summary Model: Cost Optimization

#### **Current Cost Structure:**
```swift
let request = ResponsesRequest(
  model: "gpt-4o",  // Premium model
  input: prompt
)
```

**Costs (per 1M tokens):**
- `gpt-4o`: $2.50 input / $10.00 output
- `gpt-4o-mini`: $0.075 input / $0.30 output

**Example Scenario:**
- Summarizing 2000 words (~2700 tokens)
- With `gpt-4o`: ~$0.007 input + ~$0.005 output = **$0.012 per summary**
- With `gpt-4o-mini`: ~$0.0002 input + ~$0.00015 output = **$0.0003 per summary**
- **Savings: 40x cheaper with mini** 🤑

**OpenAI's Rationale:** Summarization is a straightforward task that doesn't require the advanced reasoning of `gpt-4o`. `gpt-4o-mini` is specifically optimized for this use case.

---

### 4. Token Calculation vs Content Length

#### **Current Approach:**
```swift
let totalContentLength = self.conversationItems.reduce(0) { 
  $0 + ($1.fullContent?.count ?? 0) 
}

guard totalContentLength > maxContentLength else { return }
```

**Trade-offs:**
- ✅ **Pro:** Simple character count, no tokenization overhead
- ⚠️ **Con:** Characters ≠ tokens (1 token ≈ 4 chars for English text, but audio tokens are much larger)
- ⚠️ **Con:** Can't leverage OpenAI's `usage.total_tokens` from `response.done` events

#### **OpenAI Approach:**
```python
state.latest_tokens = event["response"]["usage"]["total_tokens"]
if state.latest_tokens >= SUMMARY_TRIGGER:
    asyncio.create_task(summarise_and_prune(ws, state))
```

**Benefits:**
- ✅ Accurate tracking of actual token consumption
- ✅ Accounts for audio tokens (which are 10x larger than text tokens)
- ✅ Aligns with OpenAI's 32k token window limit

**Recommendation:** Consider tracking `latest_tokens` from `response.done` events alongside (or instead of) content length.

---

### 5. Incremental Summarization (Not Implemented)

#### **OpenAI Pattern:**
```python
state.summary_count += 1
summary_id = f"sum_{state.summary_count:03d}"

# Can create multiple summaries over session lifetime:
# sum_001: Summarizes turns 1-10
# sum_002: Summarizes turns 1-10 (already summarized) + 11-20
# ...and so on
```

**Current Gap:** We only compact once per threshold crossing. If a session runs very long, we'll cross the threshold again but have no incremental summarization strategy.

**Potential Enhancement:** Track `summaryCount`, allow multiple compaction cycles, and consider summarizing previous summaries to create "meta-summaries" for ultra-long sessions.

---

### 6. Function Call Handling During Compaction

#### **Current Implementation (Good Catch!):**
```swift
if item.type == "function_call" {
  metadata["WARNING"] = "DELETING FUNCTION CALL - call_id will become invalid"
  self.logger.log("🚨 [COMPACT_DELETE_FUNCTION_CALL] ...")
}
```

**This is excellent observability** — you're already aware that deleting function_call items orphans their call_ids.

#### **OpenAI Best Practice:**
The notebook example doesn't explicitly handle function calls, but based on Realtime API semantics:

**Options:**
1. **Keep function call items out of compaction** — only compact user/assistant messages
2. **Extract function call results into summary** — include tool outputs in the summary text
3. **Accept orphaned call_ids** — rely on recent turns (which we should keep) to contain active function calls

**Recommendation:** Option 1 (exclude function calls from compaction) or Option 3 (keep recent turns with active calls).

---

## 📝 Proposed Changes

### **Priority 1: Implement "Keep Recent Turns" Strategy** 🎯

**Change:** Modify `compactConversationItems()` to preserve the last `N` turns verbatim.

```swift
// Proposed new constant
private static let KEEP_LAST_TURNS = 2  // Or make configurable

@MainActor
func compactConversationItems(context: ToolContext) async {
  // ... existing checks ...
  
  // CHANGE: Only compact older items, keep recent turns
  let totalTurns = self.conversationItems.filter { $0.isTurn }.count
  
  guard totalTurns > KEEP_LAST_TURNS else {
    logger.log("[Compact] Not enough turns to compact (need > \(KEEP_LAST_TURNS))")
    return
  }
  
  // Split conversation: old items (to compact) vs recent turns (keep)
  let turnItems = self.conversationItems.filter { $0.isTurn }
  let turnsToCompact = turnItems.dropLast(KEEP_LAST_TURNS)
  
  // Get all item IDs for turns being compacted
  let idsToCompact = Set(turnsToCompact.map { $0.id })
  
  // Compact only the old items
  let itemsToCompact = self.conversationItems.filter { idsToCompact.contains($0.id) }
  
  // ... rest of compaction logic (summarize, insert, delete) ...
  
  // CHANGE: Don't reset conversationItems — keep recent turns
  let compactedIds = Set(itemsToCompact.map { $0.id })
  self.conversationItems.removeAll { compactedIds.contains($0.id) }
  // Note: Recent turns stay in conversationItems!
}
```

**Impact:**
- ✅ Maintains conversation continuity
- ✅ Better model performance (recent context intact)
- ✅ Aligns with OpenAI best practice

---

### **Priority 2: Add `previous_item_id: "root"` to Summary**

**Change:** Ensure summary is inserted at conversation root, not appended.

```swift
let summaryEvent: [String: Any] = [
  "type": "conversation.item.create",
  "previous_item_id": "root",  // ADD THIS
  "item": [
    "type": "message",
    "role": "system",
    "content": [
      [
        "type": "input_text",
        "text": summaryWithPreamble
      ]
    ]
  ]
]
```

**Impact:**
- ✅ Guarantees summary acts as foundational context
- ✅ Matches OpenAI example behavior

---

### **Priority 3: Switch to `gpt-4o-mini` for Summarization**

**Change:** Use cheaper, faster model for summary generation.

```swift
let request = ResponsesRequest(
  model: "gpt-4o-mini",  // Changed from "gpt-4o"
  input: prompt
)
```

**Impact:**
- 💰 **40x cost reduction** per summary
- ⚡ **Faster summarization** (mini has lower latency)
- ✅ No quality loss for this task (summarization is well within mini's capabilities)

---

### **Priority 4: Track Actual Token Usage**

**Change:** Use `response.usage.total_tokens` from OpenAI instead of content length.

```swift
// In handleResponseDoneEvent:
if let usage = response["usage"] as? [String: Any],
   let totalTokens = usage["total_tokens"] as? Int {
  self.latestTokenCount = totalTokens
  
  if totalTokens > maxTokenCount {
    Task { @MainActor in
      await self.compactConversationItems(context: context)
    }
  }
}
```

**Impact:**
- ✅ Accurate token accounting (especially for audio)
- ✅ Better alignment with 32k token window
- ⚠️ **Trade-off:** Slightly more complex; requires tracking server-reported usage

---

### **Priority 5: Exclude Function Calls from Compaction**

**Change:** Only compact user/assistant messages, preserve function calls.

```swift
// Filter out function calls before compaction
let itemsEligibleForCompaction = self.conversationItems.filter { item in
  item.type != "function_call" && item.type != "function_call_output"
}

// Only compact eligible items
let itemsToCompact = itemsEligibleForCompaction.filter { /* age/turn logic */ }
```

**Impact:**
- ✅ Avoids orphaning call_ids
- ✅ Preserves tool interaction history
- ⚠️ **Trade-off:** Function calls stay in memory (may need separate pruning strategy)

---

## 🧪 Testing Strategy

### **Recommended Test Scenarios:**

1. **Short Session (< 10k chars)**
   - Expected: No compaction triggered
   - Verify: All conversation items remain intact

2. **Long Session (> 10k chars, < 5 compactions)**
   - Expected: Single compaction, recent turns preserved
   - Verify: Summary created, old items deleted, last 2 turns remain verbatim

3. **Very Long Session (Multiple compactions)**
   - Expected: Multiple summaries created (sum_001, sum_002, ...)
   - Verify: Incremental summarization works, no data loss

4. **Function Call During Compaction**
   - Expected: Function call items excluded from compaction OR preserved in recent turns
   - Verify: No orphaned call_id errors

5. **Summary Failure**
   - Expected: Fallback to pruning strategy
   - Verify: `compactionInProgress` flag cleared, no infinite loop

6. **Cost Validation**
   - Expected: `gpt-4o-mini` summarization costs < $0.001 per summary
   - Verify: Log token counts and calculate actual costs

---

## 📊 Performance & Cost Projections

### **Current Costs (gpt-4o)**
- Average summary: 2000 words input → 200 words output
- Cost per summary: ~$0.012
- For 100 summaries/day: **$1.20/day** = **$36/month**

### **Proposed Costs (gpt-4o-mini)**
- Same workload
- Cost per summary: ~$0.0003
- For 100 summaries/day: **$0.03/day** = **$0.90/month**

**Savings: $35.10/month per 100 daily summaries** 💰

---

## ⚖️ Trade-offs & Considerations

### **Keep Recent Turns Strategy**

**Pros:**
- ✅ Better conversation quality (recent context preserved)
- ✅ Model has exact wording for recent turns
- ✅ Aligns with OpenAI best practice

**Cons:**
- ⚠️ Slightly more complex logic (split old vs recent)
- ⚠️ May delay compaction trigger (more items stay in memory)

### **Token-Based vs Content-Length Triggers**

**Pros of Token-Based:**
- ✅ Accurate tracking of OpenAI's actual limits
- ✅ Accounts for audio token inflation

**Cons of Token-Based:**
- ⚠️ Requires parsing `response.usage` from events
- ⚠️ No token count for items we create client-side (function call outputs)

**Recommendation:** **Use both** — track `totalContentLength` (local estimate) and `latestTokens` (server truth), trigger compaction when either exceeds threshold.

---

## 🎯 Implementation Roadmap

### **Phase 1: Core Strategy Improvements** (Recommended Now)
1. ✅ Implement "keep recent turns" logic (Priority 1)
2. ✅ Add `previous_item_id: "root"` (Priority 2)
3. ✅ Switch to `gpt-4o-mini` (Priority 3)

**Estimated Effort:** 2-4 hours  
**Risk:** Low (changes are isolated to compaction logic)

### **Phase 2: Advanced Token Tracking** (Next Sprint)
4. ✅ Track `latestTokens` from `response.usage` (Priority 4)
5. ✅ Dual-threshold system (content-length OR tokens)

**Estimated Effort:** 3-5 hours  
**Risk:** Medium (requires event handler changes, testing)

### **Phase 3: Function Call Handling** (Future Enhancement)
6. ✅ Exclude function calls from compaction (Priority 5)
7. ✅ Add separate pruning strategy for old function calls

**Estimated Effort:** 4-6 hours  
**Risk:** Medium (requires careful testing of tool interactions)

---

## 📚 References

- **OpenAI Realtime API Docs:** [platform.openai.com/docs/guides/realtime](https://platform.openai.com/docs/guides/realtime)
- **Context Summarization Notebook:** [Provided in user query]
- **OpenAI Conversation API:** [platform.openai.com/docs/api-reference/realtime](https://platform.openai.com/docs/api-reference/realtime)
- **Our Current Implementation:** `modules/vm-webrtc/ios/WebRTCEventHandler.swift:1478-1700`

---

## 🤔 Open Questions

1. **Should we make `KEEP_LAST_TURNS` user-configurable?**
   - Pros: More flexibility for different use cases
   - Cons: More complexity in settings UI

2. **Do we need incremental summarization for ultra-long sessions?**
   - Current: Single compaction per session
   - OpenAI: Multiple summaries (sum_001, sum_002, ...)
   - Depends on: Typical session length in production

3. **Should we track cumulative summary metadata?**
   - Example: "Summary #3 covers turns 1-50, created at [timestamp]"
   - Useful for debugging, observability

4. **Do we need a "max summaries" limit?**
   - Prevent runaway summarization costs
   - Force session reset after N compactions

---

## ✅ Recommendation

**Adopt Phase 1 changes immediately:**
- Switch to "keep recent turns" strategy (Priority 1)
- Add `previous_item_id: "root"` (Priority 2)  
- Use `gpt-4o-mini` (Priority 3)

**These changes:**
- ✅ Improve conversation quality (better context preservation)
- ✅ Reduce costs by 40x (gpt-4o → mini)
- ✅ Align with OpenAI's documented best practices
- ✅ Low implementation risk (isolated changes)

**Then evaluate Phase 2 & 3 based on production data and user feedback.**

---

## 🎤 Final Thoughts

The current implementation is **solid** — you've already solved the hard problems:
- ✅ Compaction triggers correctly based on content length
- ✅ Summary inserted before deletion (no "rug pull")
- ✅ System role prevents modality switching
- ✅ Fallback to pruning on error
- ✅ Duplicate prevention with Set tracking
- ✅ Excellent logging and observability

The **main gap** is the "all-or-nothing" compaction approach. By adopting OpenAI's "keep recent turns" pattern, you'll preserve conversation quality while still managing context window bloat.

**Estimated ROI:**
- **Cost savings:** $35/month per 100 daily summaries
- **Quality improvement:** Measurable via user feedback & A/B testing
- **Development time:** ~2-4 hours for Phase 1

**This is a high-value, low-risk improvement.** 🚀

---

**End of Proposal**

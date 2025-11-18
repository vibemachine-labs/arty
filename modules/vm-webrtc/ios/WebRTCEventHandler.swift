import Foundation

final class WebRTCEventHandler {

  // Default inactivity threshold (seconds) before auto-disconnect
  static let defaultIdleTimeout: TimeInterval = 60

  struct ToolContext {
    let githubConnectorDelegate: BaseTool?
    let gdriveConnectorDelegate: BaseTool?
    let gpt5GDriveFixerDelegate: BaseTool?
    let gpt5WebSearchDelegate: BaseTool?
    let toolkitHelper: ToolkitHelper?
    let sendToolCallError: (_ callId: String, _ error: String) -> Void
    let emitModuleEvent: (_ name: String, _ payload: [String: Any]) -> Void
    let sendDataChannelMessage: (_ event: [String: Any]) -> Void
  }

  private let logger = VmWebrtcLogging.logger

  // Conversation turn tracking
  private struct ConversationItem {
    let id: String
    let isTurn: Bool  // true for user/assistant messages that count as turns
    let createdAt: Date
    let role: String?
    let type: String?
    let contentSnippet: String?  // First 100 chars of content for logging
    let turnNumber: Int?  // Turn number if this is a turn item
  }

  private var conversationItems: [ConversationItem] = []
  private var conversationTurnCount: Int = 0
  private var maxConversationTurns: Int?
  private let conversationQueue = DispatchQueue(label: "com.vibemachine.webrtc.conversation-tracker")
  private let idleQueue = DispatchQueue(label: "com.vibemachine.webrtc.idle-monitor")
  private var idleTimer: DispatchSourceTimer?
  private var idleDebugTimer: DispatchSourceTimer?
  private var idleTimeoutHandler: (() -> Void)?
  private var lastActivityAt: Date?
  private var idleTimeoutSeconds: TimeInterval = WebRTCEventHandler.defaultIdleTimeout
  private var isIdleMonitoringActive = false
  private let idleDebugInterval: TimeInterval = 2

  func handle(event: [String: Any], context: ToolContext) {
    guard let eventType = event["type"] as? String else {
      logger.log(
        "[WebRTCEventHandler] Received event without type",
        attributes: logAttributes(for: .warn, metadata: ["event": String(describing: event)])
      )
      return
    }

    if shouldResetIdleTimer(for: eventType) {
      logger.log(
        "[WebRTCEventHandler] [IdleTimer] Event activity detected",
        attributes: logAttributes(for: .trace, metadata: ["eventType": eventType])
      )
      recordIdleActivity(source: "event:\(eventType)")
    }

    let metadata: [String: Any] = [
      "type": eventType,
      "payloadDescription": String(describing: event)
    ]
    logger.log(
      "[WebRTCEventHandler] WebRTC event received",
      attributes: logAttributes(for: .trace, metadata: metadata)
    )

    switch eventType {
    case "error":
      handleErrorEvent(event, context: context)
    case "response.function_call_arguments.done":
      handleToolCallEvent(event, context: context)
    case "response.usage":
      handleTokenUsageEvent(event, context: context)
    case "response.done":
      handleResponseDoneEvent(event, context: context)
    case "response.audio_transcript.delta":
      handleTranscriptDeltaEvent(event, context: context, type: "audio_transcript")
    case "response.audio_transcript.done":
      handleTranscriptDoneEvent(event, context: context, type: "audio_transcript")
    case "response.text.delta":
      handleTranscriptDeltaEvent(event, context: context, type: "text")
    case "response.text.done":
      handleTranscriptDoneEvent(event, context: context, type: "text")
    case "conversation.item.created":
      handleConversationItemCreated(event, context: context)
    case "conversation.item.deleted":
      handleConversationItemDeleted(event, context: context)
    case "conversation.item.input_audio_transcription.completed":
      handleInputAudioTranscriptionCompleted(event, context: context)
    default:
      logger.log(
        "[WebRTCEventHandler] Unhandled WebRTC event",
        attributes: logAttributes(for: .trace, metadata: ["type": eventType])
      )
    }
  }

  func startIdleMonitoring(timeout: TimeInterval = WebRTCEventHandler.defaultIdleTimeout, onTimeout: @escaping () -> Void) {
    idleQueue.async {
      self.idleTimeoutSeconds = max(timeout, 1)
      self.idleTimeoutHandler = onTimeout
      self.isIdleMonitoringActive = true
      self.lastActivityAt = Date()
      self.logger.log(
        "[WebRTCEventHandler] [IdleTimer] Monitoring started",
        attributes: logAttributes(for: .info, metadata: ["timeoutSeconds": self.idleTimeoutSeconds])
      )
      self.scheduleIdleTimerLocked(reason: "monitoring_started")
      self.scheduleIdleDebugTimerLocked()
    }
  }

  func stopIdleMonitoring(reason: String = "monitoring_stopped") {
    idleQueue.async {
      guard self.isIdleMonitoringActive else { return }
      self.isIdleMonitoringActive = false
      self.cancelIdleTimerLocked()
      self.cancelIdleDebugTimerLocked()
      self.idleTimeoutHandler = nil
      self.lastActivityAt = nil
      self.logger.log(
        "[WebRTCEventHandler] [IdleTimer] Monitoring stopped",
        attributes: logAttributes(for: .info, metadata: ["reason": reason])
      )
    }
  }

  func recordExternalActivity(reason: String) {
    logger.log(
      "[WebRTCEventHandler] [IdleTimer] External activity detected",
      attributes: logAttributes(for: .debug, metadata: ["reason": reason])
    )
    recordIdleActivity(source: "external:\(reason)")
  }

  func recordRemoteSpeakingActivity() {
    logger.log(
      "[WebRTCEventHandler] [IdleTimer] Remote speaking activity detected",
      attributes: logAttributes(for: .trace)
    )
    recordIdleActivity(source: "remote_speaking")
  }

  // MARK: - Idle Detection Helpers

  private func shouldResetIdleTimer(for eventType: String) -> Bool {
    let passiveEvents: Set<String> = [
      "response.create",
      "session.update",
      "session.config",
      "session.configuration",
      "session.keepalive",
      "session.keep_alive",
      "session.ping"
    ]

    if passiveEvents.contains(eventType) {
      return false
    }

    let activityPrefixes = [
      "response.",
      "conversation.",
      "input_audio_buffer.",
      "input_audio.",
      "output_audio.",
      "tool.",
      "transcript.",
      "turn.",
      "speech."
    ]

    if activityPrefixes.contains(where: { eventType.hasPrefix($0) }) {
      return true
    }

    // Fallback: treat deltas or completion markers as activity
    if eventType.contains("delta") || eventType.contains("done") || eventType.contains("error") {
      return true
    }

    return false
  }

  private func recordIdleActivity(source: String) {
    idleQueue.async {
      guard self.isIdleMonitoringActive else { return }
      self.lastActivityAt = Date()
      let attributes = logAttributes(
        for: .trace,
        metadata: [
          "source": source,
          "timeoutSeconds": self.idleTimeoutSeconds
        ]
      )
      self.logger.log("[WebRTCEventHandler] [IdleTimer] Timer reset", attributes: attributes)
      self.scheduleIdleTimerLocked(reason: source)
      self.scheduleIdleDebugTimerLocked()
    }
  }

  private func scheduleIdleTimerLocked(reason: String) {
    cancelIdleTimerLocked()

    guard isIdleMonitoringActive else { return }

    let timer = DispatchSource.makeTimerSource(flags: [], queue: idleQueue)
    timer.schedule(deadline: .now() + idleTimeoutSeconds)
    timer.setEventHandler { [weak self] in
      self?.handleIdleTimeoutLocked()
    }
    timer.resume()
    idleTimer = timer

    logger.log(
      "[WebRTCEventHandler] [IdleTimer] Timer scheduled",
      attributes: logAttributes(
        for: .trace,
        metadata: [
          "reason": reason,
          "timeoutSeconds": idleTimeoutSeconds
        ]
      )
    )
  }

  private func cancelIdleTimerLocked() {
    idleTimer?.setEventHandler {}
    idleTimer?.cancel()
    idleTimer = nil
  }

  private func scheduleIdleDebugTimerLocked() {
    cancelIdleDebugTimerLocked()

    guard isIdleMonitoringActive else { return }

    let timer = DispatchSource.makeTimerSource(flags: [], queue: idleQueue)
    timer.schedule(deadline: .now() + idleDebugInterval, repeating: idleDebugInterval)
    timer.setEventHandler { [weak self] in
      self?.logIdleCountdownLocked()
    }
    timer.resume()
    idleDebugTimer = timer
  }

  private func cancelIdleDebugTimerLocked() {
    idleDebugTimer?.setEventHandler {}
    idleDebugTimer?.cancel()
    idleDebugTimer = nil
  }

  private func logIdleCountdownLocked() {
    guard isIdleMonitoringActive else { return }

    let remaining: TimeInterval
    if let lastActivityAt {
      let elapsed = Date().timeIntervalSince(lastActivityAt)
      remaining = max(idleTimeoutSeconds - elapsed, 0)
    } else {
      remaining = idleTimeoutSeconds
    }

    logger.log(
      "[WebRTCEventHandler] [IdleTimer] Countdown update",
      attributes: logAttributes(
        for: .trace,
        metadata: [
          "isMonitoring": isIdleMonitoringActive,
          "lastActivityAt": lastActivityAt as Any,
          "secondsRemaining": "\(Int(remaining))/\(Int(idleTimeoutSeconds))"
        ]
      )
    )
  }

  private func handleIdleTimeoutLocked() {
    guard isIdleMonitoringActive else { return }
    isIdleMonitoringActive = false

    let handler = idleTimeoutHandler
    idleTimeoutHandler = nil
    let lastActivity = lastActivityAt

    logger.log(
      "[WebRTCEventHandler] [IdleTimer] Timeout reached",
      attributes: logAttributes(
        for: .warn,
        metadata: [
          "timeoutSeconds": idleTimeoutSeconds,
          "lastActivityAt": lastActivity as Any
        ]
      )
    )

    DispatchQueue.main.async {
      handler?()
    }

    cancelIdleTimerLocked()
    cancelIdleDebugTimerLocked()
    lastActivityAt = nil
  }

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

    // Enhanced logging at tool call start with conversation state
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

    logger.log(
      "[WebRTCEventHandler] Tool call received",
      attributes: logAttributes(for: .info, metadata: [
        "callId": callId,
        "name": toolName,
        "arguments_length": argumentsJSON.count,
        "arguments_preview": String(argumentsJSON.prefix(1000))
      ])
    )

    respondToToolCall(callId: callId, toolName: toolName, argumentsJSON: argumentsJSON, context: context)
  }

  private func handleTokenUsageEvent(_ event: [String: Any], context: ToolContext) {
    guard let response = event["response"] as? [String: Any],
          let usage = response["usage"] as? [String: Any] else {
      logger.log(
        "[WebRTCEventHandler] response.usage event missing response.usage field",
        attributes: logAttributes(for: .warn, metadata: ["event": String(describing: event)])
      )
      return
    }

    let responseId = response["id"] as? String
    logger.log(
      "[WebRTCEventHandler] Incremental token usage received",
      attributes: logAttributes(for: .debug, metadata: [
        "responseId": responseId as Any,
        "usage": String(describing: usage)
      ])
    )

    emitTokenUsage(usage: usage, responseId: responseId, context: context)
  }

  private func handleResponseDoneEvent(_ event: [String: Any], context: ToolContext) {
    guard let response = event["response"] as? [String: Any] else {
      logger.log(
        "[WebRTCEventHandler] response.done event missing response field",
        attributes: logAttributes(for: .warn, metadata: ["event": String(describing: event)])
      )
      return
    }

    let responseId = response["id"] as? String
    let status = response["status"] as? String

    logger.log(
      "[WebRTCEventHandler] Response done",
      attributes: logAttributes(for: .debug, metadata: [
        "responseId": responseId as Any,
        "status": status as Any
      ])
    )

    if let usage = response["usage"] as? [String: Any] {
      logger.log(
        "[WebRTCEventHandler] Token usage received",
        attributes: logAttributes(for: .debug, metadata: [
          "responseId": responseId as Any,
          "usage": String(describing: usage)
        ])
      )
      emitTokenUsage(usage: usage, responseId: responseId, context: context)
    }
  }

  private func emitTokenUsage(usage: [String: Any], responseId: String?, context: ToolContext) {
    var payload: [String: Any] = [
      "timestampMs": Int(Date().timeIntervalSince1970 * 1000)
    ]

    if let responseId = responseId {
      payload["responseId"] = responseId
    }

    // Extract input token details
    if let inputTokenDetails = usage["input_token_details"] as? [String: Any] {
      if let textTokens = inputTokenDetails["text_tokens"] as? Int {
        payload["inputText"] = textTokens
      }
      if let audioTokens = inputTokenDetails["audio_tokens"] as? Int {
        payload["inputAudio"] = audioTokens
      }
      if let cachedTokens = inputTokenDetails["cached_tokens"] as? Int {
        payload["cachedInput"] = cachedTokens
      }
    }

    // Extract output token details
    if let outputTokenDetails = usage["output_token_details"] as? [String: Any] {
      if let textTokens = outputTokenDetails["text_tokens"] as? Int {
        payload["outputText"] = textTokens
      }
      if let audioTokens = outputTokenDetails["audio_tokens"] as? Int {
        payload["outputAudio"] = audioTokens
      }
    }

    context.emitModuleEvent("onTokenUsage", payload)
  }

  private func handleTranscriptDeltaEvent(_ event: [String: Any], context: ToolContext, type: String) {
    var payload: [String: Any] = [
      "type": type,
      "isDone": false,
      "timestampMs": Int(Date().timeIntervalSince1970 * 1000)
    ]

    // Extract delta text
    if let delta = event["delta"] as? String {
      payload["delta"] = delta
    }

    // Extract response/item IDs and indices for context
    if let responseId = event["response_id"] as? String {
      payload["responseId"] = responseId
    }
    if let itemId = event["item_id"] as? String {
      payload["itemId"] = itemId
    }
    if let outputIndex = event["output_index"] as? Int {
      payload["outputIndex"] = outputIndex
    }
    if let contentIndex = event["content_index"] as? Int {
      payload["contentIndex"] = contentIndex
    }

    logger.log(
      "[WebRTCEventHandler] Transcript delta received",
      attributes: logAttributes(for: .trace, metadata: [
        "type": type,
        "delta": payload["delta"] as Any,
        "responseId": payload["responseId"] as Any
      ])
    )

    context.emitModuleEvent("onTranscript", payload)
  }

  private func handleTranscriptDoneEvent(_ event: [String: Any], context: ToolContext, type: String) {
    var payload: [String: Any] = [
      "type": type,
      "isDone": true,
      "timestampMs": Int(Date().timeIntervalSince1970 * 1000)
    ]

    // Extract complete transcript
    if let transcript = event["transcript"] as? String {
      payload["transcript"] = transcript
    }

    // Extract response/item IDs and indices for context
    if let responseId = event["response_id"] as? String {
      payload["responseId"] = responseId
    }
    if let itemId = event["item_id"] as? String {
      payload["itemId"] = itemId
    }
    if let outputIndex = event["output_index"] as? Int {
      payload["outputIndex"] = outputIndex
    }
    if let contentIndex = event["content_index"] as? Int {
      payload["contentIndex"] = contentIndex
    }

    logger.log(
      "[WebRTCEventHandler] Transcript complete (assistant)",
      attributes: logAttributes(for: .info, metadata: [
        "type": type,
        "speaker": "assistant",
        "transcriptLength": (payload["transcript"] as? String)?.count as Any,
        "transcript": payload["transcript"] as Any,
        "responseId": payload["responseId"] as Any
      ])
    )

    context.emitModuleEvent("onTranscript", payload)
  }

  private func handleInputAudioTranscriptionCompleted(_ event: [String: Any], context: ToolContext) {
    var payload: [String: Any] = [
      "type": "input_audio_transcription",
      "isDone": true,
      "timestampMs": Int(Date().timeIntervalSince1970 * 1000)
    ]

    // Extract transcript
    if let transcript = event["transcript"] as? String {
      payload["transcript"] = transcript
    }

    // Extract item ID
    if let itemId = event["item_id"] as? String {
      payload["itemId"] = itemId
    }

    // Extract content index
    if let contentIndex = event["content_index"] as? Int {
      payload["contentIndex"] = contentIndex
    }

    let transcript = payload["transcript"] as? String
    let transcriptText = transcript?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

    if !transcriptText.isEmpty {
      logger.log(
        "[WebRTCEventHandler] Transcript complete (user)",
        attributes: logAttributes(for: .info, metadata: [
          "type": "input_audio_transcription",
          "speaker": "user",
          "transcriptLength": transcriptText.count,
          "transcript": String(transcriptText),
          "itemId": payload["itemId"] as Any
        ])
      )
    } else {
      logger.log(
        "[WebRTCEventHandler] Transcript complete (user, empty)",
        attributes: logAttributes(for: .debug, metadata: [
          "itemId": payload["itemId"] as Any
        ])
      )
    }

    context.emitModuleEvent("onTranscript", payload)
  }

  private func handleErrorEvent(_ event: [String: Any], context: ToolContext) {
    let eventId = event["event_id"]
    let errorDetails = event["error"] as? [String: Any]
    let errorType = errorDetails?["type"] as? String
    let errorCode = errorDetails?["code"] as? String
    let errorMessage = errorDetails?["message"] as? String
    let errorParam = errorDetails?["param"] as? String

    logger.log(
      "[WebRTCEventHandler] ❌ WebRTC event error",
      attributes: logAttributes(for: .error, metadata: [
        "eventId": eventId as Any,
        "errorType": errorType as Any,
        "errorCode": errorCode as Any,
        "errorParam": errorParam as Any,
        "message": errorMessage as Any,
        "rawPayload": String(describing: event)
      ])
    )

    context.emitModuleEvent("onRealtimeError", event)
  }

  private func respondToToolCall(
    callId: String,
    toolName: String,
    argumentsJSON: String,
    context: ToolContext
  ) {
    logger.log(
      "[WebRTCEventHandler] Dispatching tool call",
      attributes: logAttributes(for: .info, metadata: [
        "callId": callId,
        "tool": toolName,
        "arguments_length": argumentsJSON.count,
        "arguments_preview": String(argumentsJSON.prefix(1000))
      ])
    )

    switch toolName {
    case "github_connector":
      guard let delegate = context.githubConnectorDelegate else {
        logger.log(
          "[WebRTCEventHandler] Github connector tool requested but no delegate configured",
          attributes: logAttributes(for: .warn)
        )
        context.sendToolCallError(callId, "Tool not configured: \(toolName)")
        return
      }
      delegate.handleToolCall(callId: callId, argumentsJSON: argumentsJSON)

    case "gdrive_connector":
      guard let delegate = context.gdriveConnectorDelegate else {
        logger.log(
          "[WebRTCEventHandler] GDrive connector tool requested but no delegate configured",
          attributes: logAttributes(for: .warn)
        )
        context.sendToolCallError(callId, "Tool not configured: \(toolName)")
        return
      }
      delegate.handleToolCall(callId: callId, argumentsJSON: argumentsJSON)

    case "GPT5-gdrive-fixer":
      guard let delegate = context.gpt5GDriveFixerDelegate else {
        logger.log(
          "[WebRTCEventHandler] GPT5 GDrive fixer tool requested but no delegate configured",
          attributes: logAttributes(for: .warn)
        )
        context.sendToolCallError(callId, "Tool not configured: \(toolName)")
        return
      }
      delegate.handleToolCall(callId: callId, argumentsJSON: argumentsJSON)

    case "GPT5-web-search":
      guard let delegate = context.gpt5WebSearchDelegate else {
        logger.log(
          "[WebRTCEventHandler] GPT5 web search tool requested but no delegate configured",
          attributes: logAttributes(for: .warn)
        )
        context.sendToolCallError(callId, "Tool not configured: \(toolName)")
        return
      }
      delegate.handleToolCall(callId: callId, argumentsJSON: argumentsJSON)

    default:
      // Check if this is a Gen2 toolkit tool (contains double underscore)
      if toolName.contains("__") {
        logger.log(
          "[WebRTCEventHandler] Gen2 toolkit tool requested",
          attributes: logAttributes(for: .info, metadata: ["tool": toolName])
        )

        guard let toolkitHelper = context.toolkitHelper else {
          logger.log(
            "[WebRTCEventHandler] Toolkit helper not configured",
            attributes: logAttributes(for: .warn, metadata: ["tool": toolName])
          )
          context.sendToolCallError(callId, "Toolkit helper not configured: \(toolName)")
          return
        }

        toolkitHelper.handleToolkitCall(
          callId: callId,
          toolName: toolName,
          argumentsJSON: argumentsJSON
        )
      } else {
        logger.log(
          "[WebRTCEventHandler] Unknown tool requested",
          attributes: logAttributes(for: .warn, metadata: ["tool": toolName])
        )
        context.sendToolCallError(callId, "Unknown tool: \(toolName)")
      }
    }
  }

  // MARK: - Conversation Turn Management

  func configureConversationTurnLimit(maxTurns: Int?) {
    conversationQueue.async {
      self.maxConversationTurns = maxTurns
      self.logger.log(
        "[WebRTCEventHandler] [TurnLimit] Configuration updated",
        attributes: logAttributes(for: .info, metadata: [
          "maxTurns": maxTurns as Any,
          "enabled": maxTurns != nil
        ])
      )
    }
  }

  func resetConversationTracking() {
    conversationQueue.async {
      self.conversationItems.removeAll()
      self.conversationTurnCount = 0
      self.logger.log(
        "[WebRTCEventHandler] [TurnLimit] Conversation tracking reset",
        attributes: logAttributes(for: .info)
      )
    }
  }

  private func handleConversationItemCreated(_ event: [String: Any], context: ToolContext) {
    guard let item = event["item"] as? [String: Any],
          let itemId = item["id"] as? String else {
      logger.log(
        "[WebRTCEventHandler] [TurnLimit] conversation.item.created missing item.id",
        attributes: logAttributes(for: .warn, metadata: ["event": String(describing: event)])
      )
      return
    }

    conversationQueue.async {
      // Extract metadata
      let role = item["role"] as? String
      let type = item["type"] as? String
      let isTurn = (role == "user" || role == "assistant")

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

      // Extract content snippet for logging
      var contentSnippet: String?
      if let content = item["content"] as? [[String: Any]] {
        // Content is an array of content blocks
        for contentBlock in content {
          if let text = contentBlock["text"] as? String, !text.isEmpty {
            contentSnippet = String(text.prefix(100))
            break
          } else if let transcript = contentBlock["transcript"] as? String, !transcript.isEmpty {
            contentSnippet = String(transcript.prefix(100))
            break
          }
        }
      }

      // Increment turn count if this is a turn
      let turnNumber = isTurn ? self.conversationTurnCount + 1 : nil
      if isTurn {
        self.conversationTurnCount += 1
      }

      // Create conversation item with full metadata
      let conversationItem = ConversationItem(
        id: itemId,
        isTurn: isTurn,
        createdAt: Date(),
        role: role,
        type: type,
        contentSnippet: contentSnippet,
        turnNumber: turnNumber
      )
      self.conversationItems.append(conversationItem)

      if isTurn {
        let ageInSeconds = Date().timeIntervalSince(conversationItem.createdAt)
        self.logger.log(
          "[TurnLimit] Turn item created: \(itemId)",
          attributes: logAttributes(for: .debug, metadata: [
            "itemId": itemId,
            "role": role as Any,
            "turnNumber": turnNumber as Any,
            "turnCount": self.conversationTurnCount,
            "totalItems": self.conversationItems.count,
            "position": self.conversationItems.count - 1,
            "contentLength": contentSnippet?.count as Any,
            "contentSnippet": contentSnippet as Any,
            "createdAt": ISO8601DateFormatter().string(from: conversationItem.createdAt),
            "maxTurns": self.maxConversationTurns as Any
          ])
        )

        // Check if we've exceeded the turn limit
        if let maxTurns = self.maxConversationTurns, self.conversationTurnCount > maxTurns {
          self.logger.log(
            "[WebRTCEventHandler] [TurnLimit] Turn limit exceeded, pruning oldest items",
            attributes: logAttributes(for: .info, metadata: [
              "turnCount": self.conversationTurnCount,
              "maxTurns": maxTurns,
              "totalItems": self.conversationItems.count,
              "turnsToRemove": self.conversationTurnCount - maxTurns
            ])
          )

          // Prune oldest items to get back to maxTurns
          self.pruneOldestConversationItems(context: context, targetTurnCount: maxTurns)
        }
      } else {
        self.logger.log(
          "[WebRTCEventHandler] [TurnLimit] Non-turn item created",
          attributes: logAttributes(for: .trace, metadata: [
            "itemId": itemId,
            "role": item["role"] as Any,
            "type": item["type"] as Any,
            "totalItems": self.conversationItems.count
          ])
        )
      }
    }
  }

  private func handleConversationItemDeleted(_ event: [String: Any], context: ToolContext) {
    guard let itemId = event["item_id"] as? String else {
      logger.log(
        "[WebRTCEventHandler] [TurnLimit] conversation.item.deleted missing item_id",
        attributes: logAttributes(for: .warn, metadata: ["event": String(describing: event)])
      )
      return
    }

    conversationQueue.async {
      if let index = self.conversationItems.firstIndex(where: { $0.id == itemId }) {
        let item = self.conversationItems[index]
        let ageInSeconds = Date().timeIntervalSince(item.createdAt)
        let formatter = ISO8601DateFormatter()

        self.conversationItems.remove(at: index)

        // Decrement turn count if this was a turn item
        if item.isTurn {
          self.conversationTurnCount -= 1
        }

        self.logger.log(
          "[WebRTCEventHandler] [TurnLimit] Item deleted confirmation",
          attributes: logAttributes(for: .info, metadata: [
            "itemId": itemId,
            "wasTurn": item.isTurn,
            "turnNumber": item.turnNumber as Any,
            "role": item.role as Any,
            "positionWas": index,
            "ageSeconds": String(format: "%.2f", ageInSeconds),
            "createdAt": formatter.string(from: item.createdAt),
            "contentLength": item.contentSnippet?.count as Any,
            "contentSnippet": item.contentSnippet as Any,
            "remainingItems": self.conversationItems.count,
            "remainingTurns": self.conversationTurnCount
          ])
        )
      } else {
        self.logger.log(
          "[WebRTCEventHandler] [TurnLimit] Item deleted but not found in tracking",
          attributes: logAttributes(for: .warn, metadata: [
            "itemId": itemId
          ])
        )
      }
    }
  }

  private func pruneOldestConversationItems(context: ToolContext, targetTurnCount: Int) {
    let turnsToRemove = self.conversationTurnCount - targetTurnCount

    guard turnsToRemove > 0 else {
      self.logger.log(
        "[WebRTCEventHandler] [TurnLimit] No pruning needed",
        attributes: logAttributes(for: .debug, metadata: [
          "currentTurns": self.conversationTurnCount,
          "targetTurns": targetTurnCount
        ])
      )
      return
    }

    self.logger.log(
      "[WebRTCEventHandler] [TurnLimit] Starting to prune oldest conversation items",
      attributes: logAttributes(for: .info, metadata: [
        "currentTurns": self.conversationTurnCount,
        "targetTurns": targetTurnCount,
        "turnsToRemove": turnsToRemove,
        "totalItems": self.conversationItems.count
      ])
    )

    var itemsToDelete: [(item: ConversationItem, position: Int)] = []
    var turnsRemoved = 0
    let now = Date()
    let formatter = ISO8601DateFormatter()

    // Iterate from oldest (front of array) and collect items to delete
    for (index, item) in self.conversationItems.enumerated() {
      itemsToDelete.append((item, index))

      if item.isTurn {
        turnsRemoved += 1

        // Log details about the turn being pruned
        let ageInSeconds = now.timeIntervalSince(item.createdAt)
        self.logger.log(
          "[WebRTCEventHandler] [TurnLimit] Marking turn for deletion",
          attributes: logAttributes(for: .info, metadata: [
            "itemId": item.id,
            "turnNumber": item.turnNumber as Any,
            "role": item.role as Any,
            "position": index,
            "ageSeconds": String(format: "%.2f", ageInSeconds),
            "createdAt": formatter.string(from: item.createdAt),
            "contentLength": item.contentSnippet?.count as Any,
            "contentSnippet": item.contentSnippet as Any,
            "turnsRemovedSoFar": turnsRemoved,
            "turnsToRemove": turnsToRemove
          ])
        )

        // Stop once we've identified enough turns to remove
        if turnsRemoved >= turnsToRemove {
          break
        }
      } else {
        // Log non-turn items being pruned (associated with turns)
        let ageInSeconds = now.timeIntervalSince(item.createdAt)
        self.logger.log(
          "[WebRTCEventHandler] [TurnLimit] Marking non-turn item for deletion",
          attributes: logAttributes(for: .debug, metadata: [
            "itemId": item.id,
            "type": item.type as Any,
            "role": item.role as Any,
            "position": index,
            "ageSeconds": String(format: "%.2f", ageInSeconds),
            "createdAt": formatter.string(from: item.createdAt)
          ])
        )
      }
    }

    self.logger.log(
      "[WebRTCEventHandler] [TurnLimit] Identified items to prune",
      attributes: logAttributes(for: .info, metadata: [
        "itemsToDelete": itemsToDelete.count,
        "turnsToRemove": turnsRemoved,
        "oldestItemAge": itemsToDelete.first.map { String(format: "%.2f", now.timeIntervalSince($0.item.createdAt)) } as Any,
        "newestPrunedItemAge": itemsToDelete.last.map { String(format: "%.2f", now.timeIntervalSince($0.item.createdAt)) } as Any
      ])
    )

    // Send delete events for identified items
    for (item, position) in itemsToDelete {
      let deleteEvent: [String: Any] = [
        "type": "conversation.item.delete",
        "item_id": item.id
      ]

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
      } else {
        self.logger.log(
          "[TurnLimit] Sending prune delete event for item: \(item.id)",
          attributes: logAttributes(for: .debug, metadata: metadata)
        )
      }

      DispatchQueue.main.async {
        context.sendDataChannelMessage(deleteEvent)
      }
    }

    // Note: Turn count and items will be decremented as delete confirmations come in
    self.logger.log(
      "[WebRTCEventHandler] [TurnLimit] Prune delete events sent, awaiting confirmations",
      attributes: logAttributes(for: .info, metadata: [
        "itemsSent": itemsToDelete.count
      ])
    )
  }

  private func deleteAllConversationItems(context: ToolContext) {
    let itemsToDelete = self.conversationItems.map { $0.id }

    guard !itemsToDelete.isEmpty else {
      self.logger.log(
        "[WebRTCEventHandler] [TurnLimit] No items to delete",
        attributes: logAttributes(for: .debug)
      )
      return
    }

    self.logger.log(
      "[WebRTCEventHandler] [TurnLimit] Starting deletion of all conversation items",
      attributes: logAttributes(for: .info, metadata: [
        "itemCount": itemsToDelete.count
      ])
    )

    // Send delete event for each item
    for itemId in itemsToDelete {
      let deleteEvent: [String: Any] = [
        "type": "conversation.item.delete",
        "item_id": itemId
      ]

      self.logger.log(
        "[WebRTCEventHandler] [TurnLimit] Sending delete event",
        attributes: logAttributes(for: .debug, metadata: [
          "itemId": itemId
        ])
      )

      // Send via data channel
      DispatchQueue.main.async {
        context.sendDataChannelMessage(deleteEvent)
      }
    }

    // Note: Turn count and items will be decremented as delete confirmations come in via handleConversationItemDeleted

    self.logger.log(
      "[WebRTCEventHandler] [TurnLimit] All delete events sent, awaiting confirmations",
      attributes: logAttributes(for: .info, metadata: [
        "itemsSent": itemsToDelete.count
      ])
    )
  }
}

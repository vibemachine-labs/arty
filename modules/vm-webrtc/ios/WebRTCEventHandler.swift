import Foundation

final class WebRTCEventHandler {

  // Default inactivity threshold (seconds) before auto-disconnect
  static let defaultIdleTimeout: TimeInterval = 60

  struct ToolContext {
    let githubConnectorDelegate: BaseTool?
    let gdriveConnectorDelegate: BaseTool?
    let gpt5GDriveFixerDelegate: BaseTool?
    let gpt5WebSearchDelegate: BaseTool?
    let sendToolCallError: (_ callId: String, _ error: String) -> Void
    let emitModuleEvent: (_ name: String, _ payload: [String: Any]) -> Void
  }

  private let logger = VmWebrtcLogging.logger
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
      log(
        .warn,
        "Received event without type",
        metadata: ["event": String(describing: event)]
      )
      return
    }

    if shouldResetIdleTimer(for: eventType) {
      log(.debug, "[IdleTimer] Event activity detected", metadata: ["eventType": eventType])
      recordIdleActivity(source: "event:\(eventType)")
    }

    let metadata: [String: Any] = [
      "type": eventType,
      "payloadDescription": String(describing: event)
    ]
    log(.debug, "WebRTC event received", metadata: metadata)

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
    default:
      log(.debug, "Unhandled WebRTC event", metadata: ["type": eventType])
    }
  }

  private func log(
    _ level: OpenAIWebRTCClient.NativeLogLevel,
    _ message: String,
    metadata: [String: Any]? = nil
  ) {
    var attributes = metadata ?? [:]
    attributes["level"] = level.rawValue
    logger.log("[WebRTCEventHandler] \(message)", attributes: attributes)
  }

  func startIdleMonitoring(timeout: TimeInterval = WebRTCEventHandler.defaultIdleTimeout, onTimeout: @escaping () -> Void) {
    idleQueue.async {
      self.idleTimeoutSeconds = max(timeout, 1)
      self.idleTimeoutHandler = onTimeout
      self.isIdleMonitoringActive = true
      self.lastActivityAt = Date()
      self.log(
        .info,
        "[IdleTimer] Monitoring started",
        metadata: ["timeoutSeconds": self.idleTimeoutSeconds]
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
      self.log(.debug, "[IdleTimer] Monitoring stopped", metadata: ["reason": reason])
    }
  }

  func recordExternalActivity(reason: String) {
    log(.debug, "[IdleTimer] External activity detected", metadata: ["reason": reason])
    recordIdleActivity(source: "external:\(reason)")
  }

  func recordRemoteSpeakingActivity() {
    log(.debug, "[IdleTimer] Remote speaking activity detected")
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
      self.log(.debug, "[IdleTimer] Timer reset", metadata: [
        "source": source,
        "timeoutSeconds": self.idleTimeoutSeconds
      ])
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

    log(.debug, "[IdleTimer] Timer scheduled", metadata: [
      "reason": reason,
      "timeoutSeconds": idleTimeoutSeconds
    ])
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

    log(.debug, "[IdleTimer] Countdown update", metadata: [
      "isMonitoring": isIdleMonitoringActive,
      "lastActivityAt": lastActivityAt as Any,
      "secondsRemaining": "\(Int(remaining))/\(Int(idleTimeoutSeconds))"
    ])
  }

  private func handleIdleTimeoutLocked() {
    guard isIdleMonitoringActive else { return }
    isIdleMonitoringActive = false

    let handler = idleTimeoutHandler
    idleTimeoutHandler = nil
    let lastActivity = lastActivityAt

    log(.warn, "[IdleTimer] Timeout reached", metadata: [
      "timeoutSeconds": idleTimeoutSeconds,
      "lastActivityAt": lastActivity as Any
    ])

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
      log(
        .warn,
        "Tool call event missing required fields",
        metadata: ["event": String(describing: event)]
      )
      return
    }

    log(.info, "Tool call received", metadata: [
      "callId": callId,
      "name": toolName
    ])

    respondToToolCall(callId: callId, toolName: toolName, argumentsJSON: argumentsJSON, context: context)
  }

  private func handleTokenUsageEvent(_ event: [String: Any], context: ToolContext) {
    guard let response = event["response"] as? [String: Any],
          let usage = response["usage"] as? [String: Any] else {
      log(
        .warn,
        "response.usage event missing response.usage field",
        metadata: ["event": String(describing: event)]
      )
      return
    }

    let responseId = response["id"] as? String
    log(.debug, "Incremental token usage received", metadata: [
      "responseId": responseId as Any,
      "usage": String(describing: usage)
    ])

    emitTokenUsage(usage: usage, responseId: responseId, context: context)
  }

  private func handleResponseDoneEvent(_ event: [String: Any], context: ToolContext) {
    guard let response = event["response"] as? [String: Any] else {
      log(
        .warn,
        "response.done event missing response field",
        metadata: ["event": String(describing: event)]
      )
      return
    }

    let responseId = response["id"] as? String
    let status = response["status"] as? String

    log(.debug, "Response done", metadata: [
      "responseId": responseId as Any,
      "status": status as Any
    ])

    if let usage = response["usage"] as? [String: Any] {
      log(.debug, "Token usage received", metadata: [
        "responseId": responseId as Any,
        "usage": String(describing: usage)
      ])
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

    log(.debug, "Transcript delta received", metadata: [
      "type": type,
      "delta": payload["delta"] as Any,
      "responseId": payload["responseId"] as Any
    ])

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

    log(.info, "Transcript complete", metadata: [
      "type": type,
      "transcriptLength": (payload["transcript"] as? String)?.count as Any,
      "responseId": payload["responseId"] as Any
    ])

    context.emitModuleEvent("onTranscript", payload)
  }

  private func handleErrorEvent(_ event: [String: Any], context: ToolContext) {
    let eventId = event["event_id"]
    let errorDetails = event["error"] as? [String: Any]
    let errorType = errorDetails?["type"] as? String
    let errorCode = errorDetails?["code"] as? String
    let errorMessage = errorDetails?["message"] as? String
    let errorParam = errorDetails?["param"] as? String

    log(.error, "❌ WebRTC event error", metadata: [
      "eventId": eventId as Any,
      "errorType": errorType as Any,
      "errorCode": errorCode as Any,
      "errorParam": errorParam as Any,
      "message": errorMessage as Any,
      "rawPayload": String(describing: event)
    ])

    context.emitModuleEvent("onRealtimeError", event)
  }

  private func respondToToolCall(
    callId: String,
    toolName: String,
    argumentsJSON: String,
    context: ToolContext
  ) {
    log(.info, "Dispatching tool call", metadata: [
      "callId": callId,
      "tool": toolName,
      "argsLen": argumentsJSON.count
    ])

    switch toolName {
    case "github_connector":
      guard let delegate = context.githubConnectorDelegate else {
        log(
          .warn,
          "Github connector tool requested but no delegate configured"
        )
        context.sendToolCallError(callId, "Tool not configured: \(toolName)")
        return
      }
      delegate.handleToolCall(callId: callId, argumentsJSON: argumentsJSON)

    case "gdrive_connector":
      guard let delegate = context.gdriveConnectorDelegate else {
        log(
          .warn,
          "GDrive connector tool requested but no delegate configured"
        )
        context.sendToolCallError(callId, "Tool not configured: \(toolName)")
        return
      }
      delegate.handleToolCall(callId: callId, argumentsJSON: argumentsJSON)

    case "GPT5-gdrive-fixer":
      guard let delegate = context.gpt5GDriveFixerDelegate else {
        log(
          .warn,
          "GPT5 GDrive fixer tool requested but no delegate configured"
        )
        context.sendToolCallError(callId, "Tool not configured: \(toolName)")
        return
      }
      delegate.handleToolCall(callId: callId, argumentsJSON: argumentsJSON)

    case "GPT5-web-search":
      guard let delegate = context.gpt5WebSearchDelegate else {
        log(
          .warn,
          "GPT5 web search tool requested but no delegate configured"
        )
        context.sendToolCallError(callId, "Tool not configured: \(toolName)")
        return
      }
      delegate.handleToolCall(callId: callId, argumentsJSON: argumentsJSON)

    default:
      log(
        .warn,
        "Unknown tool requested",
        metadata: ["tool": toolName]
      )
      context.sendToolCallError(callId, "Unknown tool: \(toolName)")
    }
  }
}

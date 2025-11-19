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

  // MARK: - Responses API Types (Polymorphic Schema)

  private struct ResponsesRequest: Codable {
    let model: String
    let input: String
  }

  // Polymorphic content part for message content array
  private enum ResponsesContentPart: Codable {
    case outputText(OutputTextContent)
    case other(type: String)
    
    struct OutputTextContent: Codable {
      let type: String
      let text: String
      let annotations: [String]?  // Optional: annotations
      // logprobs and other optional fields can be added here
    }
    
    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      let type = try container.decode(String.self, forKey: .type)
      
      switch type {
      case "output_text":
        self = .outputText(try OutputTextContent(from: decoder))
      default:
        self = .other(type: type)
      }
    }
    
    func encode(to encoder: Encoder) throws {
      switch self {
      case .outputText(let content):
        try content.encode(to: encoder)
      case .other(let type):
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
      }
    }
    
    private enum CodingKeys: String, CodingKey {
      case type
    }
  }

  // Polymorphic output item for response.output array
  private enum ResponsesOutputItem: Codable {
    case message(MessageOutput)
    case functionCall(FunctionCallOutput)
    case toolCall(ToolCallOutput)
    case other(type: String)
    
    struct MessageOutput: Codable {
      let type: String
      let role: String?
      let content: [ResponsesContentPart]
    }
    
    struct FunctionCallOutput: Codable {
      let type: String
      let id: String?
      let name: String?
      // Add other function_call fields as needed
    }
    
    struct ToolCallOutput: Codable {
      let type: String
      let id: String?
      let name: String?
      // Add other tool_call fields as needed
    }
    
    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      let type = try container.decode(String.self, forKey: .type)
      
      switch type {
      case "message":
        self = .message(try MessageOutput(from: decoder))
      case "function_call":
        self = .functionCall(try FunctionCallOutput(from: decoder))
      case "tool_call":
        self = .toolCall(try ToolCallOutput(from: decoder))
      default:
        self = .other(type: type)
      }
    }
    
    func encode(to encoder: Encoder) throws {
      switch self {
      case .message(let output):
        try output.encode(to: encoder)
      case .functionCall(let output):
        try output.encode(to: encoder)
      case .toolCall(let output):
        try output.encode(to: encoder)
      case .other(let type):
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
      }
    }
    
    private enum CodingKeys: String, CodingKey {
      case type
    }
  }

  private struct ResponsesResponse: Codable {
    let output: [ResponsesOutputItem]
  }

  // MARK: - Conversation turn tracking
  private struct ConversationItem {
    let id: String
    let isTurn: Bool  // true for user/assistant messages that count as turns
    let createdAt: Date
    let role: String?
    let type: String?
    var fullContent: String?  // Complete content for summarization (mutable to update with transcript)
    var contentSnippet: String?  // DEPRECATED: Only used as temporary placeholder until transcript arrives. Use fullContent instead.
    let turnNumber: Int?  // Turn number if this is a turn item

    /// Fallback text used in the summarization prompt
    var transcriptLine: String {
      let roleLabel = (role ?? "unknown").capitalized
      let text = fullContent ?? ""
      return "\(roleLabel): \(text)"
    }
  }

  private var conversationItems: [ConversationItem] = []
  private var conversationItemUniqueIds: Set<String> = []  // Track unique item IDs to prevent duplicates
  private var conversationTurnCount: Int = 0
  private var maxConversationTurns: Int?
  private var maxContentLength: Int = 10000  // Default max total content length before compaction
  private var useCompactionStrategy: Bool = true  // Default to compaction strategy
  private var compactionInProgress: Bool = false  // Prevent duplicate compaction runs
  private let conversationQueue = DispatchQueue(label: "com.vibemachine.webrtc.conversation-tracker")
  private let idleQueue = DispatchQueue(label: "com.vibemachine.webrtc.idle-monitor")
  private var idleTimer: DispatchSourceTimer?
  private var idleDebugTimer: DispatchSourceTimer?
  private var idleTimeoutHandler: (() -> Void)?
  private var lastActivityAt: Date?
  private var idleTimeoutSeconds: TimeInterval = WebRTCEventHandler.defaultIdleTimeout
  private var isIdleMonitoringActive = false
  private let idleDebugInterval: TimeInterval = 2
  private var apiKey: String?  // Access only via conversationQueue

  // Map of item IDs to their complete transcripts
  private var itemTranscripts: [String: String] = [:]

  func setApiKey(_ apiKey: String) {
    let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    conversationQueue.async {
      guard !trimmedKey.isEmpty else {
        self.apiKey = nil
        self.logger.log(
          "[WebRTCEventHandler] Cleared API key",
          attributes: logAttributes(for: .warn, metadata: ["reason": "empty_key"])
        )
        return
      }
      
      self.apiKey = trimmedKey
      self.logger.log(
        "[WebRTCEventHandler] Stored API key",
        attributes: logAttributes(for: .debug, metadata: ["keyLength": trimmedKey.count])
      )
    }
  }

  /// Thread-safe synchronous read of apiKey via conversationQueue
  private func getApiKey() -> String? {
    return conversationQueue.sync {
      return self.apiKey
    }
  }

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

  /// Manually save a conversation item to tracking (for items we create client-side)
  func saveConversationItem(itemId: String, role: String, type: String, fullContent: String) {
    conversationQueue.async {
      // Check if item already exists to prevent duplicates
      guard !self.conversationItemUniqueIds.contains(itemId) else {
        self.logger.log(
          "[WebRTCEventHandler] [ManualSave] Item already exists, skipping duplicate",
          attributes: logAttributes(for: .warn, metadata: [
            "itemId": itemId,
            "role": role,
            "type": type
          ])
        )
        return
      }
      
      let isTurn = (role == "user" || role == "assistant")
      let turnNumber = isTurn ? self.conversationTurnCount + 1 : nil
      
      if isTurn {
        self.conversationTurnCount += 1
      }
      
      let conversationItem = ConversationItem(
        id: itemId,
        isTurn: isTurn,
        createdAt: Date(),
        role: role,
        type: type,
        fullContent: fullContent,
        contentSnippet: String(fullContent.prefix(100)),
        turnNumber: turnNumber
      )
      self.conversationItems.append(conversationItem)
      self.conversationItemUniqueIds.insert(itemId)
      
      self.logger.log(
        "[WebRTCEventHandler] [ManualSave] Conversation item saved manually",
        attributes: logAttributes(for: .info, metadata: [
          "itemId": itemId,
          "role": role,
          "type": type,
          "isTurn": isTurn,
          "turnNumber": turnNumber as Any,
          "fullContentLength": fullContent.count,
          "fullContent": fullContent,
          "totalConversationItems": self.conversationItems.count,
          "totalUniqueIds": self.conversationItemUniqueIds.count,
          "turnCount": self.conversationTurnCount,
          "createdAt": ISO8601DateFormatter().string(from: Date())
        ])
      )
    }
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
          "totalConversationItems": self.conversationItems.count,  // All conversation items (turns + non-turns like system messages, function calls, etc.)
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

    // Parse tool name and emit status update
    let parts = toolName.components(separatedBy: "__")
    if parts.count == 2 {
      let group = parts[0]
      let name = parts[1]
      context.emitModuleEvent("onVoiceSessionStatus", [
        "status_update": "Tool called: \(group)/\(name)"
      ])
    } else {
      // Legacy tool format without group prefix
      context.emitModuleEvent("onVoiceSessionStatus", [
        "status_update": "Tool called: \(toolName)"
      ])
    }

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

      // Store the full transcript in our map and update the conversation item
      if let transcript = event["transcript"] as? String {
        conversationQueue.async {
          // Store in transcript map
          self.itemTranscripts[itemId] = transcript

          // Find and update the corresponding conversation item
          if let index = self.conversationItems.firstIndex(where: { $0.id == itemId }) {
            self.conversationItems[index].fullContent = transcript
            let isTurn = self.conversationItems[index].isTurn

            // Calculate total content length across all conversation items
            let totalContentLength = self.conversationItems.reduce(0) { $0 + ($1.fullContent?.count ?? 0) }
            
            self.logger.log(
              "[WebRTCEventHandler] Stored assistant transcript for item and updated conversation item",
              attributes: logAttributes(for: .debug, metadata: [
                "itemId": itemId,
                "transcript": transcript,
                "transcriptLength": transcript.count,
                "totalStoredTranscripts": self.itemTranscripts.count,
                "conversationItemUpdated": true,
                "isTurn": isTurn,
                "totalContentLength": totalContentLength,
                "maxContentLength": self.maxContentLength
              ])
            )

            // Check if we need to trigger compaction based on total content length
            if totalContentLength > self.maxContentLength {
              // Check if compaction/pruning is already in progress
              if self.compactionInProgress {
                self.logger.log(
                  "[WebRTCEventHandler] [ContentLimit] Compaction needed but already in progress, skipping",
                  attributes: logAttributes(for: .info, metadata: [
                    "totalContentLength": totalContentLength,
                    "maxContentLength": self.maxContentLength,
                    "totalConversationItems": self.conversationItems.count,
                    "overage": totalContentLength - self.maxContentLength
                  ])
                )
              } else {
                // Set flag to prevent duplicate compaction runs
                self.compactionInProgress = true

                // Build detailed turn list for debugging
                let turnDetails = self.getTurnDetails()

                let strategyName = self.useCompactionStrategy ? "compaction" : "pruning"
                self.logger.log(
                  "[WebRTCEventHandler] [ContentLimit] Triggering \(strategyName) after assistant transcript stored",
                  attributes: logAttributes(for: .info, metadata: [
                    "totalContentLength": totalContentLength,
                    "maxContentLength": self.maxContentLength,
                    "totalConversationItems": self.conversationItems.count,
                    "overage": totalContentLength - self.maxContentLength,
                    "strategy": strategyName,
                    "allTurns": turnDetails,
                    "turnItemCount": turnDetails.count
                  ])
                )

                // Use compaction strategy (always compact entire history when limit exceeded)
                if self.useCompactionStrategy {
                  Task { @MainActor in
                    await self.compactConversationItems(context: context)
                  }
                } else {
                  // Fallback to pruning if compaction disabled (already on conversationQueue, use Locked variant)
                  self.pruneOldestConversationItemsLocked(context: context, targetContentLength: self.maxContentLength)
                }
              }
            }
          } else {
            self.logger.log(
              "[WebRTCEventHandler] Stored assistant transcript for item (conversation item not found yet)",
              attributes: logAttributes(for: .debug, metadata: [
                "itemId": itemId,
                "transcript": transcript,
                "transcriptLength": transcript.count,
                "totalStoredTranscripts": self.itemTranscripts.count,
                "conversationItemUpdated": false
              ])
            )
          }
        }
      }
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
        "responseId": payload["responseId"] as Any,
        "itemId": payload["itemId"] as Any
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

      // Store the full transcript in our map and update the conversation item
      if let transcript = event["transcript"] as? String {
        conversationQueue.async {
          // Store in transcript map
          self.itemTranscripts[itemId] = transcript

          // Find and update the corresponding conversation item
          if let index = self.conversationItems.firstIndex(where: { $0.id == itemId }) {
            self.conversationItems[index].fullContent = transcript
            let isTurn = self.conversationItems[index].isTurn

            // Calculate total content length across all conversation items
            let totalContentLength = self.conversationItems.reduce(0) { $0 + ($1.fullContent?.count ?? 0) }
            
            self.logger.log(
              "[WebRTCEventHandler] Stored user transcript for item and updated conversation item",
              attributes: logAttributes(for: .debug, metadata: [
                "itemId": itemId,
                "transcript": transcript,
                "transcriptLength": transcript.count,
                "totalStoredTranscripts": self.itemTranscripts.count,
                "conversationItemUpdated": true,
                "isTurn": isTurn,
                "totalContentLength": totalContentLength,
                "maxContentLength": self.maxContentLength
              ])
            )

            // Check if we need to trigger compaction based on total content length
            if totalContentLength > self.maxContentLength {
              // Check if compaction/pruning is already in progress
              if self.compactionInProgress {
                self.logger.log(
                  "[WebRTCEventHandler] [ContentLimit] Compaction needed but already in progress, skipping",
                  attributes: logAttributes(for: .info, metadata: [
                    "totalContentLength": totalContentLength,
                    "maxContentLength": self.maxContentLength,
                    "totalConversationItems": self.conversationItems.count,
                    "overage": totalContentLength - self.maxContentLength
                  ])
                )
              } else {
                // Set flag to prevent duplicate compaction runs
                self.compactionInProgress = true

                // Build detailed turn list for debugging
                let turnDetails = self.getTurnDetails()

                let strategyName = self.useCompactionStrategy ? "compaction" : "pruning"
                self.logger.log(
                  "[WebRTCEventHandler] [ContentLimit] Triggering \(strategyName) after user transcript stored",
                  attributes: logAttributes(for: .info, metadata: [
                    "totalContentLength": totalContentLength,
                    "maxContentLength": self.maxContentLength,
                    "totalConversationItems": self.conversationItems.count,
                    "overage": totalContentLength - self.maxContentLength,
                    "strategy": strategyName,
                    "allTurns": turnDetails,
                    "turnItemCount": turnDetails.count
                  ])
                )

                // Use compaction strategy (always compact entire history when limit exceeded)
                if self.useCompactionStrategy {
                  Task { @MainActor in
                    await self.compactConversationItems(context: context)
                  }
                } else {
                  // Fallback to pruning if compaction disabled (already on conversationQueue, use Locked variant)
                  self.pruneOldestConversationItemsLocked(context: context, targetContentLength: self.maxContentLength)
                }
              }
            }
          } else {
            self.logger.log(
              "[WebRTCEventHandler] Stored user transcript for item (conversation item not found yet)",
              attributes: logAttributes(for: .debug, metadata: [
                "itemId": itemId,
                "transcript": transcript,
                "transcriptLength": transcript.count,
                "totalStoredTranscripts": self.itemTranscripts.count,
                "conversationItemUpdated": false
              ])
            )
          }
        }
      }
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

    // item_truncate_invalid_item_id errors are non-breaking - log as warning
    let isItemTruncateError = errorCode == "item_truncate_invalid_item_id"
    let logLevel: OpenAIWebRTCClient.NativeLogLevel = isItemTruncateError ? .warn : .error
    let logPrefix = isItemTruncateError ? "⚠️" : "❌"

    logger.log(
      "[WebRTCEventHandler] \(logPrefix) WebRTC event \(isItemTruncateError ? "warning" : "error")",
      attributes: logAttributes(for: logLevel, metadata: [
        "eventId": eventId as Any,
        "errorType": errorType as Any,
        "errorCode": errorCode as Any,
        "errorParam": errorParam as Any,
        "message": errorMessage as Any,
        "rawPayload": String(describing: event),
        "isItemTruncateError": isItemTruncateError
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

  /// Build detailed turn list for debugging
  private func getTurnDetails() -> [[String: Any]] {
    let turnItems = self.conversationItems.filter { $0.isTurn }
    return turnItems.map { item -> [String: Any] in
      var detail: [String: Any] = [
        "id": item.id,
        "turnNumber": item.turnNumber as Any,
        "role": item.role as Any,
        "type": item.type as Any,
        "createdAt": ISO8601DateFormatter().string(from: item.createdAt),
        "ageSeconds": String(format: "%.2f", Date().timeIntervalSince(item.createdAt))
      ]
      // Add full content if available (from fullContent or itemTranscripts map)
      if let fullContent = item.fullContent {
        detail["fullContent"] = fullContent
        detail["contentLength"] = fullContent.count
      } else if let fullTranscript = self.itemTranscripts[item.id] {
        detail["fullContent"] = fullTranscript
        detail["contentLength"] = fullTranscript.count
      }
      return detail
    }
  }

  func configureConversationTurnLimit(maxTurns: Int?) {
    conversationQueue.async {
      self.maxConversationTurns = maxTurns
      
      // Convert turn-based limit to content length (1428 chars per "turn")
      // This allows the UI slider to show "turns" while we actually limit by content length
      if let maxTurns = maxTurns {
        self.maxContentLength = maxTurns * 1428
      } else {
        self.maxContentLength = 10000  // Default
      }
      
      self.logger.log(
        "[WebRTCEventHandler] [TurnLimit] Configuration updated",
        attributes: logAttributes(for: .info, metadata: [
          "maxTurns": maxTurns as Any,
          "maxContentLength": self.maxContentLength,
          "enabled": maxTurns != nil
        ])
      )
    }
  }

  func resetConversationTracking() {
    conversationQueue.async {
      self.conversationItems.removeAll()
      self.conversationItemUniqueIds.removeAll()
      self.conversationTurnCount = 0
      self.compactionInProgress = false
      self.itemTranscripts.removeAll()
      self.logger.log(
        "[WebRTCEventHandler] [TurnLimit] Conversation tracking reset",
        attributes: logAttributes(for: .info, metadata: [
          "clearedTranscripts": true,
          "clearedUniqueIds": true
        ])
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
      // Check if item already exists to prevent duplicates
      guard !self.conversationItemUniqueIds.contains(itemId) else {
        self.logger.log(
          "[WebRTCEventHandler] [ItemCreated] Item already exists, skipping duplicate",
          attributes: logAttributes(for: .warn, metadata: [
            "itemId": itemId,
            "totalConversationItems": self.conversationItems.count,
            "totalUniqueIds": self.conversationItemUniqueIds.count
          ])
        )
        return
      }
      
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
            "totalConversationItems": self.conversationItems.count + 1,
            "maxTurns": self.maxConversationTurns as Any,
            "timestamp": ISO8601DateFormatter().string(from: Date())
          ])
        )
      }

      // Extract full content and snippet for logging
      var fullContent: String?
      var contentSnippet: String?
      if let content = item["content"] as? [[String: Any]] {
        // Content is an array of content blocks
        for contentBlock in content {
          if let text = contentBlock["text"] as? String, !text.isEmpty {
            fullContent = text
            contentSnippet = String(text.prefix(100))
            break
          } else if let transcript = contentBlock["transcript"] as? String, !transcript.isEmpty {
            fullContent = transcript
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
        fullContent: fullContent,
        contentSnippet: contentSnippet,
        turnNumber: turnNumber
      )
      self.conversationItems.append(conversationItem)
      self.conversationItemUniqueIds.insert(itemId)

      if isTurn {
        let ageInSeconds = Date().timeIntervalSince(conversationItem.createdAt)
        let totalContentLength = self.conversationItems.reduce(0) { $0 + ($1.fullContent?.count ?? 0) }
        let turnDetails = self.getTurnDetails()
        var metadata: [String: Any] = [
          "itemId": itemId,
          "role": role as Any,
          "turnNumber": turnNumber as Any,
          "turnCount": self.conversationTurnCount,
          "totalConversationItems": self.conversationItems.count,
          "totalContentLength": totalContentLength,
          "maxContentLength": self.maxContentLength,
          "position": self.conversationItems.count - 1,
          "createdAt": ISO8601DateFormatter().string(from: conversationItem.createdAt),
          "maxTurns": self.maxConversationTurns as Any,
          "allTurns": turnDetails,
          "turnItemCount": turnDetails.count
        ]
        if let content = fullContent {
          metadata["contentLength"] = content.count
          metadata["fullContent"] = content
        }
        self.logger.log(
          "[ContentLimit] Turn item created: \(itemId)",
          attributes: logAttributes(for: .debug, metadata: metadata)
        )

        // Note: Compaction will be triggered after the transcript is stored
        // We defer checking content limit until transcript arrives with full content
      } else {
        self.logger.log(
          "[WebRTCEventHandler] [ContentLimit] Non-turn item created",
          attributes: logAttributes(for: .trace, metadata: [
            "itemId": itemId,
            "role": item["role"] as Any,
            "type": item["type"] as Any,
            "totalConversationItems": self.conversationItems.count
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
        self.conversationItemUniqueIds.remove(itemId)
        
        // Remove transcript from itemTranscripts to prevent unbounded growth
        self.itemTranscripts.removeValue(forKey: itemId)

        // Decrement turn count if this was a turn item
        if item.isTurn {
          self.conversationTurnCount -= 1
        }

        var metadata: [String: Any] = [
          "itemId": itemId,
          "wasTurn": item.isTurn,
          "turnNumber": item.turnNumber as Any,
          "role": item.role as Any,
          "positionWas": index,
          "ageSeconds": String(format: "%.2f", ageInSeconds),
          "createdAt": formatter.string(from: item.createdAt),
          "remainingItems": self.conversationItems.count,
          "remainingTurns": self.conversationTurnCount,
          "remainingUniqueIds": self.conversationItemUniqueIds.count,
          "totalStoredTranscripts": self.itemTranscripts.count
        ]
        if let content = item.fullContent {
          metadata["contentLength"] = content.count
          metadata["fullContent"] = content
        }
        self.logger.log(
          "[WebRTCEventHandler] [TurnLimit] Item deleted confirmation",
          attributes: logAttributes(for: .info, metadata: metadata)
        )
      } else {
        // Item not found in tracking, but still remove from unique IDs set and transcripts if present
        let wasInUniqueIds = self.conversationItemUniqueIds.remove(itemId) != nil
        self.itemTranscripts.removeValue(forKey: itemId)
        
        self.logger.log(
          "[WebRTCEventHandler] [TurnLimit] Item deleted: \(itemId)",
          attributes: logAttributes(for: .warn, metadata: [
            "itemId": itemId,
            "wasInUniqueIds": wasInUniqueIds,
            "remainingUniqueIds": self.conversationItemUniqueIds.count,
            "totalStoredTranscripts": self.itemTranscripts.count
          ])
        )
      }
    }
  }

  // MARK: - Conversation Summarization

  /// Summarize a subset of the conversation into a compact system note.
  private func summarizeConversationItems(
    _ items: [ConversationItem]
  ) async throws -> String {
    let transcript = items
      .map { $0.transcriptLine }
      .joined(separator: "\n")

    let prompt = """
    You are a conversation memory compressor.

    Summarize the following conversation history into a concise, **factual** memory
    that preserves:
    - user goals and preferences
    - open tasks / TODOs
    - any important decisions or constraints
    - URLs can be helpful, but be judicious about including them since they take up space

    Avoid fluff. Use neutral third-person.

    Target length: compress it to approximately 20% of the original length, while trying
    to keep important details, especially user goals and preferences, and specific items
    that were returned by the tool (like a list of retrieved files, documents, or other 
    resources).

    Conversation:
    \(transcript)
    """

    let request = ResponsesRequest(
      model: "gpt-4o-mini",
      input: prompt
    )

    // Build safe item representation for logging (no full content)
    let itemsForLogging = items.map { item -> [String: Any] in
      var dict: [String: Any] = [
        "id": item.id,
        "isTurn": item.isTurn,
        "createdAt": ISO8601DateFormatter().string(from: item.createdAt)
      ]
      if let role = item.role { dict["role"] = role }
      if let type = item.type { dict["type"] = type }
      if let content = item.fullContent {
        dict["fullContent"] = content
        dict["contentLength"] = content.count
      }
      if let turnNum = item.turnNumber { dict["turnNumber"] = turnNum }
      return dict
    }

    logger.log(
      "[WebRTCEventHandler] [Compact] Sending summarization request to OpenAI",
      attributes: logAttributes(for: .info, metadata: [
        "model": request.model,
        "promptLength": request.input.count,
        "itemCount": items.count,
        "items": itemsForLogging,
        "prompt": request.input
      ])
    )

    guard let url = URL(string: "https://api.openai.com/v1/responses") else {
      throw NSError(domain: "OpenAI", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
    }

    var urlRequest = URLRequest(url: url)
    urlRequest.httpMethod = "POST"
    
    guard let apiKey = self.getApiKey() else {
      throw NSError(
        domain: "OpenAI",
        code: -3,
        userInfo: [NSLocalizedDescriptionKey: "API key not set in WebRTCEventHandler"]
      )
    }
    
    urlRequest.addValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    urlRequest.addValue("application/json", forHTTPHeaderField: "Content-Type")
    urlRequest.httpBody = try JSONEncoder().encode(request)

    let (data, response) = try await URLSession.shared.data(for: urlRequest)

    if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
      let body = String(data: data, encoding: .utf8) ?? "<no body>"
      throw NSError(
        domain: "OpenAI",
        code: http.statusCode,
        userInfo: [NSLocalizedDescriptionKey: "OpenAI error \(http.statusCode): \(body)"]
      )
    }

    let decoded = try JSONDecoder().decode(ResponsesResponse.self, from: data)

    // Extract text from polymorphic response: output[0] (message) -> content[0] (output_text) -> text
    guard
      let firstOutputItem = decoded.output.first,
      case .message(let messageOutput) = firstOutputItem,
      let firstContentPart = messageOutput.content.first,
      case .outputText(let textContent) = firstContentPart
    else {
      throw NSError(domain: "OpenAI", code: -2, userInfo: [NSLocalizedDescriptionKey: "No text output from model"])
    }

    return textContent.text
  }

  // MARK: - Conversation Pruning Strategies

  /// Async wrapper for pruning - schedules work on conversationQueue
  private func pruneOldestConversationItems(context: ToolContext, targetContentLength: Int) {
    conversationQueue.async {
      self.pruneOldestConversationItemsLocked(context: context, targetContentLength: targetContentLength)
    }
  }

  /// Prune oldest conversation items - MUST be called while already on conversationQueue
  private func pruneOldestConversationItemsLocked(context: ToolContext, targetContentLength: Int) {
    // Already on conversationQueue, access properties directly
    let currentContentLength = self.conversationItems.reduce(0) { $0 + ($1.fullContent?.count ?? 0) }
    let overage = currentContentLength - targetContentLength

    guard overage > 0 else {
      self.logger.log(
        "[WebRTCEventHandler] [ContentLimit] No pruning needed",
        attributes: logAttributes(for: .debug, metadata: [
          "currentContentLength": currentContentLength,
          "targetContentLength": targetContentLength
        ])
      )
      return
    }

    let conversationItemsCount = self.conversationItems.count

    self.logger.log(
      "[WebRTCEventHandler] [ContentLimit] Starting to prune oldest conversation items",
      attributes: logAttributes(for: .info, metadata: [
        "currentContentLength": currentContentLength,
        "targetContentLength": targetContentLength,
        "overage": overage,
        "totalConversationItems": conversationItemsCount
      ])
    )

    var itemsToDelete: [(item: ConversationItem, position: Int)] = []
    var contentRemoved = 0
    let now = Date()
    let formatter = ISO8601DateFormatter()

    // Iterate from oldest (front of array) and collect items to delete until we're under limit
    let conversationItemsSnapshot = self.conversationItems

    for (index, item) in conversationItemsSnapshot.enumerated() {
      let itemContentLength = item.fullContent?.count ?? 0
      itemsToDelete.append((item, index))
      contentRemoved += itemContentLength

      let ageInSeconds = now.timeIntervalSince(item.createdAt)
      var metadata: [String: Any] = [
        "itemId": item.id,
        "isTurn": item.isTurn,
        "turnNumber": item.turnNumber as Any,
        "role": item.role as Any,
        "position": index,
        "contentLength": itemContentLength,
        "contentRemovedSoFar": contentRemoved,
        "overageTarget": overage,
        "ageSeconds": String(format: "%.2f", ageInSeconds),
        "createdAt": formatter.string(from: item.createdAt)
      ]
      if let content = item.fullContent {
        metadata["fullContent"] = content
      }
      
      self.logger.log(
        "[WebRTCEventHandler] [ContentLimit] Marking item for deletion",
        attributes: logAttributes(for: .info, metadata: metadata)
      )

      // Stop once we've removed enough content to get under the limit
      if contentRemoved >= overage {
        break
      }
    }

    self.logger.log(
      "[WebRTCEventHandler] [ContentLimit] Identified items to prune",
      attributes: logAttributes(for: .info, metadata: [
        "itemsToDelete": itemsToDelete.count,
        "contentRemoved": contentRemoved,
        "overage": overage,
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
        "createdAt": formatter.string(from: item.createdAt)
      ]
      if let content = item.fullContent {
        metadata["contentLength"] = content.count
        metadata["fullContent"] = content
      }

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
          "[ContentLimit] Sending prune delete event for item: \(item.id)",
          attributes: logAttributes(for: .debug, metadata: metadata)
        )
      }

      DispatchQueue.main.async {
        context.sendDataChannelMessage(deleteEvent)
      }
    }

    // Clear the compaction flag after pruning is complete
    self.compactionInProgress = false
    
    // Note: Turn count and items will be decremented as delete confirmations come in
    self.logger.log(
      "[WebRTCEventHandler] [ContentLimit] Prune delete events sent, awaiting confirmations",
      attributes: logAttributes(for: .info, metadata: [
        "itemsSent": itemsToDelete.count,
        "contentRemoved": contentRemoved,
        "compactionInProgress": self.compactionInProgress
      ])
    )
  }

  /// Compact the ENTIRE conversation history into a summarized system item.
  ///
  /// Strategy:
  /// - Take ALL conversation items (entire history) and replace them with a single summary system message.
  /// - This reduces the conversation context to a compact summary when the content limit is exceeded.
  /// - The summary preserves key information: user goals, preferences, decisions, and open tasks.
  ///
  /// Assumptions:
  /// - `conversationItems` is ordered oldest → newest.
  /// - Compaction is triggered when total content length exceeds maxContentLength.
  @MainActor
  func compactConversationItems(context: ToolContext) async {
    let totalContentLength = conversationQueue.sync {
      self.conversationItems.reduce(0) { $0 + ($1.fullContent?.count ?? 0) }
    }
    
    guard totalContentLength > maxContentLength else {
      self.logger.log(
        "[WebRTCEventHandler] [Compact] No compaction needed",
        attributes: logAttributes(for: .debug, metadata: [
          "totalContentLength": totalContentLength,
          "maxContentLength": self.maxContentLength
        ])
      )
      return
    }

    let now = Date()
    let formatter = ISO8601DateFormatter()

    // Log conversation items metadata before processing (safe preview only)
    let allItemsForLogging = conversationQueue.sync {
      self.conversationItems.enumerated().map { (index, item) -> [String: Any] in
        var detail: [String: Any] = [
          "index": index,
          "id": item.id,
          "isTurn": item.isTurn,
          "role": item.role as Any,
          "type": item.type as Any,
          "turnNumber": item.turnNumber as Any,
          "createdAt": formatter.string(from: item.createdAt),
          "ageSeconds": String(format: "%.2f", now.timeIntervalSince(item.createdAt))
        ]
        if let content = item.fullContent {
          // Only log length and safe preview (first 100 chars)
          detail["contentLength"] = content.count
          detail["contentPreview"] = String(content.prefix(100))
        }
        return detail
      }
    }

    let (itemCount, turnCount) = conversationQueue.sync {
      (self.conversationItems.count, self.conversationTurnCount)
    }

    self.logger.log(
      "[WebRTCEventHandler] [Compact] All conversation items before compaction",
      attributes: logAttributes(for: .info, metadata: [
        "totalItems": itemCount,
        "totalTurns": turnCount,
        "totalContentLength": totalContentLength,
        "maxContentLength": self.maxContentLength,
        "allItems": allItemsForLogging
      ])
    )

    // 1) Compact ALL conversation items (entire history)
    // Strategy: Replace all existing conversation items with a single summary
    let itemsToCompact: [(item: ConversationItem, index: Int)] = conversationQueue.sync {
      self.conversationItems.enumerated().map { ($0.element, $0.offset) }
    }
    let compactOnlyItems = itemsToCompact.map { $0.item }

    // Nothing to compact (shouldn't happen because of guard above, but be safe)
    guard !itemsToCompact.isEmpty else {
      self.logger.log(
        "[WebRTCEventHandler] [Compact] No items identified for compaction",
        attributes: logAttributes(for: .debug)
      )
      return
    }

    // Build safe logging for compaction candidates (no full content)
    let compactCandidates = itemsToCompact.map { (item, index) -> [String: Any] in
      var detail: [String: Any] = [
        "index": index,
        "id": item.id,
        "isTurn": item.isTurn,
        "role": item.role as Any,
        "type": item.type as Any,
        "turnNumber": item.turnNumber as Any,
        "createdAt": formatter.string(from: item.createdAt),
        "ageSeconds": String(format: "%.2f", now.timeIntervalSince(item.createdAt))
      ]
      if let content = item.fullContent {
        // Only log length and safe preview (first 100 chars)
        detail["contentLength"] = content.count
        detail["contentPreview"] = String(content.prefix(100))
      }
      return detail
    }

    self.logger.log(
      "[WebRTCEventHandler] [Compact] Compaction selection logic completed",
      attributes: logAttributes(for: .info, metadata: [
        "selectionStrategy": "Compact ENTIRE conversation history into a single summary",
        "totalContentLength": totalContentLength,
        "maxContentLength": self.maxContentLength,
        "itemsToCompact": compactOnlyItems.count,
        "turnsToCompact": compactOnlyItems.filter { $0.isTurn }.count,
        "compactionCandidates": compactCandidates
      ])
    )

    // Emit status update: starting compaction
    context.emitModuleEvent("onVoiceSessionStatus", [
      "status_update": "Compacting \(compactOnlyItems.count) items"
    ])

    // 2) Ask gpt-4o to summarize that older slice.
    let summaryText: String
    do {
      summaryText = try await summarizeConversationItems(compactOnlyItems)
    } catch {
      self.logger.log(
        "[WebRTCEventHandler] [Compact] Summarization failed, falling back to raw prune",
        attributes: logAttributes(for: .error, metadata: [
          "error": String(describing: error)
        ])
      )

      // If summarization fails, fall back to your existing pruning strategy
      pruneOldestConversationItems(context: context, targetContentLength: self.maxContentLength)
      return
    }

    self.logger.log(
      "[WebRTCEventHandler] [Compact] Summarization succeeded",
      attributes: logAttributes(for: .info, metadata: [
        "summaryLength": summaryText.count,
        "compactedItemCount": compactOnlyItems.count,
        "summaryText": summaryText
      ])
    )

    // 3) Insert a single system "summary" item FIRST before deleting old context
    // This prevents "rug-pulling" the context from the AI
    let summaryWithPreamble = "We are still in the same conversation, but here is a summary since we will be deleting old context. Ignore this for now, it's just for providing context for later messages:\n\n\(summaryText)"
    
    let summaryEvent: [String: Any] = [
      "type": "conversation.item.create",
      "previous_item_id": "root",  // Insert at conversation root as foundational context
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

    self.logger.log(
      "[WebRTCEventHandler] [Compact] Sending summary system item (before deletion)",
      attributes: logAttributes(for: .info, metadata: [
        "summaryText": summaryWithPreamble,
        "summaryLength": summaryWithPreamble.count
      ])
    )

    context.sendDataChannelMessage(summaryEvent)

    // 4) Now delete the compacted items from the Realtime conversation.
    for (item, index) in itemsToCompact {
      let deleteEvent: [String: Any] = [
        "type": "conversation.item.delete",
        "item_id": item.id
      ]

      let ageInSeconds = now.timeIntervalSince(item.createdAt)

      var metadata: [String: Any] = [
        "itemId": item.id,
        "position": index,
        "itemType": item.type as Any,
        "itemRole": item.role as Any,
        "isTurn": item.isTurn,
        "turnNumber": item.turnNumber as Any,
        "ageSeconds": String(format: "%.2f", ageInSeconds),
        "createdAt": formatter.string(from: item.createdAt)
      ]
      if let content = item.fullContent {
        metadata["contentLength"] = content.count
        metadata["fullContent"] = content
      }

      if item.type == "function_call" {
        metadata["WARNING"] = "DELETING FUNCTION CALL - call_id will become invalid"
        metadata["potentiallyOrphanedCallId"] = item.id

        self.logger.log(
          "🚨 [COMPACT_DELETE_FUNCTION_CALL] Deleting function_call item during compaction",
          attributes: logAttributes(for: .warn, metadata: metadata)
        )
      } else {
        self.logger.log(
          "[Compact] Sending delete event for item: \(item.id)",
          attributes: logAttributes(for: .debug, metadata: metadata)
        )
      }

      context.sendDataChannelMessage(deleteEvent)
    }

    // Build list of deleted item IDs for logging
    let deletedItemIds = itemsToCompact.map { $0.item.id }.joined(separator: ", ")

    self.logger.log(
      "[WebRTCEventHandler] [Compact] Delete events sent for compacted items",
      attributes: logAttributes(for: .info, metadata: [
        "deletedItemCount": itemsToCompact.count,
        "deletedItemIds": deletedItemIds
      ])
    )

    // Emit status update: compaction complete
    context.emitModuleEvent("onVoiceSessionStatus", [
      "status_update": "Compacted \(itemsToCompact.count) items"
    ])

    // 5) Reset our local tracking immediately after compaction
    // Remove all the items we just deleted from our local tracking
    conversationQueue.sync {
      // Remove compacted items from our local array
      let compactedIds = Set(itemsToCompact.map { $0.item.id })
      self.conversationItems.removeAll { compactedIds.contains($0.id) }
      
      // Remove compacted IDs from unique ID tracking
      self.conversationItemUniqueIds.subtract(compactedIds)
      
      // Remove transcripts for compacted items to prevent unbounded growth
      for itemId in compactedIds {
        self.itemTranscripts.removeValue(forKey: itemId)
      }
      
      // Recalculate turn count from remaining items
      self.conversationTurnCount = self.conversationItems.filter { $0.isTurn }.count
      
      // Clear the compaction flag now that we're done
      self.compactionInProgress = false
      
      self.logger.log(
        "[WebRTCEventHandler] [Compact] Local tracking reset after compaction",
        attributes: logAttributes(for: .info, metadata: [
          "remainingItems": self.conversationItems.count,
          "remainingTurns": self.conversationTurnCount,
          "remainingUniqueIds": self.conversationItemUniqueIds.count,
          "deletedItems": compactedIds.count,
          "totalStoredTranscripts": self.itemTranscripts.count,
          "compactionInProgress": self.compactionInProgress
        ])
      )
    }
    
    // Note: The summary system item will be added back to our tracking
    // when we receive the conversation.item.created event from the server.
  }

  private func deleteAllConversationItems(context: ToolContext) {
    let itemsToDelete = conversationQueue.sync {
      self.conversationItems.map { $0.id }
    }

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

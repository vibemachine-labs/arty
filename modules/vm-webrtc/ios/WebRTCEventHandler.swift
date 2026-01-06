import Foundation

final class WebRTCEventHandler {

    // Default inactivity threshold (seconds) before auto-disconnect
    // Set to 8 minutes because idle timer doesn't integrate with state machine.
    // NOTE: When idle timeout fires, it does NOT inform the rest of the app that
    // the call has been disconnected (e.g., audio tool sounds will keep playing).
    // TODO: Integrate with state machine to properly notify all components.
    static let defaultIdleTimeout: TimeInterval = 480

    struct ToolContext {
        let githubConnectorDelegate: BaseTool?
        let gdriveConnectorDelegate: BaseTool?
        let gpt5GDriveFixerDelegate: BaseTool?
        let gpt5WebSearchDelegate: BaseTool?
        let toolkitHelper: ToolkitHelper?
        let audioMixPlayer: AudioMixPlayer?
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
    private var compactionInProgress: Bool = false  // Prevent duplicate compaction runs
    private var disableCompaction: Bool = false  // Disable compaction completely when true
    private let conversationQueue = DispatchQueue(
        label: "com.vibemachine.webrtc.conversation-tracker")
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

    // MARK: - Response State Machine
    // Track whether a response is currently in progress to detect "conversation_already_has_active_response" errors
    private let responseStateQueue = DispatchQueue(label: "com.vibemachine.webrtc.response-state")
    private var responseInProgress: Bool = false
    private var currentResponseId: String?

    // Queued response.create - max one item with 30 second TTL
    private var queuedResponseCreate: (trigger: String, timestamp: Date)?
    private let queuedResponseTTL: TimeInterval = 30.0

    // Callback to send response.create when queue is processed
    var sendResponseCreateCallback: (() -> Bool)?

    // MARK: - Assistant Audio Streaming State
    // Track when assistant audio is actively streaming (more precise than response state)
    // This provides extra protection against audio overlap based on lower-level OpenAI events:
    // - output_audio_buffer.started (WebRTC mode): server begins streaming audio to client
    // - response.audio.delta: model-generated audio chunks are arriving
    private let audioStreamingQueue = DispatchQueue(label: "com.vibemachine.webrtc.audio-streaming")
    private var assistantAudioStreaming: Bool = false

    // MARK: - Function Call State Tracking
    // Track streaming function call arguments per call_id
    // Maps call_id -> accumulated arguments JSON string
    private let functionCallQueue = DispatchQueue(label: "com.vibemachine.webrtc.function-calls")
    private var streamingFunctionCallArguments: [String: String] = [:]
    private var activeFunctionCallIds: Set<String> = []

    // MARK: - Shadow State Machine (Observational Only)
    // This Actor observes events and logs state transitions for debugging.
    // It does NOT control any behavior - purely for validation and debugging.
    private let shadowStateMachine = ConversationStateMachine()

    /// Check if a response is currently in progress.
    /// Returns true if response in progress, false otherwise.
    func checkResponseInProgress() -> Bool {
        return responseStateQueue.sync {
            return responseInProgress
        }
    }

    /// Get the current response ID being tracked.
    /// Returns nil if no response is in progress.
    /// Useful for race condition tracing - compare this with error messages from OpenAI.
    func getCurrentResponseId() -> String? {
        return responseStateQueue.sync {
            return currentResponseId
        }
    }

    /// Check if assistant audio is currently streaming.
    /// This is a more precise indicator than response state, based on lower-level OpenAI events.
    /// Returns true if audio is streaming, false otherwise.
    func checkAssistantAudioStreaming() -> Bool {
        return audioStreamingQueue.sync {
            return assistantAudioStreaming
        }
    }

    /// Queue a response.create to be sent when the current response completes.
    /// Overwrites any previously queued item (max queue size = 1).
    func queueResponseCreate(trigger: String) {
        responseStateQueue.async {
            let previousQueued = self.queuedResponseCreate
            self.queuedResponseCreate = (trigger: trigger, timestamp: Date())

            self.logger.log(
                "📥 [ResponseStateMachine] Queued response.create (response in progress)",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "trigger": trigger,
                        "currentResponseId": self.currentResponseId as Any,
                        "previousQueuedTrigger": previousQueued?.trigger as Any,
                        "ttlSeconds": self.queuedResponseTTL,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
        }
    }

    /// Mark that a response.create was sent. Called after successfully sending response.create.
    func didSendResponseCreate(trigger: String) {
        responseStateQueue.async {
            let wasInProgress = self.responseInProgress
            self.responseInProgress = true
            self.logger.log(
                "[ResponseStateMachine] Response create sent, marking response in progress",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "trigger": trigger,
                        "wasInProgress": wasInProgress,
                        "nowInProgress": true,
                        "threadId": Thread.current.description,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
        }
    }

    /// Reset response state machine. Call when connection closes or session ends.
    func resetResponseState() {
        responseStateQueue.async {
            self.responseInProgress = false
            self.currentResponseId = nil
            self.queuedResponseCreate = nil
            self.logger.log(
                "[ResponseStateMachine] Response state reset",
                attributes: logAttributes(for: .debug)
            )
        }
    }

    /// Reset audio streaming state. Call when connection closes or session ends.
    func resetAudioStreamingState() {
        audioStreamingQueue.async {
            self.assistantAudioStreaming = false
            self.logger.log(
                "[AudioStreamingState] Audio streaming state reset",
                attributes: logAttributes(for: .debug)
            )
        }
    }

    // MARK: - Shadow State Machine Observation Helpers
    // These methods allow external callers (like OpenAIWebRTCClient) to notify the shadow state machine

    /// Notify shadow state machine that a response.create is about to be sent
    func shadowObserve_willSendResponseCreate(trigger: String) {
        Task {
            await shadowStateMachine.shadow_willSendResponseCreate(trigger: trigger)
        }
    }

    /// Notify shadow state machine that a tool result is about to be sent
    func shadowObserve_willSendToolResult(callId: String) {
        let actualResponseInProgress = checkResponseInProgress()
        Task {
            await shadowStateMachine.shadow_willSendToolResult(
                callId: callId, actualResponseInProgress: actualResponseInProgress)
        }
    }

    /// Notify shadow state machine that a tool call has completed
    func shadowObserve_didCompleteToolCall(callId: String) {
        Task {
            await shadowStateMachine.shadow_didCompleteToolCall(callId: callId)
        }
    }

    /// Notify shadow state machine that tool audio start was attempted
    func shadowObserve_didAttemptStartToolAudio(prefix: String, wasBlocked: Bool) {
        let actualStreaming = checkAssistantAudioStreaming()
        Task {
            await shadowStateMachine.shadow_didAttemptStartToolAudio(
                prefix: prefix, wasBlocked: wasBlocked, actualAssistantStreaming: actualStreaming)
        }
    }

    /// Notify shadow state machine that tool audio was stopped
    func shadowObserve_didStopToolAudio(reason: String) {
        Task {
            await shadowStateMachine.shadow_didStopToolAudio(reason: reason)
        }
    }

    /// Reset shadow state machine (e.g., on disconnect)
    func shadowObserve_reset(reason: String) {
        Task {
            await shadowStateMachine.shadow_reset(reason: reason)
        }
    }

    /// Reset function call streaming state. Call when connection closes or session ends.
    func resetFunctionCallState() {
        functionCallQueue.async {
            let hadPendingCalls = !self.activeFunctionCallIds.isEmpty
            self.streamingFunctionCallArguments.removeAll()
            self.activeFunctionCallIds.removeAll()
            if hadPendingCalls {
                self.logger.log(
                    "[FunctionCall] Cleared pending function call state",
                    attributes: logAttributes(for: .warn, metadata: ["reason": "connection_reset"])
                )
            } else {
                self.logger.log(
                    "[FunctionCall] Function call state reset",
                    attributes: logAttributes(for: .debug)
                )
            }
        }
    }

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
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
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
            "payloadDescription": String(describing: event),
        ]
        logger.log(
            "[WebRTCEventHandler] WebRTC event received",
            attributes: logAttributes(for: .trace, metadata: metadata)
        )

        switch eventType {
        case "error":
            handleErrorEvent(event, context: context)
        case "response.created":
            handleResponseCreatedEvent(event, context: context)
        case "response.function_call_arguments.delta":
            handleFunctionCallArgumentsDeltaEvent(event, context: context)
        case "response.function_call_arguments.done":
            handleFunctionCallArgumentsDoneEvent(event, context: context)
        case "response.output_item.added":
            handleOutputItemAddedEvent(event, context: context)
        case "response.output_item.done":
            handleOutputItemDoneEvent(event, context: context)
        case "response.usage":
            handleTokenUsageEvent(event, context: context)
        case "response.done":
            handleResponseDoneEvent(event, context: context)
        case "response.cancelled":
            handleResponseCancelledEvent(event, context: context)
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
        case "response.audio.delta":
            handleAssistantAudioDeltaEvent(event, context: context)
        case "response.audio.done":
            handleAssistantAudioDoneEvent(event, context: context)
        case "output_audio_buffer.started":
            handleOutputAudioBufferStartedEvent(event, context: context)
        case "output_audio_buffer.done":
            handleOutputAudioBufferDoneEvent(event, context: context)
        case "input_audio_buffer.speech_started":
            handleInputAudioBufferSpeechStartedEvent(event, context: context)
        case "input_audio_buffer.speech_stopped":
            handleInputAudioBufferSpeechStoppedEvent(event, context: context)
        case "input_audio_buffer.cleared":
            handleInputAudioBufferClearedEvent(event, context: context)
        default:
            logger.log(
                "[WebRTCEventHandler] Unhandled WebRTC event",
                attributes: logAttributes(for: .trace, metadata: ["type": eventType])
            )
        }
    }

    func startIdleMonitoring(
        timeout: TimeInterval = WebRTCEventHandler.defaultIdleTimeout,
        onTimeout: @escaping () -> Void
    ) {
        idleQueue.async {
            self.idleTimeoutSeconds = max(timeout, 1)
            self.idleTimeoutHandler = onTimeout
            self.isIdleMonitoringActive = true
            self.lastActivityAt = Date()
            self.logger.log(
                "[WebRTCEventHandler] [IdleTimer] Monitoring started",
                attributes: logAttributes(
                    for: .info, metadata: ["timeoutSeconds": self.idleTimeoutSeconds])
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
                    attributes: logAttributes(
                        for: .warn,
                        metadata: [
                            "itemId": itemId,
                            "role": role,
                            "type": type,
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
                attributes: logAttributes(
                    for: .info,
                    metadata: [
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
                        "createdAt": ISO8601DateFormatter().string(from: Date()),
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
            "session.ping",
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
            "speech.",
        ]

        if activityPrefixes.contains(where: { eventType.hasPrefix($0) }) {
            return true
        }

        // Fallback: treat deltas or completion markers as activity
        if eventType.contains("delta") || eventType.contains("done") || eventType.contains("error")
        {
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
                    "timeoutSeconds": self.idleTimeoutSeconds,
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
                    "timeoutSeconds": idleTimeoutSeconds,
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
                    "secondsRemaining": "\(Int(remaining))/\(Int(idleTimeoutSeconds))",
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
                    "lastActivityAt": lastActivity as Any,
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

    // MARK: - Function Call Event Handlers
    // These handlers track function call streaming and completion based on OpenAI Realtime API events

    /// Handles response.function_call_arguments.delta - streaming function call arguments
    /// Arguments arrive incrementally and are accumulated until .done event
    private func handleFunctionCallArgumentsDeltaEvent(_ event: [String: Any], context: ToolContext)
    {
        guard let callId = event["call_id"] as? String,
            let delta = event["delta"] as? String
        else {
            logger.log(
                "[WebRTCEventHandler] function_call_arguments.delta event missing required fields",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
            )
            return
        }

        let itemId = event["item_id"] as? String
        let outputIndex = event["output_index"] as? Int

        functionCallQueue.async {
            // Accumulate arguments for this call
            let existingArgs = self.streamingFunctionCallArguments[callId] ?? ""
            self.streamingFunctionCallArguments[callId] = existingArgs + delta
            self.activeFunctionCallIds.insert(callId)

            self.logger.log(
                "[FunctionCall] Arguments streaming (delta)",
                attributes: logAttributes(
                    for: .trace,
                    metadata: [
                        "callId": callId,
                        "itemId": itemId as Any,
                        "outputIndex": outputIndex as Any,
                        "deltaLength": delta.count,
                        "accumulatedLength": self.streamingFunctionCallArguments[callId]?.count
                            ?? 0,
                        "deltaPreview": String(delta.prefix(100)),
                    ])
            )
        }
    }

    /// Handles response.function_call_arguments.done - function call arguments complete
    /// This triggers the actual tool execution
    private func handleFunctionCallArgumentsDoneEvent(_ event: [String: Any], context: ToolContext)
    {
        guard let callId = event["call_id"] as? String,
            let toolName = event["name"] as? String,
            let argumentsJSON = event["arguments"] as? String
        else {
            logger.log(
                "[WebRTCEventHandler] Tool call event missing required fields",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
            )
            return
        }

        let itemId = event["item_id"] as? String
        let outputIndex = event["output_index"] as? Int

        // Check if we have accumulated streaming arguments for this call
        var wasStreaming = false
        var streamedLength = 0
        functionCallQueue.sync {
            if let accumulated = self.streamingFunctionCallArguments[callId] {
                wasStreaming = true
                streamedLength = accumulated.count
                // Clean up streaming state now that arguments are done
                self.streamingFunctionCallArguments.removeValue(forKey: callId)
                self.activeFunctionCallIds.remove(callId)
            }
        }

        // Enhanced logging at tool call start with conversation state
        conversationQueue.async {
            self.logger.log(
                "🔨 [TOOL_DISPATCH_START] Tool call received and dispatching",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "callId": callId,
                        "itemId": itemId as Any,
                        "outputIndex": outputIndex as Any,
                        "toolName": toolName,
                        "arguments_length": argumentsJSON.count,
                        "arguments_preview": String(argumentsJSON.prefix(1000)),
                        "wasStreaming": wasStreaming,
                        "streamedChunksLength": streamedLength,
                        "totalConversationItems": self.conversationItems.count,
                        "currentTurnCount": self.conversationTurnCount,
                        "maxTurns": self.maxConversationTurns as Any,
                        "dispatchTimestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
        }

        logger.log(
            "[FunctionCall] Arguments complete - executing tool",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "callId": callId,
                    "name": toolName,
                    "arguments_length": argumentsJSON.count,
                    "arguments_preview": String(argumentsJSON.prefix(1000)),
                    "wasStreaming": wasStreaming,
                    "streamedChunksLength": streamedLength,
                ])
        )

        // Parse tool name and emit status update
        let parts = toolName.components(separatedBy: "__")
        if parts.count == 2 {
            let group = parts[0]
            let name = parts[1]
            context.emitModuleEvent(
                "onVoiceSessionStatus",
                [
                    "status_update": "Tool called: \(group)/\(name)"
                ])
        } else {
            // Legacy tool format without group prefix
            context.emitModuleEvent(
                "onVoiceSessionStatus",
                [
                    "status_update": "Tool called: \(toolName)"
                ])
        }

        // Play audio feedback when tool is called (mixing with WebRTC audio)
        // Loop random beeps until we get a response
        context.audioMixPlayer?.startLoopingRandomBeeps(prefix: "artybeeps")

        // SHADOW: Observe tool call
        let actualStreaming = checkAssistantAudioStreaming()
        Task {
            await shadowStateMachine.shadow_didReceiveToolCall(
                callId: callId, toolName: toolName, actualAssistantStreaming: actualStreaming)
        }

        respondToToolCall(
            callId: callId, toolName: toolName, argumentsJSON: argumentsJSON, context: context)
    }

    /// Handles response.output_item.added - new output item created during response
    /// Output items can be messages, function calls, or other response content
    private func handleOutputItemAddedEvent(_ event: [String: Any], context: ToolContext) {
        guard let item = event["item"] as? [String: Any],
            let itemId = item["id"] as? String,
            let itemType = item["type"] as? String
        else {
            logger.log(
                "[WebRTCEventHandler] output_item.added event missing required fields",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
            )
            return
        }

        let responseId = event["response_id"] as? String
        let outputIndex = event["output_index"] as? Int

        logger.log(
            "[OutputItem] Item added to response",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "itemId": itemId,
                    "itemType": itemType,
                    "responseId": responseId as Any,
                    "outputIndex": outputIndex as Any,
                    "status": item["status"] as Any,
                ])
        )

        // If it's a function call, log additional details
        if itemType == "function_call" {
            let callId = item["call_id"] as? String
            let name = item["name"] as? String
            logger.log(
                "[OutputItem] Function call output item added",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "itemId": itemId,
                        "callId": callId as Any,
                        "functionName": name as Any,
                        "responseId": responseId as Any,
                        "outputIndex": outputIndex as Any,
                    ])
            )
        }
    }

    /// Handles response.output_item.done - output item completed
    /// Signals that an output item (message, function call, etc.) has finished streaming
    private func handleOutputItemDoneEvent(_ event: [String: Any], context: ToolContext) {
        guard let item = event["item"] as? [String: Any],
            let itemId = item["id"] as? String,
            let itemType = item["type"] as? String
        else {
            logger.log(
                "[WebRTCEventHandler] output_item.done event missing required fields",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
            )
            return
        }

        let responseId = event["response_id"] as? String
        let outputIndex = event["output_index"] as? Int

        logger.log(
            "[OutputItem] Item completed",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "itemId": itemId,
                    "itemType": itemType,
                    "responseId": responseId as Any,
                    "outputIndex": outputIndex as Any,
                    "status": item["status"] as Any,
                ])
        )

        // If it's a function call, log completion with full details
        if itemType == "function_call" {
            let callId = item["call_id"] as? String
            let name = item["name"] as? String
            let arguments = item["arguments"] as? String
            let status = item["status"] as? String

            logger.log(
                "[OutputItem] Function call output item completed",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "itemId": itemId,
                        "callId": callId as Any,
                        "functionName": name as Any,
                        "status": status as Any,
                        "argumentsLength": arguments?.count as Any,
                        "responseId": responseId as Any,
                        "outputIndex": outputIndex as Any,
                    ])
            )
        }

        // If it's a message, log message details
        if itemType == "message" {
            let role = item["role"] as? String
            let status = item["status"] as? String

            logger.log(
                "[OutputItem] Message output item completed",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "itemId": itemId,
                        "role": role as Any,
                        "status": status as Any,
                        "responseId": responseId as Any,
                        "outputIndex": outputIndex as Any,
                    ])
            )
        }
    }

    private func handleTokenUsageEvent(_ event: [String: Any], context: ToolContext) {
        guard let response = event["response"] as? [String: Any],
            let usage = response["usage"] as? [String: Any]
        else {
            logger.log(
                "[WebRTCEventHandler] response.usage event missing response.usage field",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
            )
            return
        }

        let responseId = response["id"] as? String
        logger.log(
            "[WebRTCEventHandler] Incremental token usage received",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "responseId": responseId as Any,
                    "usage": String(describing: usage),
                ])
        )

        emitTokenUsage(usage: usage, responseId: responseId, context: context)
    }

    private func handleResponseCreatedEvent(_ event: [String: Any], context: ToolContext) {
        guard let response = event["response"] as? [String: Any] else {
            logger.log(
                "[WebRTCEventHandler] response.created event missing response field",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
            )
            return
        }

        let responseId = response["id"] as? String
        let status = response["status"] as? String

        // Shorten response ID for log message (e.g., "resp_Cr9Qsg8m..." from "resp_Cr9Qsg8mw7CLQ1KOdxzfq")
        let shortResponseId =
            responseId.map { id in
                id.count > 12 ? "\(id.prefix(12))..." : id
            } ?? "nil"

        // Update response state machine
        responseStateQueue.async {
            self.responseInProgress = true
            self.currentResponseId = responseId
            self.logger.log(
                "🎬 [ResponseStateMachine] Response created (\(shortResponseId)), now in progress",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "responseId": responseId as Any,
                        "status": status as Any,
                        "responseInProgress": true,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
        }

        logger.log(
            "🎬 [WebRTCEventHandler] Response created (\(shortResponseId))",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "responseId": responseId as Any,
                    "status": status as Any,
                ])
        )

        // Stop any playing audio when the other side starts speaking
        context.audioMixPlayer?.stop()

        // SHADOW: Observe response.created event
        Task {
            await shadowStateMachine.shadow_didReceiveResponseCreated(responseId: responseId)
        }
    }

    private func handleResponseDoneEvent(_ event: [String: Any], context: ToolContext) {
        guard let response = event["response"] as? [String: Any] else {
            logger.log(
                "[WebRTCEventHandler] response.done event missing response field",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
            )
            return
        }

        let responseId = response["id"] as? String
        let status = response["status"] as? String

        // Update response state machine - response is complete
        responseStateQueue.async {
            let wasInProgress = self.responseInProgress
            self.responseInProgress = false
            self.currentResponseId = nil

            // Check for queued response.create
            var queuedToSend: (trigger: String, timestamp: Date)?
            if let queued = self.queuedResponseCreate {
                let age = Date().timeIntervalSince(queued.timestamp)
                if age <= self.queuedResponseTTL {
                    queuedToSend = queued
                } else {
                    self.logger.log(
                        "⏰ [ResponseStateMachine] Queued response.create expired",
                        attributes: logAttributes(
                            for: .warn,
                            metadata: [
                                "trigger": queued.trigger,
                                "ageSeconds": age,
                                "ttlSeconds": self.queuedResponseTTL,
                                "timestamp": ISO8601DateFormatter().string(from: Date()),
                            ])
                    )
                }
                self.queuedResponseCreate = nil
            }

            // Shorten response ID for log message
            let shortRespId =
                responseId.map { id in
                    id.count > 12 ? "\(id.prefix(12))..." : id
                } ?? "nil"

            self.logger.log(
                "🏁 [ResponseStateMachine] Response done (\(shortRespId)), no longer in progress",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "responseId": responseId as Any,
                        "status": status as Any,
                        "wasInProgress": wasInProgress,
                        "responseInProgress": false,
                        "hasQueuedResponse": queuedToSend != nil,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )

            // Send queued response.create if valid
            if let queued = queuedToSend {
                self.logger.log(
                    "📤 [ResponseStateMachine] Sending queued response.create",
                    attributes: logAttributes(
                        for: .info,
                        metadata: [
                            "trigger": queued.trigger,
                            "queuedAgeSeconds": Date().timeIntervalSince(queued.timestamp),
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
                        ])
                )

                // Mark as in progress before sending
                self.responseInProgress = true

                // Send via callback
                DispatchQueue.main.async {
                    if let callback = self.sendResponseCreateCallback {
                        let sent = callback()
                        if sent {
                            self.logger.log(
                                "✅ [ResponseStateMachine] Queued response.create sent successfully",
                                attributes: logAttributes(
                                    for: .info,
                                    metadata: [
                                        "trigger": queued.trigger
                                    ])
                            )
                        } else {
                            self.logger.log(
                                "❌ [ResponseStateMachine] Failed to send queued response.create",
                                attributes: logAttributes(
                                    for: .error,
                                    metadata: [
                                        "trigger": queued.trigger
                                    ])
                            )
                            // Reset state since send failed
                            self.responseStateQueue.async {
                                self.responseInProgress = false
                            }
                        }
                    } else {
                        self.logger.log(
                            "❌ [ResponseStateMachine] No sendResponseCreateCallback configured",
                            attributes: logAttributes(
                                for: .error,
                                metadata: [
                                    "trigger": queued.trigger
                                ])
                        )
                        // Reset state since we couldn't send
                        self.responseStateQueue.async {
                            self.responseInProgress = false
                        }
                    }
                }
            }
        }

        // Extract additional response details per OpenAI docs
        let eventId = event["event_id"] as? String
        let statusDetails = response["status_details"]
        let conversationId = response["conversation_id"] as? String
        let outputModalities = response["output_modalities"] as? [String]
        let output = response["output"] as? [[String: Any]]

        // Extract transcript from output items if available
        var transcripts: [String] = []
        if let outputItems = output {
            for item in outputItems {
                if let content = item["content"] as? [[String: Any]] {
                    for contentItem in content {
                        if let transcript = contentItem["transcript"] as? String {
                            transcripts.append(transcript)
                        }
                    }
                }
            }
        }

        // Prominent log for response.done event - always emitted when response completes
        logger.log(
            "✅🏁 [WebRTCEventHandler] response.done - Response streaming complete",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "eventType": "response.done",
                    "eventId": eventId as Any,
                    "responseId": responseId as Any,
                    "status": status as Any,
                    "statusDetails": String(describing: statusDetails),
                    "conversationId": conversationId as Any,
                    "outputModalities": outputModalities as Any,
                    "outputItemCount": output?.count as Any,
                    "transcripts": transcripts,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ])
        )

        if let usage = response["usage"] as? [String: Any] {
            logger.log(
                "[WebRTCEventHandler] Token usage received",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "responseId": responseId as Any,
                        "usage": String(describing: usage),
                    ])
            )
            emitTokenUsage(usage: usage, responseId: responseId, context: context)
        }

        // SHADOW: Observe response.done event
        Task {
            await shadowStateMachine.shadow_didReceiveResponseDone(
                responseId: responseId, status: status)
        }
    }

    private func handleResponseCancelledEvent(_ event: [String: Any], context: ToolContext) {
        let responseId = event["response_id"] as? String

        // Update response state machine - response was cancelled
        responseStateQueue.async {
            let wasInProgress = self.responseInProgress
            self.responseInProgress = false
            self.currentResponseId = nil
            self.logger.log(
                "[ResponseStateMachine] Response cancelled, no longer in progress",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "responseId": responseId as Any,
                        "wasInProgress": wasInProgress,
                        "responseInProgress": false,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
        }

        logger.log(
            "[WebRTCEventHandler] Response cancelled",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "responseId": responseId as Any
                ])
        )

        // SHADOW: Observe response.cancelled event
        Task {
            await shadowStateMachine.shadow_didReceiveResponseCancelled(responseId: responseId)
        }
    }

    // MARK: - Assistant Audio Streaming Event Handlers
    // These handlers provide precise tracking of when assistant audio is actively streaming
    // Based on OpenAI Realtime API (WebRTC) lower-level events

    /// Handles response.audio.delta event - model-generated audio chunks are arriving
    /// This is the most reliable cross-platform indicator that audio is streaming
    private func handleAssistantAudioDeltaEvent(_ event: [String: Any], context: ToolContext) {
        let responseId = event["response_id"] as? String

        audioStreamingQueue.async {
            if !self.assistantAudioStreaming {
                self.assistantAudioStreaming = true
                self.logger.log(
                    "🖥️✅ [Event-SpeakingDetection] Assistant audio streaming started (audio.delta)",
                    attributes: logAttributes(
                        for: .info,
                        metadata: [
                            "eventType": "response.audio.delta",
                            "detectionType": "event-based",
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
                        ])
                )
                // Stop any playing audio immediately when we detect audio chunks
                context.audioMixPlayer?.stop()
            }
        }

        // SHADOW: Observe audio.delta event
        let actualStreaming = checkAssistantAudioStreaming()
        Task {
            await shadowStateMachine.shadow_didReceiveAudioDelta(
                responseId: responseId, actualAssistantStreaming: actualStreaming)
        }
    }

    /// Handles response.audio.done event - audio streaming is complete
    private func handleAssistantAudioDoneEvent(_ event: [String: Any], context: ToolContext) {
        audioStreamingQueue.async {
            self.assistantAudioStreaming = false
            self.logger.log(
                "🖥️🔇 [Event-SpeakingDetection] Assistant audio streaming ended (audio.done)",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "eventType": "response.audio.done",
                        "detectionType": "event-based",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
        }

        // SHADOW: Observe audio.done event
        let actualStreaming = checkAssistantAudioStreaming()
        Task {
            await shadowStateMachine.shadow_didReceiveAudioDone(
                actualAssistantStreaming: actualStreaming)
        }
    }

    /// Handles output_audio_buffer.started event (WebRTC-specific)
    /// Server begins streaming audio to the client - the most precise indicator
    private func handleOutputAudioBufferStartedEvent(_ event: [String: Any], context: ToolContext) {
        audioStreamingQueue.async {
            if !self.assistantAudioStreaming {
                self.assistantAudioStreaming = true
                self.logger.log(
                    "🖥️✅ [Event-SpeakingDetection] Assistant audio streaming started (buffer.started)",
                    attributes: logAttributes(
                        for: .info,
                        metadata: [
                            "eventType": "output_audio_buffer.started",
                            "detectionType": "event-based",
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
                        ])
                )
                // Stop any playing audio immediately when buffer streaming starts
                context.audioMixPlayer?.stop()
            }
        }

        // SHADOW: Observe buffer.started event
        let actualStreaming = checkAssistantAudioStreaming()
        Task {
            await shadowStateMachine.shadow_didReceiveOutputAudioBufferStarted(
                actualAssistantStreaming: actualStreaming)
        }
    }

    /// Handles output_audio_buffer.done event (WebRTC-specific)
    /// Audio buffer streaming is complete
    private func handleOutputAudioBufferDoneEvent(_ event: [String: Any], context: ToolContext) {
        audioStreamingQueue.async {
            self.assistantAudioStreaming = false
            self.logger.log(
                "🖥️🔇 [Event-SpeakingDetection] Assistant audio streaming ended (buffer.done)",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "eventType": "output_audio_buffer.done",
                        "detectionType": "event-based",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
        }

        // SHADOW: Observe buffer.done event
        let actualStreaming = checkAssistantAudioStreaming()
        Task {
            await shadowStateMachine.shadow_didReceiveOutputAudioBufferDone(
                actualAssistantStreaming: actualStreaming)
        }
    }

    // MARK: - Input Audio Buffer Event Handlers
    // These handlers track user speech detection events from server VAD

    /// Handles input_audio_buffer.speech_started event
    /// Server detected speech in the audio buffer (server_vad mode)
    private func handleInputAudioBufferSpeechStartedEvent(
        _ event: [String: Any], context: ToolContext
    ) {
        let eventId = event["event_id"] as? String
        let itemId = event["item_id"] as? String
        let audioStartMs = event["audio_start_ms"] as? Int

        logger.log(
            "🎤✅ [Event-SpeakingDetection] User speech started (server VAD)",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "eventType": "input_audio_buffer.speech_started",
                    "detectionType": "event-based (server VAD)",
                    "eventId": eventId as Any,
                    "itemId": itemId as Any,
                    "audioStartMs": audioStartMs as Any,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ])
        )

        // SHADOW: Observe user speech started
        Task {
            await shadowStateMachine.shadow_didReceiveUserSpeechStarted()
        }
    }

    /// Handles input_audio_buffer.speech_stopped event
    /// Server detected end of speech in the audio buffer (server_vad mode)
    private func handleInputAudioBufferSpeechStoppedEvent(
        _ event: [String: Any], context: ToolContext
    ) {
        let eventId = event["event_id"] as? String
        let itemId = event["item_id"] as? String
        let audioEndMs = event["audio_end_ms"] as? Int

        logger.log(
            "🎤🔇 [Event-SpeakingDetection] User speech stopped (server VAD)",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "eventType": "input_audio_buffer.speech_stopped",
                    "detectionType": "event-based (server VAD)",
                    "eventId": eventId as Any,
                    "itemId": itemId as Any,
                    "audioEndMs": audioEndMs as Any,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ])
        )

        // SHADOW: Observe user speech stopped
        Task {
            await shadowStateMachine.shadow_didReceiveUserSpeechStopped()
        }
    }

    /// Handles input_audio_buffer.cleared event
    /// Input audio buffer was cleared by the client
    private func handleInputAudioBufferClearedEvent(_ event: [String: Any], context: ToolContext) {
        let eventId = event["event_id"] as? String

        logger.log(
            "🎤🗑️ [Event-SpeakingDetection] Input audio buffer cleared",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "eventType": "input_audio_buffer.cleared",
                    "detectionType": "event-based",
                    "eventId": eventId as Any,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ])
        )

        // SHADOW: Observe input buffer cleared
        Task {
            await shadowStateMachine.shadow_didReceiveInputAudioBufferCleared()
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

    private func handleTranscriptDeltaEvent(
        _ event: [String: Any], context: ToolContext, type: String
    ) {
        var payload: [String: Any] = [
            "type": type,
            "isDone": false,
            "timestampMs": Int(Date().timeIntervalSince1970 * 1000),
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
            attributes: logAttributes(
                for: .trace,
                metadata: [
                    "type": type,
                    "delta": payload["delta"] as Any,
                    "responseId": payload["responseId"] as Any,
                ])
        )

        context.emitModuleEvent("onTranscript", payload)
    }

    private func handleTranscriptDoneEvent(
        _ event: [String: Any], context: ToolContext, type: String
    ) {
        var payload: [String: Any] = [
            "type": type,
            "isDone": true,
            "timestampMs": Int(Date().timeIntervalSince1970 * 1000),
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
                        let totalContentLength = self.conversationItems.reduce(0) {
                            $0 + ($1.fullContent?.count ?? 0)
                        }

                        self.logger.log(
                            "💬 [WebRTCEventHandler] Stored assistant transcript for item and updated conversation item",
                            attributes: logAttributes(
                                for: .debug,
                                metadata: [
                                    "itemId": itemId,
                                    "transcript": transcript,
                                    "transcriptLength": transcript.count,
                                    "totalStoredTranscripts": self.itemTranscripts.count,
                                    "conversationItemUpdated": true,
                                    "isTurn": isTurn,
                                    "totalContentLength": totalContentLength,
                                    "maxContentLength": self.maxContentLength,
                                ])
                        )

                        // Check if we need to trigger compaction based on total content length
                        if totalContentLength > self.maxContentLength {
                            // Check if compaction/pruning is already in progress
                            if self.compactionInProgress {
                                self.logger.log(
                                    "[WebRTCEventHandler] [ContentLimit] Compaction needed but already in progress, skipping",
                                    attributes: logAttributes(
                                        for: .info,
                                        metadata: [
                                            "totalContentLength": totalContentLength,
                                            "maxContentLength": self.maxContentLength,
                                            "totalConversationItems": self.conversationItems.count,
                                            "overage": totalContentLength - self.maxContentLength,
                                        ])
                                )
                            } else {
                                // Set flag to prevent duplicate compaction runs
                                self.compactionInProgress = true

                                // Build detailed turn list for debugging
                                let turnDetails = self.getTurnDetails()

                                self.logger.log(
                                    "[WebRTCEventHandler] [ContentLimit] Triggering compaction after assistant transcript stored",
                                    attributes: logAttributes(
                                        for: .info,
                                        metadata: [
                                            "totalContentLength": totalContentLength,
                                            "maxContentLength": self.maxContentLength,
                                            "totalConversationItems": self.conversationItems.count,
                                            "overage": totalContentLength - self.maxContentLength,
                                            "allTurns": turnDetails,
                                            "turnItemCount": turnDetails.count,
                                        ])
                                )

                                // Trigger compaction (always compact entire history when limit exceeded)
                                Task {
                                    await self.compactConversationItems(context: context)
                                }
                            }
                        }
                    } else {
                        self.logger.log(
                            "💬 [WebRTCEventHandler] Stored assistant transcript for item (conversation item not found yet)",
                            attributes: logAttributes(
                                for: .debug,
                                metadata: [
                                    "itemId": itemId,
                                    "transcript": transcript,
                                    "transcriptLength": transcript.count,
                                    "totalStoredTranscripts": self.itemTranscripts.count,
                                    "conversationItemUpdated": false,
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
            "💬 [WebRTCEventHandler] Transcript complete (assistant)",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "type": type,
                    "speaker": "assistant",
                    "transcriptLength": (payload["transcript"] as? String)?.count as Any,
                    "transcript": payload["transcript"] as Any,
                    "responseId": payload["responseId"] as Any,
                    "itemId": payload["itemId"] as Any,
                ])
        )

        context.emitModuleEvent("onTranscript", payload)
    }

    private func handleInputAudioTranscriptionCompleted(
        _ event: [String: Any], context: ToolContext
    ) {
        var payload: [String: Any] = [
            "type": "input_audio_transcription",
            "isDone": true,
            "timestampMs": Int(Date().timeIntervalSince1970 * 1000),
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
                        let totalContentLength = self.conversationItems.reduce(0) {
                            $0 + ($1.fullContent?.count ?? 0)
                        }

                        self.logger.log(
                            "[WebRTCEventHandler] Stored user transcript for item and updated conversation item",
                            attributes: logAttributes(
                                for: .debug,
                                metadata: [
                                    "itemId": itemId,
                                    "transcript": transcript,
                                    "transcriptLength": transcript.count,
                                    "totalStoredTranscripts": self.itemTranscripts.count,
                                    "conversationItemUpdated": true,
                                    "isTurn": isTurn,
                                    "totalContentLength": totalContentLength,
                                    "maxContentLength": self.maxContentLength,
                                ])
                        )

                        // Check if we need to trigger compaction based on total content length
                        if totalContentLength > self.maxContentLength {
                            // Check if compaction/pruning is already in progress
                            if self.compactionInProgress {
                                self.logger.log(
                                    "[WebRTCEventHandler] [ContentLimit] Compaction needed but already in progress, skipping",
                                    attributes: logAttributes(
                                        for: .info,
                                        metadata: [
                                            "totalContentLength": totalContentLength,
                                            "maxContentLength": self.maxContentLength,
                                            "totalConversationItems": self.conversationItems.count,
                                            "overage": totalContentLength - self.maxContentLength,
                                        ])
                                )
                            } else {
                                // Set flag to prevent duplicate compaction runs
                                self.compactionInProgress = true

                                // Build detailed turn list for debugging
                                let turnDetails = self.getTurnDetails()

                                self.logger.log(
                                    "[WebRTCEventHandler] [ContentLimit] Triggering compaction after user transcript stored",
                                    attributes: logAttributes(
                                        for: .info,
                                        metadata: [
                                            "totalContentLength": totalContentLength,
                                            "maxContentLength": self.maxContentLength,
                                            "totalConversationItems": self.conversationItems.count,
                                            "overage": totalContentLength - self.maxContentLength,
                                            "allTurns": turnDetails,
                                            "turnItemCount": turnDetails.count,
                                        ])
                                )

                                // Trigger compaction (always compact entire history when limit exceeded)
                                Task {
                                    await self.compactConversationItems(context: context)
                                }
                            }
                        }
                    } else {
                        self.logger.log(
                            "[WebRTCEventHandler] Stored user transcript for item (conversation item not found yet)",
                            attributes: logAttributes(
                                for: .debug,
                                metadata: [
                                    "itemId": itemId,
                                    "transcript": transcript,
                                    "transcriptLength": transcript.count,
                                    "totalStoredTranscripts": self.itemTranscripts.count,
                                    "conversationItemUpdated": false,
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
                "💬 [WebRTCEventHandler] Transcript complete (user)",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "type": "input_audio_transcription",
                        "speaker": "user",
                        "transcriptLength": transcriptText.count,
                        "transcript": String(transcriptText),
                        "itemId": payload["itemId"] as Any,
                    ])
            )
        } else {
            logger.log(
                "💬 [WebRTCEventHandler] Transcript complete (user, empty)",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
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

        // Check for conversation_already_has_active_response error
        let isActiveResponseError = errorCode == "conversation_already_has_active_response"
        if isActiveResponseError {
            // Get current response state for debugging
            let (inProgress, currentId) = responseStateQueue.sync {
                (self.responseInProgress, self.currentResponseId)
            }

            logger.log(
                "🚨 [ResponseStateMachine] DETECTED: conversation_already_has_active_response error",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "eventId": eventId as Any,
                        "errorType": errorType as Any,
                        "errorCode": errorCode as Any,
                        "errorMessage": errorMessage as Any,
                        "stateMachine_responseInProgress": inProgress,
                        "stateMachine_currentResponseId": currentId as Any,
                        "analysis":
                            "response.create was sent while another response was still in progress",
                        "recommendation":
                            "Check logs for '[ResponseStateMachine] Attempting to send response.create' warnings",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )

            // Notify shadow state machine about this critical error for analysis and recovery
            Task {
                await shadowStateMachine.shadow_didReceiveActiveResponseError(
                    eventId: eventId as? String,
                    errorMessage: errorMessage,
                    blockedByResponseId: currentId
                )
            }

            // Also emit to module for visibility
            context.emitModuleEvent("onRealtimeError", event)
            return
        }

        // item_truncate_invalid_item_id errors are non-breaking - log as warning
        let isItemTruncateError = errorCode == "item_truncate_invalid_item_id"
        let logLevel: OpenAIWebRTCClient.NativeLogLevel = isItemTruncateError ? .warn : .error
        let logPrefix = isItemTruncateError ? "⚠️" : "❌"

        logger.log(
            "[WebRTCEventHandler] \(logPrefix) WebRTC event \(isItemTruncateError ? "warning" : "error")",
            attributes: logAttributes(
                for: logLevel,
                metadata: [
                    "eventId": eventId as Any,
                    "errorType": errorType as Any,
                    "errorCode": errorCode as Any,
                    "errorParam": errorParam as Any,
                    "message": errorMessage as Any,
                    "rawPayload": String(describing: event),
                    "isItemTruncateError": isItemTruncateError,
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
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "callId": callId,
                    "tool": toolName,
                    "arguments_length": argumentsJSON.count,
                    "arguments_preview": String(argumentsJSON.prefix(1000)),
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
                "ageSeconds": String(format: "%.2f", Date().timeIntervalSince(item.createdAt)),
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
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "maxTurns": maxTurns as Any,
                        "maxContentLength": self.maxContentLength,
                        "enabled": maxTurns != nil,
                    ])
            )
        }
    }

    func configureDisableCompaction(disabled: Bool) {
        conversationQueue.async {
            self.disableCompaction = disabled

            self.logger.log(
                "[WebRTCEventHandler] [Compaction] Configuration updated",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "disableCompaction": disabled
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
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "clearedTranscripts": true,
                        "clearedUniqueIds": true,
                    ])
            )
        }
        // Also reset response state machine
        resetResponseState()
    }

    private func handleConversationItemCreated(_ event: [String: Any], context: ToolContext) {
        guard let item = event["item"] as? [String: Any],
            let itemId = item["id"] as? String
        else {
            logger.log(
                "[WebRTCEventHandler] [TurnLimit] conversation.item.created missing item.id",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
            )
            return
        }

        conversationQueue.async {
            // Check if item already exists to prevent duplicates
            guard !self.conversationItemUniqueIds.contains(itemId) else {
                self.logger.log(
                    "[WebRTCEventHandler] [ItemCreated] Item already exists, skipping duplicate",
                    attributes: logAttributes(
                        for: .warn,
                        metadata: [
                            "itemId": itemId,
                            "totalConversationItems": self.conversationItems.count,
                            "totalUniqueIds": self.conversationItemUniqueIds.count,
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
                    attributes: logAttributes(
                        for: .info,
                        metadata: [
                            "itemId": itemId,
                            "callId": itemId,  // For function_call items, itemId IS the call_id
                            "role": role as Any,
                            "currentTurnCount": self.conversationTurnCount,
                            "totalConversationItems": self.conversationItems.count + 1,
                            "maxTurns": self.maxConversationTurns as Any,
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
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
                    } else if let transcript = contentBlock["transcript"] as? String,
                        !transcript.isEmpty
                    {
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
                let totalContentLength = self.conversationItems.reduce(0) {
                    $0 + ($1.fullContent?.count ?? 0)
                }
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
                    "turnItemCount": turnDetails.count,
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
                    attributes: logAttributes(
                        for: .trace,
                        metadata: [
                            "itemId": itemId,
                            "role": item["role"] as Any,
                            "type": item["type"] as Any,
                            "totalConversationItems": self.conversationItems.count,
                        ])
                )
            }
        }
    }

    private func handleConversationItemDeleted(_ event: [String: Any], context: ToolContext) {
        guard let itemId = event["item_id"] as? String else {
            logger.log(
                "[WebRTCEventHandler] [TurnLimit] conversation.item.deleted missing item_id",
                attributes: logAttributes(
                    for: .warn, metadata: ["event": String(describing: event)])
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
                    "totalStoredTranscripts": self.itemTranscripts.count,
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
                    attributes: logAttributes(
                        for: .debug,
                        metadata: [
                            "itemId": itemId,
                            "wasInUniqueIds": wasInUniqueIds,
                            "remainingUniqueIds": self.conversationItemUniqueIds.count,
                            "totalStoredTranscripts": self.itemTranscripts.count,
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
        let transcript =
            items
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

            Try to preserve any navigation related metadata that could be related to tool
            state, for example which page of results the tool is currently on.

            For the daily_papers tool in particular, the papers_seen=[] list is crucial
            to preserve since it has the paper ids that will be used in future tool calls.

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
                "createdAt": ISO8601DateFormatter().string(from: item.createdAt),
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
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "model": request.model,
                    "promptLength": request.input.count,
                    "itemCount": items.count,
                    "items": itemsForLogging,
                    "prompt": request.input,
                ])
        )

        guard let url = URL(string: "https://api.openai.com/v1/responses") else {
            throw NSError(
                domain: "OpenAI", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
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
            throw NSError(
                domain: "OpenAI", code: -2,
                userInfo: [NSLocalizedDescriptionKey: "No text output from model"])
        }

        return textContent.text
    }

    // MARK: - Conversation Compaction

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
    func compactConversationItems(context: ToolContext) async {
        // Check if compaction is disabled
        let isDisabled = conversationQueue.sync { self.disableCompaction }
        guard !isDisabled else {
            self.logger.log(
                "[WebRTCEventHandler] [Compact] Compaction is disabled by user setting",
                attributes: logAttributes(for: .debug)
            )
            return
        }

        let totalContentLength = conversationQueue.sync {
            self.conversationItems.reduce(0) { $0 + ($1.fullContent?.count ?? 0) }
        }

        guard totalContentLength > maxContentLength else {
            self.logger.log(
                "[WebRTCEventHandler] [Compact] No compaction needed",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "totalContentLength": totalContentLength,
                        "maxContentLength": self.maxContentLength,
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
                    "ageSeconds": String(format: "%.2f", now.timeIntervalSince(item.createdAt)),
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
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "totalItems": itemCount,
                    "totalTurns": turnCount,
                    "totalContentLength": totalContentLength,
                    "maxContentLength": self.maxContentLength,
                    "allItems": allItemsForLogging,
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
                "ageSeconds": String(format: "%.2f", now.timeIntervalSince(item.createdAt)),
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
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "selectionStrategy":
                        "Compact ENTIRE conversation history into a single summary",
                    "totalContentLength": totalContentLength,
                    "maxContentLength": self.maxContentLength,
                    "itemsToCompact": compactOnlyItems.count,
                    "turnsToCompact": compactOnlyItems.filter { $0.isTurn }.count,
                    "compactionCandidates": compactCandidates,
                ])
        )

        // Emit status update: starting compaction (on main queue for UI updates)
        await MainActor.run {
            context.emitModuleEvent(
                "onVoiceSessionStatus",
                [
                    "status_update": "Compacting \(compactOnlyItems.count) items"
                ])
        }

        // 2) Ask gpt-4o to summarize that older slice.
        let summaryText: String
        do {
            summaryText = try await summarizeConversationItems(compactOnlyItems)
        } catch {
            self.logger.log(
                "[WebRTCEventHandler] [Compact] Summarization failed, aborting compaction",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "error": String(describing: error)
                    ])
            )

            // Clear compaction flag on error
            conversationQueue.async {
                self.compactionInProgress = false
            }
            return
        }

        self.logger.log(
            "[WebRTCEventHandler] [Compact] Summarization succeeded",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "summaryLength": summaryText.count,
                    "compactedItemCount": compactOnlyItems.count,
                    "summaryText": summaryText,
                ])
        )

        // 3) Insert a single system "summary" item FIRST before deleting old context
        // This prevents "rug-pulling" the context from the AI
        let summaryWithPreamble =
            "We are still in the same conversation, but here is a summary since we will be deleting old context. No action needed, and do not repeat your greeting, just keep the conversation flowing like a natural assistant. \n\n\(summaryText)"

        let summaryEvent: [String: Any] = [
            "type": "conversation.item.create",
            "previous_item_id": "root",  // Insert at conversation root as foundational context
            "item": [
                "type": "message",
                "role": "system",
                "content": [
                    [
                        "type": "input_text",
                        "text": summaryWithPreamble,
                    ]
                ],
            ],
        ]

        self.logger.log(
            "[WebRTCEventHandler] [Compact] Sending summary system item (before deletion)",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "summaryText": summaryWithPreamble,
                    "summaryLength": summaryWithPreamble.count,
                ])
        )

        await MainActor.run {
            context.sendDataChannelMessage(summaryEvent)
        }

        // 4) Now delete the compacted items from the Realtime conversation.
        for (item, index) in itemsToCompact {
            let deleteEvent: [String: Any] = [
                "type": "conversation.item.delete",
                "item_id": item.id,
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
                "createdAt": formatter.string(from: item.createdAt),
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

            await MainActor.run {
                context.sendDataChannelMessage(deleteEvent)
            }
        }

        // Build list of deleted item IDs for logging
        let deletedItemIds = itemsToCompact.map { $0.item.id }.joined(separator: ", ")

        self.logger.log(
            "[WebRTCEventHandler] [Compact] Delete events sent for compacted items",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "deletedItemCount": itemsToCompact.count,
                    "deletedItemIds": deletedItemIds,
                ])
        )

        // Emit status update: compaction complete (on main queue for UI updates)
        await MainActor.run {
            context.emitModuleEvent(
                "onVoiceSessionStatus",
                [
                    "status_update": "Compacted \(itemsToCompact.count) items"
                ])
        }

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
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "remainingItems": self.conversationItems.count,
                        "remainingTurns": self.conversationTurnCount,
                        "remainingUniqueIds": self.conversationItemUniqueIds.count,
                        "deletedItems": compactedIds.count,
                        "totalStoredTranscripts": self.itemTranscripts.count,
                        "compactionInProgress": self.compactionInProgress,
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
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "itemCount": itemsToDelete.count
                ])
        )

        // Send delete event for each item
        for itemId in itemsToDelete {
            let deleteEvent: [String: Any] = [
                "type": "conversation.item.delete",
                "item_id": itemId,
            ]

            self.logger.log(
                "[WebRTCEventHandler] [TurnLimit] Sending delete event",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
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
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "itemsSent": itemsToDelete.count
                ])
        )
    }
}

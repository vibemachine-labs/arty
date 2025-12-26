import Foundation

/// Shadow state machine for observing and validating WebRTC conversation flow.
///
/// This Actor observes the same events as the current handlers but does NOT control anything.
/// It tracks what the state SHOULD be and logs transitions for debugging and validation.
///
/// Purpose:
/// - Validate the proposed unified state model before migration
/// - Detect inconsistencies between shadow state and actual behavior
/// - Provide comprehensive logging of conversation flow
/// - Build confidence in the new architecture
///
/// All methods are prefixed with `shadow_` to make it clear they are observational only.
actor ConversationStateMachine {

    // MARK: - Types

    /// The phase of assistant response
    enum ResponsePhase: Equatable, CustomStringConvertible {
        case idle
        case inProgress(responseId: String?)
        case streaming(responseId: String?)  // Audio actively streaming

        var description: String {
            switch self {
            case .idle:
                return "idle"
            case .inProgress(let id):
                return "inProgress(\(id ?? "nil"))"
            case .streaming(let id):
                return "streaming(\(id ?? "nil"))"
            }
        }

        var isActive: Bool {
            switch self {
            case .idle: return false
            case .inProgress, .streaming: return true
            }
        }

        var isStreaming: Bool {
            if case .streaming = self { return true }
            return false
        }

        var responseId: String? {
            switch self {
            case .idle: return nil
            case .inProgress(let id), .streaming(let id): return id
            }
        }
    }

    /// Tool call execution state
    enum ToolCallPhase: Equatable, CustomStringConvertible {
        case idle
        case executing(callId: String, toolName: String)
        case awaitingAudioStart(callId: String, toolName: String)  // Blocked, waiting for assistant to stop
        case playingAudio(callId: String, toolName: String)

        var description: String {
            switch self {
            case .idle:
                return "idle"
            case .executing(let id, let name):
                return "executing(\(name):\(id.prefix(8)))"
            case .awaitingAudioStart(let id, let name):
                return "awaitingAudioStart(\(name):\(id.prefix(8)))"
            case .playingAudio(let id, let name):
                return "playingAudio(\(name):\(id.prefix(8)))"
            }
        }

        var isExecuting: Bool {
            switch self {
            case .idle: return false
            default: return true
            }
        }

        var callId: String? {
            switch self {
            case .idle: return nil
            case .executing(let id, _),
                .awaitingAudioStart(let id, _),
                .playingAudio(let id, _):
                return id
            }
        }

        var toolName: String? {
            switch self {
            case .idle: return nil
            case .executing(_, let name),
                .awaitingAudioStart(_, let name),
                .playingAudio(_, let name):
                return name
            }
        }
    }

    /// User speech state
    enum UserSpeechPhase: Equatable, CustomStringConvertible {
        case idle
        case speaking(startedAt: Date)

        var description: String {
            switch self {
            case .idle:
                return "idle"
            case .speaking(let startedAt):
                let duration = Date().timeIntervalSince(startedAt)
                return "speaking(\(String(format: "%.1fs", duration)))"
            }
        }

        var isSpeaking: Bool {
            if case .speaking = self { return true }
            return false
        }
    }

    /// Queued response request
    struct QueuedResponse: Equatable, CustomStringConvertible {
        let trigger: String
        let timestamp: Date

        var description: String {
            let age = Date().timeIntervalSince(timestamp)
            return "QueuedResponse(\(trigger), age: \(String(format: "%.1fs", age)))"
        }

        func isExpired(ttl: TimeInterval) -> Bool {
            Date().timeIntervalSince(timestamp) > ttl
        }
    }

    /// Snapshot of current state for logging
    struct StateSnapshot: CustomStringConvertible {
        let response: ResponsePhase
        let toolCall: ToolCallPhase
        let userSpeech: UserSpeechPhase
        let queuedResponse: QueuedResponse?
        let timestamp: Date

        var description: String {
            var parts = [
                "response: \(response)",
                "toolCall: \(toolCall)",
                "userSpeech: \(userSpeech)",
            ]
            if let queued = queuedResponse {
                parts.append("queued: \(queued.trigger)")
            }
            return "State(\(parts.joined(separator: ", ")))"
        }

        var canSendResponseCreate: Bool {
            !response.isActive
        }

        var canAddConversationItem: Bool {
            !response.isActive
        }

        var isAssistantSpeaking: Bool {
            response.isStreaming
        }

        var shouldToolAudioBeBlocked: Bool {
            response.isStreaming
        }
    }

    // MARK: - State

    private(set) var responsePhase: ResponsePhase = .idle
    private(set) var toolCallPhase: ToolCallPhase = .idle
    private(set) var userSpeechPhase: UserSpeechPhase = .idle
    private var queuedResponse: QueuedResponse? = nil

    private let queuedResponseTTL: TimeInterval = 30.0
    private let logger = VmWebrtcLogging.logger

    /// Emoji prefix for all shadow logs
    private let logPrefix = "🔮"

    /// Track transition count for debugging
    private var transitionCount: Int = 0

    // MARK: - State Queries

    var snapshot: StateSnapshot {
        StateSnapshot(
            response: responsePhase,
            toolCall: toolCallPhase,
            userSpeech: userSpeechPhase,
            queuedResponse: queuedResponse,
            timestamp: Date()
        )
    }

    // MARK: - Shadow Event Handlers (Response Lifecycle)

    /// Shadow observer for response.create being sent
    func shadow_willSendResponseCreate(trigger: String) {
        transitionCount += 1

        let wouldQueue = responsePhase.isActive

        if wouldQueue {
            // In the real state machine, this would be queued
            let hypotheticalQueued = QueuedResponse(trigger: trigger, timestamp: Date())

            if let existing = queuedResponse {
                log(
                    "Response.create would REPLACE queued",
                    metadata: [
                        "eventType": "response.create",
                        "eventDescription":
                            "A new response.create request is replacing a previously queued request because assistant is still responding",
                        "trigger": trigger,
                        "replacedTrigger": existing.trigger,
                        "currentPhase": responsePhase.description,
                        "decision": "QUEUE (replace existing)",
                    ])
            } else {
                log(
                    "Response.create would be QUEUED",
                    metadata: [
                        "eventType": "response.create",
                        "eventDescription":
                            "A response.create request is being queued because assistant is currently responding",
                        "trigger": trigger,
                        "currentPhase": responsePhase.description,
                        "decision": "QUEUE",
                    ])
            }

            queuedResponse = hypotheticalQueued
        } else {
            let previousPhase = responsePhase
            responsePhase = .inProgress(responseId: nil)

            log(
                "Response.create would be SENT",
                metadata: [
                    "eventType": "response.create",
                    "eventDescription":
                        "A response.create request is being sent immediately because assistant is idle",
                    "trigger": trigger,
                    "previousPhase": previousPhase.description,
                    "newPhase": responsePhase.description,
                    "decision": "SEND",
                ])
        }
    }

    /// Shadow observer for response.created event
    func shadow_didReceiveResponseCreated(responseId: String?) {
        transitionCount += 1

        let previousPhase = responsePhase
        responsePhase = .inProgress(responseId: responseId)

        // Tool call audio should stop
        let toolAudioWouldStop =
            toolCallPhase
            == .playingAudio(
                callId: toolCallPhase.callId ?? "",
                toolName: toolCallPhase.toolName ?? ""
            )

        log(
            "response.created received",
            metadata: [
                "eventType": "response.created",
                "eventDescription":
                    "Server confirmed response creation - assistant is now preparing to respond",
                "responseId": responseId ?? "nil",
                "previousPhase": previousPhase.description,
                "newPhase": responsePhase.description,
                "toolAudioWouldStop": toolAudioWouldStop,
            ])

        // Update tool call phase if playing audio
        if case .playingAudio(let callId, let toolName) = toolCallPhase {
            toolCallPhase = .executing(callId: callId, toolName: toolName)
            log(
                "Tool audio would STOP (response starting)",
                metadata: [
                    "eventType": "response.created",
                    "eventDescription":
                        "Tool audio playback would stop because assistant is starting a new response",
                    "callId": callId,
                    "toolName": toolName,
                ])
        }
    }

    /// Shadow observer for response.audio.delta event
    func shadow_didReceiveAudioDelta(responseId: String?, actualAssistantStreaming: Bool) {
        let previousPhase = responsePhase
        let wasAlreadyStreaming = responsePhase.isStreaming

        if !wasAlreadyStreaming {
            transitionCount += 1
            responsePhase = .streaming(responseId: responseId ?? previousPhase.responseId)

            log(
                "Audio streaming STARTED (audio.delta)",
                metadata: [
                    "eventType": "response.audio.delta",
                    "eventDescription":
                        "Assistant audio streaming has started - receiving audio chunks from the server",
                    "responseId": responseId ?? "nil",
                    "previousPhase": previousPhase.description,
                    "newPhase": responsePhase.description,
                ])

            // Check for tool audio that should stop
            if case .playingAudio(let callId, let toolName) = toolCallPhase {
                toolCallPhase = .executing(callId: callId, toolName: toolName)
                log(
                    "Tool audio would STOP (assistant speaking)",
                    metadata: [
                        "eventType": "response.audio.delta",
                        "eventDescription":
                            "Tool audio playback would stop because assistant started speaking",
                        "callId": callId,
                        "toolName": toolName,
                    ])
            }
        }

        // Consistency check
        checkConsistency(
            shadowStreaming: responsePhase.isStreaming,
            actualStreaming: actualAssistantStreaming,
            event: "audio.delta"
        )
    }

    /// Shadow observer for output_audio_buffer.started event
    func shadow_didReceiveOutputAudioBufferStarted(actualAssistantStreaming: Bool) {
        let previousPhase = responsePhase
        let wasAlreadyStreaming = responsePhase.isStreaming

        if !wasAlreadyStreaming {
            transitionCount += 1
            responsePhase = .streaming(responseId: previousPhase.responseId)

            log(
                "Audio streaming STARTED (buffer.started)",
                metadata: [
                    "eventType": "output_audio_buffer.started",
                    "eventDescription":
                        "Assistant audio output buffer started - audio playback is beginning",
                    "previousPhase": previousPhase.description,
                    "newPhase": responsePhase.description,
                ])

            // Check for tool audio that should stop
            if case .playingAudio(let callId, let toolName) = toolCallPhase {
                toolCallPhase = .executing(callId: callId, toolName: toolName)
                log(
                    "Tool audio would STOP (assistant speaking)",
                    metadata: [
                        "eventType": "output_audio_buffer.started",
                        "eventDescription":
                            "Tool audio playback would stop because assistant audio buffer started",
                        "callId": callId,
                        "toolName": toolName,
                    ])
            }
        }

        checkConsistency(
            shadowStreaming: responsePhase.isStreaming,
            actualStreaming: actualAssistantStreaming,
            event: "buffer.started"
        )
    }

    /// Shadow observer for response.audio.done event
    func shadow_didReceiveAudioDone(actualAssistantStreaming: Bool) {
        transitionCount += 1

        let previousPhase = responsePhase

        // Transition from streaming back to inProgress
        if case .streaming(let responseId) = responsePhase {
            responsePhase = .inProgress(responseId: responseId)
        }

        log(
            "Audio streaming STOPPED (audio.done)",
            metadata: [
                "eventType": "response.audio.done",
                "eventDescription":
                    "Server finished sending audio data for this response - audio streaming complete",
                "previousPhase": previousPhase.description,
                "newPhase": responsePhase.description,
            ])

        // Check if blocked tool audio should retry
        if case .awaitingAudioStart(let callId, let toolName) = toolCallPhase {
            log(
                "Tool audio would RETRY now",
                metadata: [
                    "eventType": "response.audio.done",
                    "eventDescription":
                        "Tool audio that was blocked can now retry playback since assistant stopped speaking",
                    "callId": callId,
                    "toolName": toolName,
                    "reason": "assistant stopped streaming",
                ])
            // In real state machine, this would trigger retry
            // For shadow, we just note it
            toolCallPhase = .playingAudio(callId: callId, toolName: toolName)
        }

        checkConsistency(
            shadowStreaming: responsePhase.isStreaming,
            actualStreaming: actualAssistantStreaming,
            event: "audio.done"
        )
    }

    /// Shadow observer for output_audio_buffer.done event
    func shadow_didReceiveOutputAudioBufferDone(actualAssistantStreaming: Bool) {
        transitionCount += 1

        let previousPhase = responsePhase

        if case .streaming(let responseId) = responsePhase {
            responsePhase = .inProgress(responseId: responseId)
        }

        log(
            "Audio streaming STOPPED (buffer.done)",
            metadata: [
                "eventType": "output_audio_buffer.done",
                "eventDescription":
                    "Assistant audio output buffer completed - audio playback has finished",
                "previousPhase": previousPhase.description,
                "newPhase": responsePhase.description,
            ])

        // Check if blocked tool audio should retry
        if case .awaitingAudioStart(let callId, let toolName) = toolCallPhase {
            log(
                "Tool audio would RETRY now",
                metadata: [
                    "eventType": "output_audio_buffer.done",
                    "eventDescription":
                        "Tool audio that was blocked can now retry playback since assistant audio buffer completed",
                    "callId": callId,
                    "toolName": toolName,
                    "reason": "assistant stopped streaming (buffer.done)",
                ])
            toolCallPhase = .playingAudio(callId: callId, toolName: toolName)
        }

        checkConsistency(
            shadowStreaming: responsePhase.isStreaming,
            actualStreaming: actualAssistantStreaming,
            event: "buffer.done"
        )
    }

    /// Shadow observer for response.done event
    func shadow_didReceiveResponseDone(responseId: String?, status: String?) {
        transitionCount += 1

        let previousPhase = responsePhase
        let hadQueuedResponse = queuedResponse != nil

        responsePhase = .idle

        log(
            "response.done received",
            metadata: [
                "eventType": "response.done",
                "eventDescription":
                    "Response streaming complete - assistant has finished this response entirely",
                "responseId": responseId ?? "nil",
                "status": status ?? "nil",
                "previousPhase": previousPhase.description,
                "newPhase": responsePhase.description,
                "hadQueuedResponse": hadQueuedResponse,
            ])

        // Process queued response
        if let queued = queuedResponse {
            queuedResponse = nil

            if queued.isExpired(ttl: queuedResponseTTL) {
                log(
                    "Queued response EXPIRED",
                    metadata: [
                        "eventType": "response.done",
                        "eventDescription":
                            "A previously queued response.create request expired because it waited too long",
                        "trigger": queued.trigger,
                        "age": Date().timeIntervalSince(queued.timestamp),
                        "ttl": queuedResponseTTL,
                    ])
            } else {
                log(
                    "Queued response would be SENT now",
                    metadata: [
                        "eventType": "response.done",
                        "eventDescription":
                            "A previously queued response.create request is now being sent since assistant finished responding",
                        "trigger": queued.trigger,
                        "age": Date().timeIntervalSince(queued.timestamp),
                    ])
                // In real state machine, this would trigger send
                responsePhase = .inProgress(responseId: nil)
            }
        }

        logSnapshot("After response.done")
    }

    /// Shadow observer for response.cancelled event
    func shadow_didReceiveResponseCancelled(responseId: String?) {
        transitionCount += 1

        let previousPhase = responsePhase
        responsePhase = .idle

        // Stop tool audio
        if case .playingAudio(let callId, let toolName) = toolCallPhase {
            toolCallPhase = .executing(callId: callId, toolName: toolName)
            log(
                "Tool audio would STOP (response cancelled)",
                metadata: [
                    "eventType": "response.cancelled",
                    "eventDescription":
                        "Tool audio playback would stop because the response was cancelled",
                    "callId": callId,
                    "toolName": toolName,
                ])
        }

        log(
            "response.cancelled received",
            metadata: [
                "eventType": "response.cancelled",
                "eventDescription":
                    "Server cancelled the response - assistant response was interrupted or aborted",
                "responseId": responseId ?? "nil",
                "previousPhase": previousPhase.description,
                "newPhase": responsePhase.description,
            ])

        // Process queued response (same as response.done)
        if let queued = queuedResponse {
            queuedResponse = nil

            if !queued.isExpired(ttl: queuedResponseTTL) {
                log(
                    "Queued response would be SENT now (after cancel)",
                    metadata: [
                        "eventType": "response.cancelled",
                        "eventDescription":
                            "A previously queued response.create request is now being sent after the previous response was cancelled",
                        "trigger": queued.trigger,
                    ])
                responsePhase = .inProgress(responseId: nil)
            }
        }
    }

    // MARK: - Shadow Event Handlers (Tool Call Lifecycle)

    /// Shadow observer for function_call_arguments.done event
    func shadow_didReceiveToolCall(callId: String, toolName: String, actualAssistantStreaming: Bool)
    {
        transitionCount += 1

        let previousPhase = toolCallPhase

        if responsePhase.isStreaming {
            // Tool audio would be blocked
            toolCallPhase = .awaitingAudioStart(callId: callId, toolName: toolName)
            log(
                "Tool call received - audio BLOCKED",
                metadata: [
                    "eventType": "response.function_call_arguments.done",
                    "eventDescription":
                        "Tool call received but audio playback is blocked because assistant is currently speaking",
                    "callId": callId,
                    "toolName": toolName,
                    "previousPhase": previousPhase.description,
                    "newPhase": toolCallPhase.description,
                    "reason": "assistant is streaming",
                    "responsePhase": responsePhase.description,
                ])
        } else {
            // Tool audio would start
            toolCallPhase = .playingAudio(callId: callId, toolName: toolName)
            log(
                "Tool call received - audio would START",
                metadata: [
                    "eventType": "response.function_call_arguments.done",
                    "eventDescription":
                        "Tool call received and audio playback would start immediately since assistant is not speaking",
                    "callId": callId,
                    "toolName": toolName,
                    "previousPhase": previousPhase.description,
                    "newPhase": toolCallPhase.description,
                ])
        }

        // Consistency check
        if responsePhase.isStreaming != actualAssistantStreaming {
            log(
                "⚠️ INCONSISTENCY: Shadow vs actual streaming state at tool call",
                metadata: [
                    "eventType": "response.function_call_arguments.done",
                    "eventDescription":
                        "Shadow state disagrees with actual state about whether assistant is streaming - potential state tracking bug",
                    "shadowStreaming": responsePhase.isStreaming,
                    "actualStreaming": actualAssistantStreaming,
                    "toolCallPhase": toolCallPhase.description,
                ], level: .warn)
        }
    }

    /// Shadow observer for tool result being sent
    func shadow_willSendToolResult(callId: String, actualResponseInProgress: Bool) {
        let canSendImmediately = !responsePhase.isActive

        log(
            "Tool result ready to send",
            metadata: [
                "eventType": "conversation.item.create",
                "eventDescription":
                    "Tool execution completed and result is ready to be sent back to the server",
                "callId": callId,
                "shadowCanSend": canSendImmediately,
                "actualResponseInProgress": actualResponseInProgress,
                "responsePhase": responsePhase.description,
            ])

        // Consistency check
        if canSendImmediately == actualResponseInProgress {
            log(
                "⚠️ INCONSISTENCY: Shadow says can send = \(canSendImmediately), actual responseInProgress = \(actualResponseInProgress)",
                metadata: [
                    "eventType": "conversation.item.create",
                    "eventDescription":
                        "Shadow state disagrees with actual state about whether tool result can be sent - potential state tracking bug",
                    "callId": callId,
                ], level: .warn)
        }
    }

    /// Shadow observer for tool call completion
    func shadow_didCompleteToolCall(callId: String) {
        transitionCount += 1

        let previousPhase = toolCallPhase

        // Only clear if this is the current tool call
        if toolCallPhase.callId == callId {
            toolCallPhase = .idle
            log(
                "Tool call completed",
                metadata: [
                    "eventType": "tool_call.completed",
                    "eventDescription":
                        "Tool call execution finished and tool call phase returned to idle",
                    "callId": callId,
                    "previousPhase": previousPhase.description,
                    "newPhase": toolCallPhase.description,
                ])
        } else {
            log(
                "Tool call completed (not current)",
                metadata: [
                    "eventType": "tool_call.completed",
                    "eventDescription":
                        "A tool call completed but it was not the currently tracked tool call - may indicate overlapping tool calls",
                    "completedCallId": callId,
                    "currentPhase": toolCallPhase.description,
                ])
        }
    }

    // MARK: - Shadow Event Handlers (User Speech)

    /// Shadow observer for input_audio_buffer.speech_started event
    func shadow_didReceiveUserSpeechStarted() {
        transitionCount += 1

        let previousPhase = userSpeechPhase
        userSpeechPhase = .speaking(startedAt: Date())

        log(
            "User speech STARTED",
            metadata: [
                "eventType": "input_audio_buffer.speech_started",
                "eventDescription":
                    "Voice Activity Detection (VAD) detected that the user started speaking",
                "previousPhase": previousPhase.description,
                "newPhase": userSpeechPhase.description,
            ])
    }

    /// Shadow observer for input_audio_buffer.speech_stopped event
    func shadow_didReceiveUserSpeechStopped() {
        transitionCount += 1

        let previousPhase = userSpeechPhase
        userSpeechPhase = .idle

        if case .speaking(let startedAt) = previousPhase {
            let duration = Date().timeIntervalSince(startedAt)
            log(
                "User speech STOPPED",
                metadata: [
                    "eventType": "input_audio_buffer.speech_stopped",
                    "eventDescription":
                        "Voice Activity Detection (VAD) detected that the user stopped speaking",
                    "duration": String(format: "%.2fs", duration),
                    "previousPhase": previousPhase.description,
                    "newPhase": userSpeechPhase.description,
                ])
        } else {
            log(
                "User speech STOPPED (was not speaking?)",
                metadata: [
                    "eventType": "input_audio_buffer.speech_stopped",
                    "eventDescription":
                        "Speech stopped event received but shadow state did not think user was speaking - potential state tracking issue",
                    "previousPhase": previousPhase.description,
                    "newPhase": userSpeechPhase.description,
                ], level: .warn)
        }
    }

    /// Shadow observer for input_audio_buffer.cleared event
    func shadow_didReceiveInputAudioBufferCleared() {
        log(
            "Input audio buffer cleared",
            metadata: [
                "eventType": "input_audio_buffer.cleared",
                "eventDescription":
                    "The user's input audio buffer was cleared - any uncommitted audio data is discarded",
                "userSpeechPhase": userSpeechPhase.description,
            ])
    }

    // MARK: - Shadow Event Handlers (Audio Mix Player)

    /// Shadow observer for AudioMixPlayer.startLoopingRandomBeeps
    func shadow_didAttemptStartToolAudio(
        prefix: String, wasBlocked: Bool, actualAssistantStreaming: Bool
    ) {
        let shadowWouldBlock = responsePhase.isStreaming

        log(
            "Tool audio start attempted",
            metadata: [
                "eventType": "audio_mix_player.start_attempted",
                "eventDescription":
                    "Attempted to start playing tool audio (e.g., beeps or sound effects during tool execution)",
                "prefix": prefix,
                "actuallyBlocked": wasBlocked,
                "shadowWouldBlock": shadowWouldBlock,
                "responsePhase": responsePhase.description,
            ])

        if wasBlocked != shadowWouldBlock {
            log(
                "⚠️ INCONSISTENCY: Tool audio blocking mismatch",
                metadata: [
                    "eventType": "audio_mix_player.start_attempted",
                    "eventDescription":
                        "Shadow state disagrees with actual behavior about whether tool audio should be blocked - potential state tracking bug",
                    "actuallyBlocked": wasBlocked,
                    "shadowWouldBlock": shadowWouldBlock,
                    "actualAssistantStreaming": actualAssistantStreaming,
                    "shadowResponsePhase": responsePhase.description,
                ], level: .warn)
        }
    }

    /// Shadow observer for AudioMixPlayer.stop
    func shadow_didStopToolAudio(reason: String) {
        log(
            "Tool audio stopped",
            metadata: [
                "eventType": "audio_mix_player.stopped",
                "eventDescription": "Tool audio playback was stopped",
                "reason": reason,
                "toolCallPhase": toolCallPhase.description,
            ])
    }

    // MARK: - Manual Controls

    /// Reset all shadow state (e.g., on disconnect)
    func shadow_reset(reason: String) {
        let previousSnapshot = snapshot

        responsePhase = .idle
        toolCallPhase = .idle
        userSpeechPhase = .idle
        queuedResponse = nil
        transitionCount = 0

        log(
            "Shadow state RESET",
            metadata: [
                "eventType": "shadow_state.reset",
                "eventDescription":
                    "All shadow state has been reset to initial values - typically happens on disconnect or reconnect",
                "reason": reason,
                "previousState": previousSnapshot.description,
            ])
    }

    // MARK: - Logging Helpers

    private enum LogLevel {
        case info
        case warn
        case error
    }

    private func log(_ message: String, metadata: [String: Any] = [:], level: LogLevel = .info) {
        var fullMetadata = metadata
        fullMetadata["transitionCount"] = transitionCount
        fullMetadata["timestamp"] = ISO8601DateFormatter().string(from: Date())

        let levelEmoji: String
        let logLevel: OpenAIWebRTCClient.NativeLogLevel
        switch level {
        case .info:
            levelEmoji = ""
            logLevel = .info
        case .warn:
            levelEmoji = "⚠️ "
            logLevel = .warn
        case .error:
            levelEmoji = "❌ "
            logLevel = .error
        }

        logger.log(
            "\(logPrefix) [ShadowState] \(levelEmoji)\(message)",
            attributes: logAttributes(for: logLevel, metadata: fullMetadata)
        )
    }

    private func logSnapshot(_ context: String) {
        let snap = snapshot
        log(
            "\(context): \(snap.description)",
            metadata: [
                "canSendResponseCreate": snap.canSendResponseCreate,
                "isAssistantSpeaking": snap.isAssistantSpeaking,
                "shouldToolAudioBeBlocked": snap.shouldToolAudioBeBlocked,
            ])
    }

    private func checkConsistency(shadowStreaming: Bool, actualStreaming: Bool, event: String) {
        if shadowStreaming != actualStreaming {
            log(
                "⚠️ INCONSISTENCY: Streaming state mismatch",
                metadata: [
                    "eventType": event,
                    "eventDescription":
                        "Shadow state's streaming flag disagrees with actual streaming state - indicates state tracking is out of sync",
                    "event": event,
                    "shadowStreaming": shadowStreaming,
                    "actualStreaming": actualStreaming,
                    "responsePhase": responsePhase.description,
                ], level: .warn)
        }
    }
}

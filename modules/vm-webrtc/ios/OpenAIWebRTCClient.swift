import AVFoundation
import Foundation
import WebRTC

enum OpenAIWebRTCError: LocalizedError {
    case invalidEndpoint
    case missingLocalDescription
    case missingAPIKey
    case openAIRejected(Int)
    case openAIResponseDecoding
    case connectionTimeout
    case connectionFailed(String)
    case failedToAddAudioTrack
    case missingInstructions

    var errorDescription: String? {
        switch self {
        case .invalidEndpoint:
            return "Failed to build the OpenAI Realtime endpoint URL."
        case .missingLocalDescription:
            return "The local WebRTC session description is missing after ICE gathering."
        case .missingAPIKey:
            return "An OpenAI API key must be set before starting a session."
        case .openAIRejected(let status):
            return "OpenAI Realtime endpoint rejected the SDP offer with status code \(status)."
        case .openAIResponseDecoding:
            return "Could not decode the SDP answer returned by OpenAI."
        case .connectionTimeout:
            return "Timed out waiting for the WebRTC connection to reach the connected state."
        case .connectionFailed(let state):
            return "WebRTC connection failed with state: \(state)."
        case .failedToAddAudioTrack:
            return "Could not attach the audio track to the peer connection."
        case .missingInstructions:
            return "Assistant instructions must be provided when starting a session."
        }
    }
}

final class OpenAIWebRTCClient: NSObject {

    public enum NativeLogLevel: String {
        case trace
        case debug
        case info
        case warn
        case error
    }

    enum AudioOutputPreference: String {
        case handset
        case speakerphone
    }

    enum TurnDetectionMode: String {
        case server
        case semantic
    }

    enum OutputRoute {
        case speaker
        case receiver
    }

    enum Constants {
        static let idleTimeoutSeconds = WebRTCEventHandler.defaultIdleTimeout
    }

    let factory: RTCPeerConnectionFactory
    var peerConnection: RTCPeerConnection?
    var audioTrack: RTCAudioTrack?
    var remoteAudioTrackId: String?
    var isOutgoingAudioMuted = false
    var dataChannel: RTCDataChannel?
    var iceGatheringContinuation: CheckedContinuation<Void, Error>?
    var connectionContinuation: CheckedContinuation<String, Error>?
    var connectionTimeoutTask: Task<Void, Never>?
    var iceGatheringTimeoutTask: Task<Void, Never>?
    var firstCandidateTimestamp: Date?
    var iceGatheringStartTimestamp: Date?
    var isMonitoringAudioRoute = false
    var hasSentInitialSessionConfig = false
    var sessionInstructions: String
    private let defaultVoice = "cedar"
    var sessionVoice: String
    private var sessionAudioSpeed: Double
    var turnDetectionMode: TurnDetectionMode = .semantic
    private var maxConversationTurns: Int?
    var retentionRatio: Double?
    private let retentionRatioScale: Int = 2
    private var disableCompaction: Bool = false
    var transcriptionEnabled: Bool = false
    let logger = VmWebrtcLogging.logger

    // Reference to the github connector tool delegate
    weak var githubConnectorDelegate: BaseTool?

    // Add: Reference to the GDrive connector tool delegate
    weak var gdriveConnectorDelegate: BaseTool?
    weak var gpt5GDriveFixerDelegate: BaseTool?
    weak var gpt5WebSearchDelegate: BaseTool?

    // Reference to the Gen2 toolkit helper
    var toolkitHelper: ToolkitHelper?

    // Audio mix player for playing sounds during WebRTC session
    let audioMixPlayer = AudioMixPlayer()

    var toolDefinitions: [[String: Any]] = []
    private var apiKey: String?
    lazy var eventHandler = WebRTCEventHandler()

    // Track whether lazy monitors have been initialized to prevent deinit issues
    private var _inboundAudioMonitor: InboundAudioStatsMonitor?
    var inboundAudioMonitor: InboundAudioStatsMonitor {
        if let existing = _inboundAudioMonitor {
            return existing
        }
        let monitor = InboundAudioStatsMonitor(
            peerConnectionProvider: { [weak self] in
                self?.peerConnection
            },
            remoteTrackIdentifierProvider: { [weak self] in
                self?.remoteAudioTrackId
            },
            logEmitter: { [weak self] level, message, metadata in
                guard let self else { return }
                self.logger.log(
                    "[VmWebrtc][\(level.rawValue.uppercased())] " + message,
                    attributes: logAttributes(for: level, metadata: metadata)
                )
            },
            speakingActivityRecorder: { [weak self] in
                self?.eventHandler.recordRemoteSpeakingActivity()
            }
        )
        _inboundAudioMonitor = monitor
        return monitor
    }

    private var _outboundAudioMonitor: OutboundAudioStatsMonitor?
    var outboundAudioMonitor: OutboundAudioStatsMonitor {
        if let existing = _outboundAudioMonitor {
            return existing
        }
        let monitor = OutboundAudioStatsMonitor(
            peerConnectionProvider: { [weak self] in
                self?.peerConnection
            },
            localTrackIdentifierProvider: { [weak self] in
                self?.audioTrack?.trackId
            },
            logEmitter: { [weak self] level, message, metadata in
                guard let self else { return }
                self.logger.log(
                    "[VmWebrtc][\(level.rawValue.uppercased())] " + message,
                    attributes: logAttributes(for: level, metadata: metadata)
                )
            },
            statsEventEmitter: { [weak self] metadata in
                guard let self else { return }
                Task { @MainActor in
                    self.emitModuleEvent("onOutboundAudioStats", payload: metadata)
                }
            }
        )
        _outboundAudioMonitor = monitor
        return monitor
    }

    private var moduleEventEmitter: ((String, [String: Any]) -> Void)?

    func makeEventHandlerContext() -> WebRTCEventHandler.ToolContext {
        WebRTCEventHandler.ToolContext(
            githubConnectorDelegate: githubConnectorDelegate,
            gdriveConnectorDelegate: gdriveConnectorDelegate,
            gpt5GDriveFixerDelegate: gpt5GDriveFixerDelegate,
            gpt5WebSearchDelegate: gpt5WebSearchDelegate,
            toolkitHelper: toolkitHelper,
            audioMixPlayer: audioMixPlayer,
            sendToolCallError: { [weak self] callId, error in
                guard let self else { return }
                self.sendToolCallError(callId: callId, error: error)
            },
            emitModuleEvent: { [weak self] name, payload in
                guard let self else { return }
                Task { @MainActor in
                    self.emitModuleEvent(name, payload: payload)
                }
            },
            sendDataChannelMessage: { [weak self] event in
                guard let self else { return }
                self.sendDataChannelMessage(event)
            }
        )
    }

    func sendDataChannelMessage(_ event: [String: Any]) {
        guard let dataChannel = dataChannel, dataChannel.readyState == .open else {
            logger.log(
                "[VmWebrtc] Cannot send data channel message - channel not open",
                attributes: logAttributes(
                    for: .warn,
                    metadata: [
                        "channelState": dataChannel?.readyState.rawValue as Any,
                        "eventType": event["type"] as Any,
                    ])
            )
            return
        }

        do {
            let jsonData = try JSONSerialization.data(withJSONObject: event, options: [])
            let buffer = RTCDataBuffer(data: jsonData, isBinary: false)
            let success = dataChannel.sendData(buffer)

            if success {
                var metadata: [String: Any] = [
                    "eventType": event["type"] as Any,
                    "dataSize": jsonData.count,
                ]

                // Add event_id if present
                if let eventId = event["event_id"] as? String {
                    metadata["eventId"] = eventId
                }

                // Add item_id to metadata if it's a delete event
                if let eventType = event["type"] as? String, eventType == "conversation.item.delete"
                {
                    if let itemId = event["item_id"] as? String {
                        metadata["itemId"] = itemId
                    }
                }

                logger.log(
                    "[VmWebrtc] Data channel message sent",
                    attributes: logAttributes(for: .debug, metadata: metadata)
                )
            } else {
                logger.log(
                    "[VmWebrtc] Failed to send data channel message",
                    attributes: logAttributes(
                        for: .warn,
                        metadata: [
                            "eventType": event["type"] as Any
                        ])
                )
            }
        } catch {
            logger.log(
                "[VmWebrtc] Failed to serialize data channel message",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "eventType": event["type"] as Any,
                        "error": error.localizedDescription,
                    ])
            )
        }
    }

    func quantizedRetentionRatio(_ ratio: Double) -> NSNumber {
        var decimalValue = Decimal(ratio)
        var roundedValue = Decimal()
        NSDecimalRound(&roundedValue, &decimalValue, retentionRatioScale, .plain)
        return NSDecimalNumber(decimal: roundedValue)
    }

    func setEventEmitter(_ emitter: @escaping (String, [String: Any]) -> Void) {
        moduleEventEmitter = emitter
    }

    func setGithubConnectorDelegate(_ delegate: BaseTool) {
        self.githubConnectorDelegate = delegate
    }

    // Add: Setter to attach GDrive connector tool delegate
    func setGDriveConnectorDelegate(_ delegate: BaseTool) {
        self.gdriveConnectorDelegate = delegate
    }

    func setGPT5GDriveFixerDelegate(_ delegate: BaseTool) {
        self.gpt5GDriveFixerDelegate = delegate
    }

    func setGPT5WebSearchDelegate(_ delegate: BaseTool) {
        self.gpt5WebSearchDelegate = delegate
    }

    func setToolkitHelper(_ helper: ToolkitHelper) {
        self.toolkitHelper = helper
    }

    func setAPIKey(_ apiKey: String) {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedKey.isEmpty == false else {
            self.apiKey = nil
            self.logger.log(
                "[VmWebrtc] " + "Cleared OpenAI API key for WebRTC client",
                attributes: logAttributes(
                    for: .warn,
                    metadata: [
                        "reason": "empty_key"
                    ])
            )
            return
        }

        self.apiKey = trimmedKey
        self.logger.log(
            "[VmWebrtc] " + "Stored OpenAI API key for WebRTC client",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "keyLength": trimmedKey.count
                ])
        )
    }

    @MainActor
    func setOutgoingAudioMuted(_ muted: Bool) {
        isOutgoingAudioMuted = muted
        if let audioTrack {
            audioTrack.isEnabled = !muted
            self.logger.log(
                "[VmWebrtc] " + (muted ? "Outgoing audio muted" : "Outgoing audio unmuted"),
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "hasAudioTrack": true
                    ])
            )
        } else {
            self.logger.log(
                "[VmWebrtc] " + "Queued outgoing audio mute state",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "muted": muted,
                        "hasAudioTrack": false,
                    ])
            )
        }
    }

    func setToolDefinitions(_ definitions: [[String: Any]]) {
        self.toolDefinitions = definitions
        self.logger.log(
            "[VmWebrtc] " + "Configured tool definitions from JavaScript",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "definitions": definitions
                ])
        )
    }

    let defaultEndpoint = "https://api.openai.com/v1/realtime"
    let defaultModel = "gpt-realtime"
    private let iceGatheringGracePeriod: TimeInterval = 0.5

    override init() {
        RTCInitializeSSL()
        self.factory = RTCPeerConnectionFactory()
        self.sessionInstructions = ""
        self.sessionVoice = defaultVoice
        self.sessionAudioSpeed = 1.0
        super.init()

        // Set up callback for sending queued response.create
        eventHandler.sendResponseCreateCallback = { [weak self] in
            guard let self = self else { return false }
            return self.sendEvent(["type": "response.create"])
        }

        // Set up audio streaming check to prevent overlap
        // AudioMixPlayer will check this before playing any audio
        audioMixPlayer.isAssistantAudioStreamingCheck = { [weak self] in
            guard let self = self else { return false }
            return self.eventHandler.checkAssistantAudioStreaming()
        }
    }

    deinit {
        connectionTimeoutTask?.cancel()
        iceGatheringTimeoutTask?.cancel()
        // Only stop monitors if they were initialized (prevents lazy init during deinit)
        _inboundAudioMonitor?.stop()
        _outboundAudioMonitor?.stop()
        peerConnection?.close()
        if isMonitoringAudioRoute {
            RTCAudioSession.sharedInstance().remove(self)
            isMonitoringAudioRoute = false
        }
        eventHandler.stopIdleMonitoring(reason: "deinit")
        RTCCleanupSSL()
    }

    @MainActor
    func emitModuleEvent(_ name: String, payload: [String: Any]) {
        guard let moduleEventEmitter else {
            self.logger.log(
                "[VmWebrtc] " + "No module event emitter configured; dropping event",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "event": name
                    ])
            )
            return
        }
        moduleEventEmitter(name, payload)
    }

    private func convertLogLevel(_ levelString: String) -> NativeLogLevel {
        switch levelString.lowercased() {
        case "trace": return .trace
        case "debug": return .debug
        case "info": return .info
        case "warn": return .warn
        case "error": return .error
        default: return .debug
        }
    }

    @MainActor
    func openConnection(
        model: String?,
        baseURL: String?,
        audioOutput: AudioOutputPreference,
        instructions: String,
        voice: String?,
        vadMode: String?,
        audioSpeed: Double?,
        maxConversationTurns: Int?,
        retentionRatio: Double?,
        disableCompaction: Bool?,
        transcriptionEnabled: Bool
    ) async throws -> String {
        let sanitizedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sanitizedInstructions.isEmpty else {
            self.logger.log(
                "[VmWebrtc] " + "Received empty instructions for OpenAI session",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.missingInstructions
        }
        sessionInstructions = sanitizedInstructions

        guard let resolvedApiKey = self.apiKey, resolvedApiKey.isEmpty == false else {
            self.logger.log(
                "[VmWebrtc] " + "Missing OpenAI API key before starting connection",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "reason": "api_key_not_set"
                    ])
            )
            throw OpenAIWebRTCError.missingAPIKey
        }

        let sanitizedVoice = voice?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let sanitizedVoice, !sanitizedVoice.isEmpty {
            sessionVoice = sanitizedVoice
        } else {
            sessionVoice = defaultVoice
        }

        if let mode = vadMode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            let resolvedMode = TurnDetectionMode(rawValue: mode)
        {
            turnDetectionMode = resolvedMode
        } else {
            turnDetectionMode = .semantic
        }

        if let audioSpeed, audioSpeed.isFinite {
            let clampedSpeed = min(max(audioSpeed, 0.25), 4.0)
            sessionAudioSpeed = clampedSpeed
        } else {
            sessionAudioSpeed = 1.0
        }

        // Store context control settings
        self.maxConversationTurns = maxConversationTurns
        self.retentionRatio = retentionRatio
        self.disableCompaction = disableCompaction ?? false
        self.transcriptionEnabled = transcriptionEnabled

        // Configure conversation turn limit in event handler
        eventHandler.configureConversationTurnLimit(maxTurns: maxConversationTurns)
        eventHandler.configureDisableCompaction(disabled: self.disableCompaction)
        eventHandler.resetConversationTracking()

        // Pass API key to event handler
        eventHandler.setApiKey(resolvedApiKey)

        eventHandler.stopIdleMonitoring(reason: "starting_new_connection")

        // Emit initial status update
        emitModuleEvent(
            "onVoiceSessionStatus",
            payload: [
                "status_update": "Connecting to OpenAI..."
            ])

        self.logger.log(
            "[VmWebrtc] " + "Starting OpenAI WebRTC connection",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "hasModel": (model?.isEmpty == false),
                    "hasBaseURL": (baseURL?.isEmpty == false),
                    "audioOutput": audioOutput.rawValue,
                    "voice": sessionVoice,
                ]))

        self.logger.log(
            "[VmWebrtc] " + "Resolved session instructions",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "characterCount": sanitizedInstructions.count
                ]))

        self.logger.log(
            "[VmWebrtc] " + "Resolved session voice",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "hasCustom": sanitizedVoice?.isEmpty == false
                ]))

        self.logger.log(
            "[VmWebrtc] " + "Resolved turn detection mode",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "mode": turnDetectionMode.rawValue
                ]))

        self.logger.log(
            "[VmWebrtc] " + "Resolved session audio speed",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "speed": sessionAudioSpeed
                ]))

        let endpointURL = try buildEndpointURL(baseURL: baseURL, model: model)
        self.logger.log(
            "[VmWebrtc] " + "Resolved OpenAI endpoint",
            attributes: logAttributes(
                for: .debug, metadata: ["endpoint": endpointURL.absoluteString]))

        try configureAudioSession(for: audioOutput)
        self.logger.log(
            "[VmWebrtc] " + "Configured AVAudioSession for voice chat",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "requestedOutput": audioOutput.rawValue
                ]))

        emitModuleEvent(
            "onVoiceSessionStatus",
            payload: [
                "status_update": "Setting up audio session..."
            ])

        let connection = try makePeerConnection()
        firstCandidateTimestamp = nil
        self.logger.log(
            "[VmWebrtc] " + "Peer connection prepared",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "hasAudioTrack": audioTrack != nil,
                    "hasDataChannel": dataChannel != nil,
                ]))

        emitModuleEvent(
            "onVoiceSessionStatus",
            payload: [
                "status_update": "Establishing peer connection..."
            ])

        let offer = try await createOffer(connection: connection)
        self.logger.log(
            "[VmWebrtc] " + "Created local SDP offer",
            attributes: logAttributes(for: .debug, metadata: ["hasSDP": !offer.sdp.isEmpty]))
        try await setLocalDescription(offer, for: connection)
        self.logger.log(
            "[VmWebrtc] " + "Local description applied", attributes: logAttributes(for: .debug))

        emitModuleEvent(
            "onVoiceSessionStatus",
            payload: [
                "status_update": "Gathering network candidates..."
            ])

        let iceWait = try await waitForIceGathering(
            on: connection, timeout: iceGatheringGracePeriod)
        self.logger.log(
            "[VmWebrtc] " + "Continuing after ICE wait",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "state": connection.iceGatheringState.rawValue,
                    "elapsedSeconds": iceWait,
                    "timedOut": connection.iceGatheringState != .complete,
                ]))

        guard let localSDP = connection.localDescription?.sdp else {
            self.logger.log(
                "[VmWebrtc] " + "Local description missing after ICE gathering",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.missingLocalDescription
        }

        emitModuleEvent(
            "onVoiceSessionStatus",
            payload: [
                "status_update": "Connecting to OpenAI endpoint..."
            ])

        let answerSDP = try await exchangeSDPWithOpenAI(
            apiKey: resolvedApiKey, endpointURL: endpointURL, offerSDP: localSDP)
        let remoteDescription = RTCSessionDescription(type: .answer, sdp: answerSDP)
        try await setRemoteDescription(remoteDescription, for: connection)
        self.logger.log(
            "[VmWebrtc] " + "Remote description applied", attributes: logAttributes(for: .debug))

        emitModuleEvent(
            "onVoiceSessionStatus",
            payload: [
                "status_update": "Finalizing connection..."
            ])

        let state = try await waitForConnection(toReach: connection, timeout: 15)
        self.logger.log(
            "[VmWebrtc] " + "OpenAI WebRTC connection flow finished",
            attributes: logAttributes(for: .info, metadata: ["state": state]))

        if state == "connected" || state == "completed" {
            emitModuleEvent(
                "onVoiceSessionStatus",
                payload: [
                    "status_update": "Connected"
                ])

            eventHandler.startIdleMonitoring(timeout: Constants.idleTimeoutSeconds) { [weak self] in
                guard let self else { return }
                Task { @MainActor in
                    self.handleIdleTimeoutTriggered()
                }
            }
        }

        return state
    }

    @MainActor
    func closeConnection() -> String {
        self.logger.log(
            "[VmWebrtc] " + "Closing OpenAI WebRTC connection",
            attributes: logAttributes(for: .info))

        eventHandler.stopIdleMonitoring(reason: "connection_closed")
        eventHandler.resetConversationTracking()
        eventHandler.resetAudioStreamingState()
        eventHandler.resetFunctionCallState()

        // SHADOW: Reset shadow state machine on connection close
        eventHandler.shadowObserve_reset(reason: "connection_closed")
        stopInboundAudioStatsMonitoring()
        stopOutboundAudioStatsMonitoring()
        remoteAudioTrackId = nil

        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = nil
        iceGatheringTimeoutTask?.cancel()
        iceGatheringTimeoutTask = nil

        if let continuation = iceGatheringContinuation {
            iceGatheringContinuation = nil
            continuation.resume(returning: ())
        }

        if let continuation = connectionContinuation {
            connectionContinuation = nil
            continuation.resume(throwing: OpenAIWebRTCError.connectionFailed("closed"))
        }

        if let dataChannel {
            dataChannel.delegate = nil
            dataChannel.close()
            self.logger.log(
                "[VmWebrtc] " + "Data channel closed",
                attributes: logAttributes(for: .debug, metadata: ["label": dataChannel.label]))
        }
        dataChannel = nil

        if let audioTrack {
            audioTrack.isEnabled = false
        }
        audioTrack = nil

        let hadPeerConnection = peerConnection != nil
        if let connection = peerConnection {
            connection.delegate = nil
            connection.close()
            self.logger.log(
                "[VmWebrtc] " + "Peer connection closed",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "signalingState": connection.signalingState.rawValue,
                        "iceState": stringValue(for: connection.iceConnectionState),
                    ]))
        }
        peerConnection = nil

        hasSentInitialSessionConfig = false

        stopMonitoringAudioRouteChanges()
        deactivateAudioSession()

        self.logger.log(
            "[VmWebrtc] " + "OpenAI WebRTC connection teardown completed",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "hadPeerConnection": hadPeerConnection
                ]))

        return "closed"
    }

}

// MARK: - ToolCallResponder

extension OpenAIWebRTCClient: ToolCallResponder {
    func sendToolCallResult(callId: String, result: String) {
        // Generate client-controlled ID for this function call output (max 32 chars, no hyphens)
        let itemId = UUID().uuidString.replacingOccurrences(of: "-", with: "")

        // SHADOW: Observe tool result about to be sent
        eventHandler.shadowObserve_willSendToolResult(callId: callId)

        // PRE-SEND DIAGNOSTICS
        self.logger.log(
            "🔧 [TOOL_OUTPUT_START] Preparing to send tool call result",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "callId": callId,
                    "itemId": itemId,
                    "resultLength": result.count,
                    "result": result,
                    "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
                    "peerConnectionState": peerConnection?.connectionState.rawValue ?? -1,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ])
        )

        let outputDict: [String: Any] = [
            "type": "conversation.item.create",
            "item": [
                "id": itemId,
                "type": "function_call_output",
                "call_id": callId,
                "output": result,
            ],
        ]

        // Save this item to conversation tracking BEFORE sending
        // This ensures we have the full content for compaction
        eventHandler.saveConversationItem(
            itemId: itemId,
            role: "system",
            type: "function_call_output",
            fullContent: result
        )

        let didSend = sendEvent(outputDict)

        if didSend {
            self.logger.log(
                "✅ [TOOL_OUTPUT_SENT] Tool call result successfully sent via data channel",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "callId": callId,
                        "itemId": itemId,
                        "resultLength": result.count,
                        "result": result,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
            eventHandler.recordExternalActivity(reason: "tool_call_result")

            // Check state machine before sending response.create
            let trigger = "tool_call_result:\(callId)"
            let responseInProgress = eventHandler.checkResponseInProgress()
            let audioStreaming = eventHandler.checkAssistantAudioStreaming()
            let currentRespId = eventHandler.getCurrentResponseId()
            let shortCurrentRespId =
                currentRespId.map { id in id.count > 12 ? "\(id.prefix(12))..." : id } ?? "nil"

            self.logger.log(
                "🔍 [RESPONSE_CREATE_CHECK] Checking state (currentResp=\(shortCurrentRespId), inProgress=\(responseInProgress))",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "trigger": "tool_call_result",
                        "callId": callId,
                        "responseInProgress": responseInProgress,
                        "currentResponseId": currentRespId as Any,
                        "audioStreaming": audioStreaming,
                        "raceConditionNote":
                            "If OpenAI returns conversation_already_has_active_response, compare blocking ID with currentResponseId",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                        "threadId": Thread.current.description,
                    ])
            )

            if responseInProgress {

                // Continue conversation
                self.logger.log(
                    "⚠️ Already have a response in progress (\(shortCurrentRespId)); queuing response.create",
                    attributes: logAttributes(
                        for: .warn,
                        metadata: [
                            "trigger": "tool_call_result",
                            "callId": callId,
                            "responseInProgress": responseInProgress,
                            "currentResponseId": currentRespId as Any,
                            "audioStreaming": audioStreaming,
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
                        ])
                )

                // Queue for later - will be sent when current response completes
                eventHandler.queueResponseCreate(trigger: trigger)

                // SHADOW: Observe response.create would be queued
                eventHandler.shadowObserve_willSendResponseCreate(trigger: trigger)
            } else {

                // Continue conversation
                self.logger.log(
                    "📤 [RESPONSE_CREATE] Sending response.create (localState=idle, lastResp=\(shortCurrentRespId))",
                    attributes: logAttributes(
                        for: .info,
                        metadata: [
                            "trigger": "tool_call_result",
                            "callId": callId,
                            "responseInProgress": responseInProgress,
                            "currentResponseId": currentRespId as Any,
                            "audioStreaming": audioStreaming,
                            "warning":
                                "If error occurs, OpenAI may have started a new response we didn't see",
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
                            "threadId": Thread.current.description,
                        ])
                )

                // SHADOW: Observe response.create about to be sent
                eventHandler.shadowObserve_willSendResponseCreate(trigger: trigger)

                // Safe to send immediately
                let responseCreateSent = sendEvent(["type": "response.create"])

                if responseCreateSent {
                    eventHandler.didSendResponseCreate(trigger: trigger)

                    // SHADOW: Observe tool call completed (response sent)
                    eventHandler.shadowObserve_didCompleteToolCall(callId: callId)
                } else {
                    self.logger.log(
                        "❌ [RESPONSE_CREATE_FAILED] Failed to send response.create",
                        attributes: logAttributes(
                            for: .error,
                            metadata: [
                                "callId": callId,
                                "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
                                "timestamp": ISO8601DateFormatter().string(from: Date()),
                            ])
                    )
                }
            }
        } else {
            self.logger.log(
                "❌ [TOOL_OUTPUT_FAILED] Failed to send conversation.item.create for tool result",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "callId": callId,
                        "itemId": itemId,
                        "resultLength": result.count,
                        "result": result,
                        "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
                        "peerConnectionState": peerConnection?.connectionState.rawValue ?? -1,
                        "likelyReason":
                            "call_id may not exist in conversation (could have been pruned)",
                        "recommendation": "Check if conversation pruning deleted this call_id",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )

            // CRITICAL: Do NOT send response.create if output failed
            // This prevents cascading "conversation_already_has_active_response" errors
        }
    }

    func sendToolCallError(callId: String, error: String) {
        // Generate client-controlled ID for this error output (max 32 chars, no hyphens)
        let itemId = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let errorOutput = "{\"error\": \"\(error)\"}"

        self.logger.log(
            "⚠️ [TOOL_ERROR] Sending tool call error response",
            attributes: logAttributes(
                for: .warn,
                metadata: [
                    "callId": callId,
                    "itemId": itemId,
                    "error": error,
                    "errorOutput": errorOutput,
                    "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ])
        )

        let outputDict: [String: Any] = [
            "type": "conversation.item.create",
            "item": [
                "id": itemId,
                "type": "function_call_output",
                "call_id": callId,
                "output": errorOutput,
            ],
        ]

        // Save this error output to conversation tracking
        eventHandler.saveConversationItem(
            itemId: itemId,
            role: "system",
            type: "function_call_output",
            fullContent: errorOutput
        )

        let didSend = sendEvent(outputDict)

        if !didSend {
            self.logger.log(
                "❌ [TOOL_ERROR_SEND_FAILED] Failed to send tool error response",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "callId": callId,
                        "itemId": itemId,
                        "error": error,
                        "errorOutput": errorOutput,
                        "likelyReason":
                            "call_id may not exist in conversation (could have been pruned)",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
            return  // Don't send response.create if error output failed
        }

        // Check state machine before sending response.create
        let trigger = "tool_call_error:\(callId)"
        let responseInProgress = eventHandler.checkResponseInProgress()
        let audioStreaming = eventHandler.checkAssistantAudioStreaming()
        let currentRespIdErr = eventHandler.getCurrentResponseId()
        let shortCurrentRespIdErr =
            currentRespIdErr.map { id in id.count > 12 ? "\(id.prefix(12))..." : id } ?? "nil"

        self.logger.log(
            "🔍 [RESPONSE_CREATE_CHECK] Checking state after tool error (currentResp=\(shortCurrentRespIdErr), inProgress=\(responseInProgress))",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "trigger": "tool_call_error",
                    "callId": callId,
                    "responseInProgress": responseInProgress,
                    "currentResponseId": currentRespIdErr as Any,
                    "audioStreaming": audioStreaming,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                    "threadId": Thread.current.description,
                ])
        )

        if responseInProgress {
            self.logger.log(
                "⚠️ Already have a response in progress (\(shortCurrentRespIdErr)); queuing response.create after tool error",
                attributes: logAttributes(
                    for: .warn,
                    metadata: [
                        "trigger": "tool_call_error",
                        "callId": callId,
                        "responseInProgress": responseInProgress,
                        "currentResponseId": currentRespIdErr as Any,
                        "audioStreaming": audioStreaming,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ])
            )
            // Queue for later - will be sent when current response completes
            eventHandler.queueResponseCreate(trigger: trigger)
        } else {
            self.logger.log(
                "📤 [RESPONSE_CREATE] Sending response.create after tool error (localState=idle, lastResp=\(shortCurrentRespIdErr))",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "trigger": "tool_call_error",
                        "callId": callId,
                        "responseInProgress": responseInProgress,
                        "currentResponseId": currentRespIdErr as Any,
                        "audioStreaming": audioStreaming,
                        "warning":
                            "If error occurs, OpenAI may have started a new response we didn't see",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                        "threadId": Thread.current.description,
                    ])
            )
            let responseCreateSent = sendEvent(["type": "response.create"])
            if responseCreateSent {
                eventHandler.didSendResponseCreate(trigger: trigger)
            }
        }
        eventHandler.recordExternalActivity(reason: "tool_call_error")
    }
}

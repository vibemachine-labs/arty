import Foundation
import AVFoundation
import WebRTC

enum OpenAIWebRTCError: LocalizedError {
  case invalidEndpoint
  case missingLocalDescription
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
  @MainActor lazy var recordingManager: VoiceSessionRecordingManager = {
    let manager = VoiceSessionRecordingManager()
    manager.setMetricsHandler { [weak self] metrics in
      guard let self else { return }
      self.logger.log("[VmWebrtc] " + "Outgoing audio meters", attributes: logAttributes(for: .debug, metadata: metrics.toMetadata()))
      Task { @MainActor in
        self.emitModuleEvent("onAudioMetrics", payload: metrics.toMetadata())
      }
    }
    manager.setLogEmitter { [weak self] level, message, metadata in
      guard let self else { return }
      let logLevel = self.convertLogLevel(level)
      self.logger.log(
        "[VmWebrtc][\(logLevel.rawValue.uppercased())] " + message,
        attributes: logAttributes(for: logLevel, metadata: metadata)
      )
    }
    return manager
  }()
  var isRecordingEnabled: Bool = false
  
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
  let logger = VmWebrtcLogging.logger

  // Reference to the github connector tool delegate
  weak var githubConnectorDelegate: BaseTool?

  // Add: Reference to the GDrive connector tool delegate
  weak var gdriveConnectorDelegate: BaseTool?
  weak var gpt5GDriveFixerDelegate: BaseTool?
  weak var gpt5WebSearchDelegate: BaseTool?

  // Reference to the Gen2 toolkit helper
  var toolkitHelper: ToolkitHelper?
        
  var toolDefinitions: [[String: Any]] = []
  lazy var eventHandler = WebRTCEventHandler()
  lazy var inboundAudioMonitor: InboundAudioStatsMonitor = {
    InboundAudioStatsMonitor(
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
  }()
  lazy var outboundAudioMonitor: OutboundAudioStatsMonitor = {
    OutboundAudioStatsMonitor(
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
  }()
  private var moduleEventEmitter: ((String, [String: Any]) -> Void)?

  func makeEventHandlerContext() -> WebRTCEventHandler.ToolContext {
    WebRTCEventHandler.ToolContext(
      githubConnectorDelegate: githubConnectorDelegate,
      gdriveConnectorDelegate: gdriveConnectorDelegate,
      gpt5GDriveFixerDelegate: gpt5GDriveFixerDelegate,
      gpt5WebSearchDelegate: gpt5WebSearchDelegate,
      toolkitHelper: toolkitHelper,
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
        attributes: logAttributes(for: .warn, metadata: [
          "channelState": dataChannel?.readyState.rawValue as Any,
          "eventType": event["type"] as Any
        ])
      )
      return
    }

    do {
      let jsonData = try JSONSerialization.data(withJSONObject: event, options: [])
      let buffer = RTCDataBuffer(data: jsonData, isBinary: false)
      let success = dataChannel.sendData(buffer)

      if success {
        logger.log(
          "[VmWebrtc] Data channel message sent",
          attributes: logAttributes(for: .debug, metadata: [
            "eventType": event["type"] as Any,
            "dataSize": jsonData.count
          ])
        )
      } else {
        logger.log(
          "[VmWebrtc] Failed to send data channel message",
          attributes: logAttributes(for: .warn, metadata: [
            "eventType": event["type"] as Any
          ])
        )
      }
    } catch {
      logger.log(
        "[VmWebrtc] Failed to serialize data channel message",
        attributes: logAttributes(for: .error, metadata: [
          "eventType": event["type"] as Any,
          "error": error.localizedDescription
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

  @MainActor
  func setOutgoingAudioMuted(_ muted: Bool) {
    isOutgoingAudioMuted = muted
    if let audioTrack {
      audioTrack.isEnabled = !muted
      self.logger.log(
        "[VmWebrtc] " + (muted ? "Outgoing audio muted" : "Outgoing audio unmuted"),
        attributes: logAttributes(for: .info, metadata: [
          "hasAudioTrack": true
        ])
      )
    } else {
      self.logger.log(
        "[VmWebrtc] " + "Queued outgoing audio mute state",
        attributes: logAttributes(for: .debug, metadata: [
          "muted": muted,
          "hasAudioTrack": false
        ])
      )
    }
  }

  func setToolDefinitions(_ definitions: [[String: Any]]) {
    self.toolDefinitions = definitions
    self.logger.log(
      "[VmWebrtc] " + "Configured tool definitions from JavaScript",
      attributes: logAttributes(for: .debug, metadata: [
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
  }

  deinit {
    connectionTimeoutTask?.cancel()
    iceGatheringTimeoutTask?.cancel()
    inboundAudioMonitor.stop()
    outboundAudioMonitor.stop()
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
        attributes: logAttributes(for: .debug, metadata: [
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
    apiKey: String,
    model: String?,
    baseURL: String?,
    audioOutput: AudioOutputPreference,
    instructions: String,
    voice: String?,
    vadMode: String?,
    audioSpeed: Double?,
    enableRecording: Bool,
    maxConversationTurns: Int?,
    retentionRatio: Double?
  ) async throws -> String {
    let sanitizedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !sanitizedInstructions.isEmpty else {
      self.logger.log("[VmWebrtc] " + "Received empty instructions for OpenAI session", attributes: logAttributes(for: .error))
      throw OpenAIWebRTCError.missingInstructions
    }
    sessionInstructions = sanitizedInstructions

    let sanitizedVoice = voice?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let sanitizedVoice, !sanitizedVoice.isEmpty {
      sessionVoice = sanitizedVoice
    } else {
      sessionVoice = defaultVoice
    }

    if let mode = vadMode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
       let resolvedMode = TurnDetectionMode(rawValue: mode) {
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

    // Configure conversation turn limit in event handler
    eventHandler.configureConversationTurnLimit(maxTurns: maxConversationTurns)
    eventHandler.resetConversationTracking()

    eventHandler.stopIdleMonitoring(reason: "starting_new_connection")

    self.logger.log("[VmWebrtc] " + "Starting OpenAI WebRTC connection", attributes: logAttributes(for: .info, metadata: [
        "hasModel": (model?.isEmpty == false),
        "hasBaseURL": (baseURL?.isEmpty == false),
        "audioOutput": audioOutput.rawValue,
        "voice": sessionVoice,
        "recordingEnabled": enableRecording
      ]))
    // Persist recording preferences
    self.isRecordingEnabled = enableRecording

    self.logger.log("[VmWebrtc] " + "Resolved session instructions", attributes: logAttributes(for: .debug, metadata: [
      "characterCount": sanitizedInstructions.count
    ]))

    self.logger.log("[VmWebrtc] " + "Resolved session voice", attributes: logAttributes(for: .debug, metadata: [
      "hasCustom": sanitizedVoice?.isEmpty == false
    ]))

    self.logger.log("[VmWebrtc] " + "Resolved turn detection mode", attributes: logAttributes(for: .debug, metadata: [
      "mode": turnDetectionMode.rawValue
    ]))

    self.logger.log("[VmWebrtc] " + "Resolved session audio speed", attributes: logAttributes(for: .debug, metadata: [
      "speed": sessionAudioSpeed
    ]))

    let endpointURL = try buildEndpointURL(baseURL: baseURL, model: model)
    self.logger.log("[VmWebrtc] " + "Resolved OpenAI endpoint", attributes: logAttributes(for: .debug, metadata: ["endpoint": endpointURL.absoluteString]))

    try configureAudioSession(for: audioOutput)
    self.logger.log("[VmWebrtc] " + "Configured AVAudioSession for voice chat", attributes: logAttributes(for: .debug, metadata: [
      "requestedOutput": audioOutput.rawValue
    ]))

    let audioSession = AVAudioSession.sharedInstance()

    if enableRecording {
      do {
        try await recordingManager.startRecording(
          using: audioSession,
          apiKey: apiKey,
          voice: sessionVoice
        )
      } catch {
        self.logger.log("[VmWebrtc] " + "Failed to start recording", attributes: logAttributes(for: .warn, metadata: [
            "error": error.localizedDescription
          ]))
      }
    } else {
      self.logger.log("[VmWebrtc] " + "Recording disabled by user preference", attributes: logAttributes(for: .info, metadata: [
        "recordingRequested": enableRecording,
        "reason": "user_preference"
      ]))
    }

    let connection = try makePeerConnection()
    firstCandidateTimestamp = nil
    self.logger.log("[VmWebrtc] " + "Peer connection prepared", attributes: logAttributes(for: .debug, metadata: [
      "hasAudioTrack": audioTrack != nil,
      "hasDataChannel": dataChannel != nil
    ]))
    let offer = try await createOffer(connection: connection)
    self.logger.log("[VmWebrtc] " + "Created local SDP offer", attributes: logAttributes(for: .debug, metadata: ["hasSDP": !offer.sdp.isEmpty]))
    try await setLocalDescription(offer, for: connection)
    self.logger.log("[VmWebrtc] " + "Local description applied", attributes: logAttributes(for: .debug))
    let iceWait = try await waitForIceGathering(on: connection, timeout: iceGatheringGracePeriod)
    self.logger.log("[VmWebrtc] " + "Continuing after ICE wait", attributes: logAttributes(for: .debug, metadata: [
      "state": connection.iceGatheringState.rawValue,
      "elapsedSeconds": iceWait,
      "timedOut": connection.iceGatheringState != .complete
    ]))

    guard let localSDP = connection.localDescription?.sdp else {
      self.logger.log("[VmWebrtc] " + "Local description missing after ICE gathering", attributes: logAttributes(for: .error))
      throw OpenAIWebRTCError.missingLocalDescription
    }

    let answerSDP = try await exchangeSDPWithOpenAI(apiKey: apiKey, endpointURL: endpointURL, offerSDP: localSDP)
    let remoteDescription = RTCSessionDescription(type: .answer, sdp: answerSDP)
    try await setRemoteDescription(remoteDescription, for: connection)
    self.logger.log("[VmWebrtc] " + "Remote description applied", attributes: logAttributes(for: .debug))

    let state = try await waitForConnection(toReach: connection, timeout: 15)
    self.logger.log("[VmWebrtc] " + "OpenAI WebRTC connection flow finished", attributes: logAttributes(for: .info, metadata: ["state": state]))

    if enableRecording {
      await recordingManager.startConversationTracking()
    }
    if state == "connected" || state == "completed" {
      eventHandler.startIdleMonitoring(timeout: Constants.idleTimeoutSeconds) { [weak self] in
        guard let self else { return }
        Task { @MainActor in
          self.handleIdleTimeoutTriggered()
        }
      }
    }

    return state
  }

  /// Convert saved transcript to OpenAI TTS voice and merge
  /// Call this AFTER the call has ended if you want premium AI voice instead of Siri
  /// - Parameters:
  ///   - apiKey: OpenAI API key
  ///   - voice: Optional override; if nil or empty, uses sessionVoice.
  @MainActor
  func convertTranscriptToOpenAIVoice(apiKey: String, voice: String? = nil) {
    recordingManager.convertTranscriptToOpenAIVoice(
      apiKey: apiKey,
      voice: voice
    )
  }

  @MainActor
  func closeConnection() -> String {
      self.logger.log("[VmWebrtc] " + "Closing OpenAI WebRTC connection", attributes: logAttributes(for: .info))

      eventHandler.stopIdleMonitoring(reason: "connection_closed")
      eventHandler.resetConversationTracking()
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
        self.logger.log("[VmWebrtc] " + "Data channel closed", attributes: logAttributes(for: .debug, metadata: ["label": dataChannel.label]))
      }
      dataChannel = nil

      if let audioTrack {
        audioTrack.isEnabled = false
      }
      audioTrack = nil

      if let connection = peerConnection {
        connection.delegate = nil
        connection.close()
        self.logger.log("[VmWebrtc] " + "Peer connection closed", attributes: logAttributes(for: .debug, metadata: [
          "signalingState": connection.signalingState.rawValue,
          "iceState": stringValue(for: connection.iceConnectionState)
        ]))
      }
      peerConnection = nil

      hasSentInitialSessionConfig = false

      // ============================================
      // TTS Recording & Merge Workflow
      // ============================================

      if isRecordingEnabled {
        recordingManager.stopRecordingAndProcess {
          // Completion handler - nothing needed here
        }
      } else {
        self.logger.log("[VmWebrtc] " + "Recording was disabled - skipping TTS generation and merge", attributes: logAttributes(for: .info))
        recordingManager.reset()
      }

      stopMonitoringAudioRouteChanges()
      deactivateAudioSession()

    self.logger.log("[VmWebrtc] " + "OpenAI WebRTC connection teardown completed", attributes: logAttributes(for: .info, metadata: [
        "recordingEnabled": isRecordingEnabled,
        "hadPeerConnection": peerConnection != nil
      ]))

      return "closed"
  }

}

// MARK: - ToolCallResponder

extension OpenAIWebRTCClient: ToolCallResponder {
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
}

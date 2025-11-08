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
      self.emit(.debug, "Outgoing audio meters", metadata: metrics.toMetadata())
      Task { @MainActor in
        self.emitModuleEvent("onAudioMetrics", payload: metrics.toMetadata())
      }
    }
    manager.setLogEmitter { [weak self] level, message, metadata in
      guard let self else { return }
      let logLevel = self.convertLogLevel(level)
      self.emit(logLevel, message, metadata: metadata)
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
  private let logger = VmWebrtcLogging.logger

  // Reference to the github connector tool delegate
  weak var githubConnectorDelegate: BaseTool?

  // Add: Reference to the GDrive connector tool delegate
  weak var gdriveConnectorDelegate: BaseTool?
  weak var gpt5GDriveFixerDelegate: BaseTool?
  weak var gpt5WebSearchDelegate: BaseTool?

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
        self?.emit(level, message, metadata: metadata)
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
        self?.emit(level, message, metadata: metadata)
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
      sendToolCallError: { [weak self] callId, error in
        guard let self else { return }
        self.sendToolCallError(callId: callId, error: error)
      },
      emitModuleEvent: { [weak self] name, payload in
        guard let self else { return }
        Task { @MainActor in
          self.emitModuleEvent(name, payload: payload)
        }
      }
    )
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

  @MainActor
  func setOutgoingAudioMuted(_ muted: Bool) {
    isOutgoingAudioMuted = muted
    if let audioTrack {
      audioTrack.isEnabled = !muted
      emit(.info, muted ? "Outgoing audio muted" : "Outgoing audio unmuted", metadata: [
        "hasAudioTrack": true
      ])
    } else {
      emit(.debug, "Queued outgoing audio mute state", metadata: [
        "muted": muted,
        "hasAudioTrack": false
      ])
    }
  }

  func setToolDefinitions(_ definitions: [[String: Any]]) {
    self.toolDefinitions = definitions
    emit(.debug, "Configured tool definitions from JavaScript", metadata: [
      "count": definitions.count
    ])
  }

  func appendToolDefinition(
    for delegate: BaseTool?,
    warningMessage: String,
    definitionsByName: [String: [String: Any]],
    tools: inout [[String: Any]]
  ) {
    guard let delegate else { return }
    let toolName = delegate.toolName
    if let definition = definitionsByName[toolName] {
      tools.append(definition)
    } else {
      emit(
        .warn,
        warningMessage,
        metadata: [
          "toolName": toolName,
          "availableDefinitions": Array(definitionsByName.keys)
        ]
      )
    }
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

  public func emit(
    _ level: NativeLogLevel,
    _ message: String,
    metadata: [String: Any]? = nil
  ) {
    var resolvedMetadata = metadata ?? [:]
    resolvedMetadata["level"] = level.rawValue

    // Always print, even in Release builds; structured attributes carry the context.
    self.logger.log("[VmWebrtc][\(level.rawValue.uppercased())] \(message)", attributes: resolvedMetadata)
  }

  @MainActor
  func emitModuleEvent(_ name: String, payload: [String: Any]) {
    guard let moduleEventEmitter else {
      emit(.debug, "No module event emitter configured; dropping event", metadata: [
        "event": name
      ])
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
      self.emit(.error, "Received empty instructions for OpenAI session")
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

    eventHandler.stopIdleMonitoring(reason: "starting_new_connection")

    self.emit(
      .info,
      "Starting OpenAI WebRTC connection",
      metadata: [
        "hasModel": (model?.isEmpty == false),
        "hasBaseURL": (baseURL?.isEmpty == false),
        "audioOutput": audioOutput.rawValue,
        "voice": sessionVoice,
        "recordingEnabled": enableRecording
      ]
    )
    // Persist recording preferences
    self.isRecordingEnabled = enableRecording

    self.emit(.debug, "Resolved session instructions", metadata: [
      "characterCount": sanitizedInstructions.count
    ])

    self.emit(.debug, "Resolved session voice", metadata: [
      "hasCustom": sanitizedVoice?.isEmpty == false
    ])

    self.emit(.debug, "Resolved turn detection mode", metadata: [
      "mode": turnDetectionMode.rawValue
    ])

    self.emit(.debug, "Resolved session audio speed", metadata: [
      "speed": sessionAudioSpeed
    ])

    let endpointURL = try buildEndpointURL(baseURL: baseURL, model: model)
    self.emit(.debug, "Resolved OpenAI endpoint", metadata: ["endpoint": endpointURL.absoluteString])

    try configureAudioSession(for: audioOutput)
    self.emit(.debug, "Configured AVAudioSession for voice chat", metadata: [
      "requestedOutput": audioOutput.rawValue
    ])

    let audioSession = AVAudioSession.sharedInstance()

    if enableRecording {
      do {
        try await recordingManager.startRecording(
          using: audioSession,
          apiKey: apiKey,
          voice: sessionVoice
        )
      } catch {
        self.emit(
          .warn,
          "Failed to start recording",
          metadata: [
            "error": error.localizedDescription
          ]
        )
      }
    } else {
      self.emit(.info, "Recording disabled by user preference", metadata: [
        "recordingRequested": enableRecording,
        "reason": "user_preference"
      ])
    }

    let connection = try makePeerConnection()
    firstCandidateTimestamp = nil
    self.emit(.debug, "Peer connection prepared", metadata: [
      "hasAudioTrack": audioTrack != nil,
      "hasDataChannel": dataChannel != nil
    ])
    let offer = try await createOffer(connection: connection)
    self.emit(.debug, "Created local SDP offer", metadata: ["hasSDP": !offer.sdp.isEmpty])
    try await setLocalDescription(offer, for: connection)
    self.emit(.debug, "Local description applied")
    let iceWait = try await waitForIceGathering(on: connection, timeout: iceGatheringGracePeriod)
    self.emit(.debug, "Continuing after ICE wait", metadata: [
      "state": connection.iceGatheringState.rawValue,
      "elapsedSeconds": iceWait,
      "timedOut": connection.iceGatheringState != .complete
    ])

    guard let localSDP = connection.localDescription?.sdp else {
      self.emit(.error, "Local description missing after ICE gathering")
      throw OpenAIWebRTCError.missingLocalDescription
    }

    let answerSDP = try await exchangeSDPWithOpenAI(apiKey: apiKey, endpointURL: endpointURL, offerSDP: localSDP)
    let remoteDescription = RTCSessionDescription(type: .answer, sdp: answerSDP)
    try await setRemoteDescription(remoteDescription, for: connection)
    self.emit(.debug, "Remote description applied")

    let state = try await waitForConnection(toReach: connection, timeout: 15)
    self.emit(
      .info,
      "OpenAI WebRTC connection flow finished",
      metadata: ["state": state]
    )

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
      self.emit(
        .info,
        "Closing OpenAI WebRTC connection"
      )

      eventHandler.stopIdleMonitoring(reason: "connection_closed")
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
        self.emit(.debug, "Data channel closed", metadata: ["label": dataChannel.label])
      }
      dataChannel = nil

      if let audioTrack {
        audioTrack.isEnabled = false
      }
      audioTrack = nil

      if let connection = peerConnection {
        connection.delegate = nil
        connection.close()
        self.emit(.debug, "Peer connection closed", metadata: [
          "signalingState": connection.signalingState.rawValue,
          "iceState": stringValue(for: connection.iceConnectionState)
        ])
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
        self.emit(.info, "Recording was disabled - skipping TTS generation and merge")
        recordingManager.reset()
      }

      stopMonitoringAudioRouteChanges()
      deactivateAudioSession()

    self.emit(
      .info,
      "OpenAI WebRTC connection teardown completed",
      metadata: [
        "recordingEnabled": isRecordingEnabled,
        "hadPeerConnection": peerConnection != nil
      ]
    )

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
      emit(.debug, "Tool call result sent", metadata: [
        "callId": callId,
        "resultLength": result.count
      ])
      eventHandler.recordExternalActivity(reason: "tool_call_result")

      // Continue conversation
      sendEvent(["type": "response.create"])
    } else {
      emit(.error, "Failed to send tool call result", metadata: [
        "callId": callId
      ])
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

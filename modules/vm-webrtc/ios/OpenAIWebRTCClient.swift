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
  @MainActor private lazy var recordingManager: VoiceSessionRecordingManager = {
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
  private var isRecordingEnabled: Bool = false
  
  public enum NativeLogLevel: String {
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

  private enum OutputRoute {
    case speaker
    case receiver
  }

  private enum Constants {
    static let idleTimeoutSeconds = WebRTCEventHandler.defaultIdleTimeout
  }

  private let factory: RTCPeerConnectionFactory
  private var peerConnection: RTCPeerConnection?
  private var audioTrack: RTCAudioTrack?
  private var remoteAudioTrackId: String?
  private var isOutgoingAudioMuted = false
  private var dataChannel: RTCDataChannel?
  private var iceGatheringContinuation: CheckedContinuation<Void, Error>?
  private var connectionContinuation: CheckedContinuation<String, Error>?
  private var connectionTimeoutTask: Task<Void, Never>?
  private var iceGatheringTimeoutTask: Task<Void, Never>?
  private var firstCandidateTimestamp: Date?
  private var iceGatheringStartTimestamp: Date?
  private var isMonitoringAudioRoute = false
  private var hasSentInitialSessionConfig = false
  private var sessionInstructions: String
  private let defaultVoice = "cedar"
  private var sessionVoice: String
  private var sessionAudioSpeed: Double
  private var turnDetectionMode: TurnDetectionMode = .semantic
  private var maxConversationTurns: Int?
  private var retentionRatio: Double?
  private let retentionRatioScale: Int = 2

  // Reference to the github connector tool delegate
  private weak var githubConnectorDelegate: BaseTool?

  // Add: Reference to the GDrive connector tool delegate
  private weak var gdriveConnectorDelegate: BaseTool?
  private weak var gpt5GDriveFixerDelegate: BaseTool?
  private weak var gpt5WebSearchDelegate: BaseTool?
  private var hackerNewsDelegates: [String: BaseTool] = [:]

  private var toolDefinitions: [[String: Any]] = []
  private lazy var eventHandler: WebRTCEventHandler = {
    WebRTCEventHandler { [weak self] level, message, metadata in
      self?.emit(level, message, metadata: metadata)
    }
  }()
  private lazy var inboundAudioMonitor: InboundAudioStatsMonitor = {
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
  private lazy var outboundAudioMonitor: OutboundAudioStatsMonitor = {
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
  private var minimumLogLevel: NativeLogLevel = .debug

  private func makeEventHandlerContext() -> WebRTCEventHandler.ToolContext {
    WebRTCEventHandler.ToolContext(
      githubConnectorDelegate: githubConnectorDelegate,
      gdriveConnectorDelegate: gdriveConnectorDelegate,
      gpt5GDriveFixerDelegate: gpt5GDriveFixerDelegate,
      gpt5WebSearchDelegate: gpt5WebSearchDelegate,
      hackerNewsDelegates: hackerNewsDelegates,
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

  private func quantizedRetentionRatio(_ ratio: Double) -> NSNumber {
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

  func setHackerNewsDelegates(_ delegates: [String: BaseTool]) {
    self.hackerNewsDelegates = delegates
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

  private func appendToolDefinition(
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
        ],
        propagateToReactNative: true
      )
    }
  }

  private let defaultEndpoint = "https://api.openai.com/v1/realtime"
  private let defaultModel = "gpt-realtime"
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
    metadata: [String: Any]? = nil,
    propagateToReactNative: Bool = false,
    sourceFile: StaticString = #fileID
  ) {
    guard shouldLog(level) else { return }

    let metaText: String
    if let metadata, !metadata.isEmpty {
      let rendered = metadata.map { entry in
        "\(entry.key)=\(String(describing: entry.value))"
      }.joined(separator: " ")
      metaText = " " + rendered
    } else {
      metaText = ""
    }
    // Always print, even in Release builds
    print("[VmWebrtc][\(level.rawValue.uppercased())] \(message)\(metaText)")

    let shouldPropagate = propagateToReactNative || level == .error

    guard shouldPropagate else { return }

    var payload: [String: Any] = [
      "level": level.rawValue,
      "message": message,
      "sourceFile": String(describing: sourceFile),
      "timestampMs": Int(Date().timeIntervalSince1970 * 1000)
    ]

    if let metadata, !metadata.isEmpty {
      payload["metadata"] = metadata
    }

    Task { [weak self] in
      guard let self else { return }
      await MainActor.run {
        self.emitModuleEvent("onNativeLog", payload: payload)
      }
    }
  }

  @MainActor
  private func emitModuleEvent(_ name: String, payload: [String: Any]) {
    guard let moduleEventEmitter else {
      emit(.debug, "No module event emitter configured; dropping event", metadata: [
        "event": name
      ])
      return
    }
    moduleEventEmitter(name, payload)
  }

  func setMinimumLogLevel(_ level: NativeLogLevel) {
    minimumLogLevel = level
  }

  private func shouldLog(_ level: NativeLogLevel) -> Bool {
    logPriority(for: level) >= logPriority(for: minimumLogLevel)
  }

  private func logPriority(for level: NativeLogLevel) -> Int {
    switch level {
    case .debug: return 0
    case .info: return 1
    case .warn: return 2
    case .error: return 3
    }
  }

  private func convertLogLevel(_ levelString: String) -> NativeLogLevel {
    switch levelString.lowercased() {
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
      ],
      propagateToReactNative: true
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
          ],
          propagateToReactNative: true
        )
      }
    } else {
      self.emit(.info, "Recording disabled by user preference")
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
      metadata: ["state": state],
      propagateToReactNative: true
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
        "Closing OpenAI WebRTC connection",
        propagateToReactNative: true
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
        propagateToReactNative: true
      )

      return "closed"
  }

  // MARK: - Helper Methods

  private func buildEndpointURL(baseURL: String?, model: String?) throws -> URL {
    let endpoint = (baseURL?.isEmpty == false ? baseURL! : defaultEndpoint)
    self.emit(.debug, "Building OpenAI endpoint URL", metadata: ["base": endpoint])
    guard var components = URLComponents(string: endpoint) else {
      self.emit(.error, "Failed to parse OpenAI endpoint", metadata: ["endpoint": endpoint])
      throw OpenAIWebRTCError.invalidEndpoint
    }

    var items = components.queryItems ?? []
    if items.contains(where: { $0.name == "model" }) == false {
      items.append(URLQueryItem(name: "model", value: (model?.isEmpty == false ? model! : defaultModel)))
    }
    components.queryItems = items

    guard let url = components.url else {
      self.emit(.error, "Failed to build final OpenAI endpoint URL", metadata: ["endpoint": endpoint])
      throw OpenAIWebRTCError.invalidEndpoint
    }
    self.emit(.debug, "OpenAI endpoint URL ready", metadata: ["url": url.absoluteString])
    return url
  }

  private func configureAudioSession(for output: AudioOutputPreference) throws {
    let desiredRoute: OutputRoute = (output == .speakerphone) ? .speaker : .receiver
    let session = AVAudioSession.sharedInstance()
    emit(.debug, "Configuring AVAudioSession route", metadata: [
      "desiredRoute": desiredRoute == .speaker ? "speaker" : "receiver",
      "currentCategory": session.category.rawValue,
      "currentMode": session.mode.rawValue,
      "categoryOptions": describeCategoryOptions(session.categoryOptions),
      "currentOutputs": describeAudioOutputs(session.currentRoute),
      "outputVolume": session.outputVolume
    ])
    configureWebRTCAudioSession(for: desiredRoute)
    setOutput(desiredRoute)
    startMonitoringAudioRouteChanges()
  }

  private func configureWebRTCAudioSession(for route: OutputRoute) {
    let configuration = RTCAudioSessionConfiguration.webRTC()
    configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
    configuration.category = AVAudioSession.Category.playAndRecord.rawValue

    var options: AVAudioSession.CategoryOptions = [.allowBluetooth]
    if route == .speaker {
      options.insert(.defaultToSpeaker)
    }
    configuration.categoryOptions = options

    RTCAudioSessionConfiguration.setWebRTC(configuration)
    emit(.debug, "Applied WebRTC audio session defaults", metadata: [
      "route": route == .speaker ? "speaker" : "receiver",
      "mode": configuration.mode,
      "category": configuration.category,
      "options": describeCategoryOptions(options)
    ])
  }

  private func setOutput(_ route: OutputRoute) {
    let rtcSession = RTCAudioSession.sharedInstance()
    rtcSession.lockForConfiguration()
    defer { rtcSession.unlockForConfiguration() }

    let session = AVAudioSession.sharedInstance()

    do {
      emit(.debug, "Setting audio session category", metadata: [
        "route": route == .speaker ? "speaker" : "receiver",
        "previousCategory": session.category.rawValue,
        "previousMode": session.mode.rawValue,
        "previousOptions": describeCategoryOptions(session.categoryOptions),
        "previousOutputs": describeAudioOutputs(session.currentRoute)
      ])

      var options: AVAudioSession.CategoryOptions = [.allowBluetooth]
      if route == .speaker {
        options.insert(.defaultToSpeaker)
      }

      try session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
      try session.setActive(true)

      let overridePort: AVAudioSession.PortOverride = (route == .speaker) ? .speaker : .none
      try session.overrideOutputAudioPort(overridePort)

      emit(.info, "Audio route updated", metadata: [
        "override": overridePort == .speaker ? "speaker" : "receiver",
        "category": session.category.rawValue,
        "mode": session.mode.rawValue,
        "options": describeCategoryOptions(session.categoryOptions),
        "currentOutputs": describeAudioOutputs(session.currentRoute),
        "currentInputs": describeAudioInputs(session.currentRoute),
        "outputVolume": session.outputVolume
      ])
    } catch {
      emit(.error, "Audio route switch failed", metadata: [
        "override": route == .speaker ? "speaker" : "receiver",
        "error": error.localizedDescription,
        "category": session.category.rawValue,
        "mode": session.mode.rawValue,
        "options": describeCategoryOptions(session.categoryOptions),
        "currentOutputs": describeAudioOutputs(session.currentRoute)
      ])
    }
  }

  private func startMonitoringAudioRouteChanges() {
    guard !isMonitoringAudioRoute else { return }
    RTCAudioSession.sharedInstance().add(self)
    isMonitoringAudioRoute = true
    let session = AVAudioSession.sharedInstance()
    emit(.debug, "Started monitoring audio routes", metadata: [
      "category": session.category.rawValue,
      "mode": session.mode.rawValue,
      "options": describeCategoryOptions(session.categoryOptions),
      "currentOutputs": describeAudioOutputs(session.currentRoute),
      "outputVolume": session.outputVolume
    ])
  }

  private func stopMonitoringAudioRouteChanges() {
    guard isMonitoringAudioRoute else { return }
    RTCAudioSession.sharedInstance().remove(self)
    isMonitoringAudioRoute = false
    let session = AVAudioSession.sharedInstance()
    emit(.debug, "Stopped monitoring audio routes", metadata: [
      "category": session.category.rawValue,
      "mode": session.mode.rawValue,
      "options": describeCategoryOptions(session.categoryOptions),
      "currentOutputs": describeAudioOutputs(session.currentRoute)
    ])
  }

  private func deactivateAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
      emit(.debug, "AVAudioSession deactivated", metadata: [
        "category": session.category.rawValue,
        "mode": session.mode.rawValue
      ])
    } catch {
      emit(
        .warn,
        "Failed to deactivate AVAudioSession",
        metadata: [
          "error": error.localizedDescription,
          "category": session.category.rawValue,
          "mode": session.mode.rawValue
        ],
        propagateToReactNative: true
      )
    }
  }

  private func describeAudioOutputs(_ route: AVAudioSessionRouteDescription) -> String {
    let outputs = route.outputs.map { output in
      let name = output.portName
      return "\(output.portType.rawValue)(\(name))"
    }
    return outputs.isEmpty ? "none" : outputs.joined(separator: ", ")
  }

  private func describeAudioInputs(_ route: AVAudioSessionRouteDescription) -> String {
    let inputs = route.inputs.map { input in
      let name = input.portName
      return "\(input.portType.rawValue)(\(name))"
    }
    return inputs.isEmpty ? "none" : inputs.joined(separator: ", ")
  }

  private func describeCategoryOptions(_ options: AVAudioSession.CategoryOptions) -> String {
    var flags: [String] = []
    if options.contains(.mixWithOthers) { flags.append("mixWithOthers") }
    if options.contains(.duckOthers) { flags.append("duckOthers") }
    if options.contains(.allowBluetooth) { flags.append("allowBluetooth") }
    if options.contains(.defaultToSpeaker) { flags.append("defaultToSpeaker") }
    if options.contains(.interruptSpokenAudioAndMixWithOthers) { flags.append("interruptSpokenAudioAndMixWithOthers") }
    if options.contains(.allowBluetoothA2DP) { flags.append("allowBluetoothA2DP") }
    if options.contains(.allowAirPlay) { flags.append("allowAirPlay") }
    return flags.isEmpty ? "none" : flags.joined(separator: ", ")
  }

  private func describeRouteChangeReason(_ reason: AVAudioSession.RouteChangeReason) -> String {
    switch reason {
    case .unknown: return "unknown"
    case .newDeviceAvailable: return "newDeviceAvailable"
    case .oldDeviceUnavailable: return "oldDeviceUnavailable"
    case .categoryChange: return "categoryChange"
    case .override: return "override"
    case .wakeFromSleep: return "wakeFromSleep"
    case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
    case .routeConfigurationChange: return "routeConfigurationChange"
    @unknown default: return "unknown(\(reason.rawValue))"
    }
  }

  private func startInboundAudioStatsMonitoring() {
    inboundAudioMonitor.start()
  }

  private func stopInboundAudioStatsMonitoring() {
    inboundAudioMonitor.stop()
  }

  private func startOutboundAudioStatsMonitoring() {
    outboundAudioMonitor.start()
  }

  private func stopOutboundAudioStatsMonitoring() {
    outboundAudioMonitor.stop()
  }

  private func makePeerConnection() throws -> RTCPeerConnection {
    if let existingConnection = peerConnection {
      self.emit(
        .warn,
        "Disposing existing peer connection before creating a new one",
        propagateToReactNative: true
      )
      stopInboundAudioStatsMonitoring()
      stopOutboundAudioStatsMonitoring()
      remoteAudioTrackId = nil
      existingConnection.close()
      peerConnection = nil
    }

    hasSentInitialSessionConfig = false

    iceGatheringTimeoutTask?.cancel()
    iceGatheringTimeoutTask = nil
    iceGatheringStartTimestamp = nil

    let configuration = RTCConfiguration()
    configuration.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
    configuration.iceCandidatePoolSize = 1
    configuration.continualGatheringPolicy = .gatherContinually

    let constraints = RTCMediaConstraints(
      mandatoryConstraints: nil,
      optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
    )

    guard let connection = factory.peerConnection(
      with: configuration,
      constraints: constraints,
      delegate: self
    ) else {
      self.emit(.error, "Failed to create RTCPeerConnection instance")
      throw OpenAIWebRTCError.connectionFailed("peerConnectionFactory returned nil")
    }

    self.emit(.debug, "Created RTCPeerConnection", metadata: [
      "iceServers": configuration.iceServers.count,
    ])

    let audioConstraints = RTCMediaConstraints(
      mandatoryConstraints: [
        "googEchoCancellation": "true",
        "googAutoGainControl": "true",
        "googHighpassFilter": "true",
        "googNoiseSuppression": "true"
      ],
      optionalConstraints: nil
    )

    let audioSource = factory.audioSource(with: audioConstraints)
    let audioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")

    guard connection.add(audioTrack, streamIds: ["stream0"]) != nil else {
      self.emit(.error, "Failed to attach audio track to peer connection")
      throw OpenAIWebRTCError.failedToAddAudioTrack
    }


    self.audioTrack = audioTrack
    audioTrack.isEnabled = !isOutgoingAudioMuted
    self.emit(.debug, "Attached audio track to peer connection")

    let dataChannelConfig = RTCDataChannelConfiguration()
    dataChannelConfig.channelId = 0
    dataChannelConfig.isOrdered = true
    dataChannel = connection.dataChannel(forLabel: "oai-events", configuration: dataChannelConfig)

    if let dataChannel {
      dataChannel.delegate = self
      self.emit(.debug, "Created data channel", metadata: [
        "label": dataChannel.label,
        "isOrdered": dataChannelConfig.isOrdered,
        "channelId": dataChannelConfig.channelId
      ])
    } else {
      self.emit(.error, "Failed to create data channel")
    }

    peerConnection = connection

    return connection
  }

  private func createOffer(connection: RTCPeerConnection) async throws -> RTCSessionDescription {
    let constraints = RTCMediaConstraints(
      mandatoryConstraints: ["OfferToReceiveAudio": "true"],
      optionalConstraints: ["OfferToReceiveVideo": "false"]
    )

    return try await withCheckedThrowingContinuation { continuation in
      connection.offer(for: constraints) { sdp, error in
        if let error = error {
          self.emit(.error, "Failed to create local SDP offer", metadata: ["error": error.localizedDescription])
          continuation.resume(throwing: error)
          return
        }

        guard let sdp = sdp else {
          self.emit(.error, "Peer connection returned an empty SDP offer")
          continuation.resume(throwing: OpenAIWebRTCError.connectionFailed("failed"))
          return
        }

        self.emit(.debug, "Local SDP offer ready", metadata: ["sdpLength": sdp.sdp.count])
        continuation.resume(returning: sdp)
      }
    }
  }

  private func setLocalDescription(_ description: RTCSessionDescription, for connection: RTCPeerConnection) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      connection.setLocalDescription(description) { error in
        if let error = error {
          self.emit(.error, "Failed to set local description", metadata: ["error": error.localizedDescription])
          continuation.resume(throwing: error)
        } else {
          self.emit(.debug, "Local description successfully set")
          continuation.resume(returning: ())
        }
      }
    }
  }

  private func setRemoteDescription(_ description: RTCSessionDescription, for connection: RTCPeerConnection) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      connection.setRemoteDescription(description) { error in
        if let error = error {
          self.emit(.error, "Failed to set remote description", metadata: ["error": error.localizedDescription])
          continuation.resume(throwing: error)
        } else {
          self.emit(.debug, "Remote description successfully set")
          continuation.resume(returning: ())
        }
      }
    }
  }

  private func waitForIceGathering(on connection: RTCPeerConnection, timeout: TimeInterval?) async throws -> TimeInterval {
    if connection.iceGatheringState == .complete {
      self.emit(.debug, "ICE gathering already complete", metadata: ["state": connection.iceGatheringState.rawValue])
      return 0
    }

    self.emit(.debug, "Waiting for ICE gathering to complete", metadata: [
      "state": connection.iceGatheringState.rawValue,
      "timeoutSeconds": timeout ?? 0
    ])

    let start = Date()
    iceGatheringStartTimestamp = start

    defer {
      iceGatheringTimeoutTask?.cancel()
      iceGatheringTimeoutTask = nil
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      iceGatheringContinuation = continuation

      if let timeout, timeout > 0 {
        iceGatheringTimeoutTask?.cancel()
        iceGatheringTimeoutTask = Task { [weak self] in
          let nanoseconds = UInt64(timeout * 1_000_000_000)
          do {
            try await Task.sleep(nanoseconds: nanoseconds)
          } catch is CancellationError {
            return
          } catch {
            return
          }

          guard let self, !Task.isCancelled else { return }

          await MainActor.run { [weak self] in
            guard let self else { return }
            guard let continuation = self.iceGatheringContinuation else { return }
            self.emit(
              .warn,
              "ICE gathering timeout reached; sending offer with partial candidates",
              metadata: [
                "timeoutSeconds": timeout,
                "currentState": connection.iceGatheringState.rawValue
              ],
              propagateToReactNative: true
            )
            self.iceGatheringTimeoutTask = nil
            self.iceGatheringContinuation = nil
            continuation.resume(returning: ())
          }
        }
      }
    }

    let elapsed = Date().timeIntervalSince(start)
    iceGatheringStartTimestamp = nil
    return elapsed
  }

  private func exchangeSDPWithOpenAI(apiKey: String, endpointURL: URL, offerSDP: String) async throws -> String {
    self.emit(.debug, "Sending SDP offer to OpenAI", metadata: [
      "endpoint": endpointURL.absoluteString,
      "sdpLength": offerSDP.count
    ])

    var request = URLRequest(url: endpointURL)
    request.httpMethod = "POST"
    request.httpBody = offerSDP.data(using: .utf8)
    request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      self.emit(.error, "OpenAI response missing HTTP status")
      throw OpenAIWebRTCError.openAIResponseDecoding
    }

    guard (200..<300).contains(httpResponse.statusCode) else {
      self.emit(.error, "OpenAI rejected SDP offer", metadata: ["status": httpResponse.statusCode])
      throw OpenAIWebRTCError.openAIRejected(httpResponse.statusCode)
    }

    guard let answer = String(data: data, encoding: .utf8), answer.isEmpty == false else {
      self.emit(.error, "OpenAI returned an empty SDP answer")
      throw OpenAIWebRTCError.openAIResponseDecoding
    }

    self.emit(.debug, "Received SDP answer from OpenAI", metadata: ["sdpLength": answer.count])
    return answer
  }

  private func waitForConnection(toReach connection: RTCPeerConnection, timeout: TimeInterval) async throws -> String {
    if connection.iceConnectionState == .connected || connection.iceConnectionState == .completed {
      self.emit(
        .info,
        "OpenAI WebRTC connection established",
        metadata: ["state": stringValue(for: connection.iceConnectionState)],
        propagateToReactNative: true
      )
      return stringValue(for: connection.iceConnectionState)
    }

    self.emit(.debug, "Waiting for ICE connection state to reach connected", metadata: [
      "currentState": stringValue(for: connection.iceConnectionState),
      "timeoutSeconds": timeout
    ])
    return try await withCheckedThrowingContinuation { continuation in
      connectionContinuation = continuation
      connectionTimeoutTask?.cancel()
      connectionTimeoutTask = Task { [weak self] in
        let nanoseconds = UInt64(timeout * 1_000_000_000)
        do {
          try await Task.sleep(nanoseconds: nanoseconds)
        } catch is CancellationError {
          return
        } catch {
          return
        }

        guard let self, !Task.isCancelled else { return }

        self.emit(.error, "Timed out waiting for ICE connection state to reach connected", metadata: [
          "lastState": stringValue(for: connection.iceConnectionState),
          "timeoutSeconds": timeout
        ])
        self.failPendingConnection(with: OpenAIWebRTCError.connectionTimeout)
      }
    }
  }

  private func failPendingConnection(with error: OpenAIWebRTCError) {
    self.emit(.error, "Failing pending OpenAI WebRTC connection", metadata: ["reason": error.localizedDescription])
    connectionTimeoutTask?.cancel()
    connectionTimeoutTask = nil
    connectionContinuation?.resume(throwing: error)
    connectionContinuation = nil
    eventHandler.stopIdleMonitoring(reason: "connection_failure")
  }

  @MainActor
  private func handleIdleTimeoutTriggered() {
    guard peerConnection != nil || dataChannel != nil else {
      emit(.debug, "[IdleTimer] Timeout fired without an active session; ignoring")
      return
    }

    emit(
      .warn,
      "[IdleTimer] Inactivity threshold reached, disconnecting session",
      metadata: [
        "timeoutSeconds": Constants.idleTimeoutSeconds
      ],
      propagateToReactNative: true
    )

    let previousState = closeConnection()
    let timestampMs = Int(Date().timeIntervalSince1970 * 1000)

    emitModuleEvent("onIdleTimeout", payload: [
      "reason": "idleTimeout",
      "timeoutSeconds": Int(Constants.idleTimeoutSeconds),
      "previousState": previousState,
      "timestampMs": timestampMs
    ])
  }

  private func sendInitialSessionConfiguration() {
    guard !hasSentInitialSessionConfig else {
      return
    }

    guard let dataChannel, dataChannel.readyState == .open else {
      emit(
        .warn,
        "Data channel not ready for initial session configuration",
        metadata: [
          "hasChannel": dataChannel != nil
        ],
        propagateToReactNative: true
      )
      return
    }

    var tools: [[String: Any]] = []
    var definitionsByName: [String: [String: Any]] = [:]

    for definition in toolDefinitions {
      guard let name = definition["name"] as? String, !name.isEmpty else {
        emit(
          .warn,
          "Encountered tool definition without a valid name. Skipping.",
          propagateToReactNative: true
        )
        continue
      }
      definitionsByName[name] = definition
    }

    let delegateWarnings: [(BaseTool?, String)] = [
      (githubConnectorDelegate, "No JavaScript-provided definition found for github connector tool"),
      (gdriveConnectorDelegate, "No JavaScript-provided definition found for gdrive connector tool"),
      (gpt5GDriveFixerDelegate, "No JavaScript-provided definition found for GPT5 gdrive fixer tool"),
      (gpt5WebSearchDelegate, "No JavaScript-provided definition found for GPT5 web search tool")
    ]

    for (delegate, warning) in delegateWarnings {
      appendToolDefinition(
        for: delegate,
        warningMessage: warning,
        definitionsByName: definitionsByName,
        tools: &tools
      )
    }

    var hackerNewsToolsAdded: [String] = []
    for (name, delegate) in hackerNewsDelegates {
      let previousCount = tools.count
      appendToolDefinition(
        for: delegate,
        warningMessage: "No JavaScript-provided definition found for Hacker News tool \(name)",
        definitionsByName: definitionsByName,
        tools: &tools
      )
      if tools.count > previousCount {
        hackerNewsToolsAdded.append(name)
      }
    }

    if !hackerNewsDelegates.isEmpty {
      let missing = Set(hackerNewsDelegates.keys).subtracting(Set(hackerNewsToolsAdded))
      if hackerNewsToolsAdded.isEmpty {
        emit(
          .warn,
          "Hacker News tool delegates configured but no matching definitions were provided",
          metadata: [
            "delegateCount": hackerNewsDelegates.count,
            "missingNames": Array(missing),
            "availableDefinitionNames": Array(definitionsByName.keys)
          ],
          propagateToReactNative: true
        )
      } else {
        emit(
          .info,
          "Hacker News tool delegates resolved for session",
          metadata: [
            "delegateCount": hackerNewsDelegates.count,
            "attachedTools": hackerNewsToolsAdded,
            "missingNames": Array(missing)
          ]
        )
      }
    }

    if tools.isEmpty && !toolDefinitions.isEmpty {
      emit(
        .warn,
        "Tool definitions were provided from JavaScript but none matched configured delegates",
        metadata: [
          "definitionCount": toolDefinitions.count
        ],
        propagateToReactNative: true
      )
    }

    var session: [String: Any] = [
      "instructions": sessionInstructions,
      "voice": sessionVoice,
      "tools": tools
    ]

    switch turnDetectionMode {
    case .semantic:
      session["turn_detection"] = [
        "type": "semantic_vad",
        "create_response": true,
        "eagerness": "low"
      ]
    case .server:
      session["turn_detection"] = [
        "type": "server_vad",
        "create_response": true
      ]
    }

    if let ratio = retentionRatio {
      session["truncation"] = [
        "type": "retention_ratio",
        "retention_ratio": quantizedRetentionRatio(ratio)
      ]
    }

    if let prettyData = try? JSONSerialization.data(withJSONObject: session, options: [.prettyPrinted]),
       let prettyString = String(data: prettyData, encoding: .utf8) {
      emit(
        .debug,
        "📑 Sending session.update payload",
        metadata: ["session": prettyString],
        propagateToReactNative: true
      )
    } else {
      emit(
        .debug,
        "📑 Sending session.update payload (fallback formatting)",
        metadata: ["session": session],
        propagateToReactNative: true
      )
    }

    _ = sendEvent([
      "type": "session.update",
      "session": session
    ])

    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(300)) { [weak self] in
      guard let strongSelf = self else {
        return
      }

      strongSelf.sendEvent(["type": "response.create"])
    }
  }

  @discardableResult
  private func sendEvent(_ payload: [String: Any]) -> Bool {
    guard let dataChannel else {
      emit(.error, "Attempted to send event without an active data channel")
      return false
    }

    do {
      let data = try JSONSerialization.data(withJSONObject: payload, options: [])
      let buffer = RTCDataBuffer(data: data, isBinary: false)
      let success = dataChannel.sendData(buffer)
      emit(.debug, "Sent data channel event", metadata: [
        "bytes": data.count,
        "success": success
      ])
      return success
    } catch {
      emit(.error, "Failed to encode event payload", metadata: [
        "error": error.localizedDescription
      ])
      return false
    }
  }


  private func stringValue(for state: RTCDataChannelState) -> String {
    switch state {
    case .connecting: return "connecting"
    case .open: return "open"
    case .closing: return "closing"
    case .closed: return "closed"
    @unknown default: return "unknown"
    }
  }
}

extension OpenAIWebRTCClient: RTCAudioSessionDelegate {
  func audioSession(_ audioSession: RTCAudioSession, didSetActive active: Bool) {
    let session = AVAudioSession.sharedInstance()
    emit(.debug, "RTCAudioSession didSetActive", metadata: [
      "active": active,
      "category": session.category.rawValue,
      "mode": session.mode.rawValue,
      "options": describeCategoryOptions(session.categoryOptions),
      "currentOutputs": describeAudioOutputs(session.currentRoute),
      "currentInputs": describeAudioInputs(session.currentRoute),
      "outputVolume": session.outputVolume
    ])
  }

  func audioSession(
    _ audioSession: RTCAudioSession,
    didChange routeChangeReason: AVAudioSession.RouteChangeReason,
    previousRoute: AVAudioSessionRouteDescription
  ) {
    emit(.debug, "Audio route change detected", metadata: [
      "reason": describeRouteChangeReason(routeChangeReason),
      "rawReason": routeChangeReason.rawValue,
      "previousOutputs": describeAudioOutputs(previousRoute),
      "previousInputs": describeAudioInputs(previousRoute),
      "currentOutputs": describeAudioOutputs(AVAudioSession.sharedInstance().currentRoute),
      "currentInputs": describeAudioInputs(AVAudioSession.sharedInstance().currentRoute),
      "category": AVAudioSession.sharedInstance().category.rawValue,
      "mode": AVAudioSession.sharedInstance().mode.rawValue,
      "options": describeCategoryOptions(AVAudioSession.sharedInstance().categoryOptions),
      "outputVolume": AVAudioSession.sharedInstance().outputVolume
    ])
  }

  func audioSession(_ audioSession: RTCAudioSession, didChange canPlayOrRecord: Bool) {
    let session = AVAudioSession.sharedInstance()
    emit(.debug, "RTCAudioSession canPlayOrRecord changed", metadata: [
      "canPlayOrRecord": canPlayOrRecord,
      "category": session.category.rawValue,
      "mode": session.mode.rawValue,
      "options": describeCategoryOptions(session.categoryOptions),
      "currentOutputs": describeAudioOutputs(session.currentRoute),
      "currentInputs": describeAudioInputs(session.currentRoute)
    ])
  }
}

extension OpenAIWebRTCClient: RTCPeerConnectionDelegate {
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}

  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
    guard let audioTrack = stream.audioTracks.first else {
      emit(.debug, "Remote stream added without audio tracks", metadata: [
        "audioTrackCount": stream.audioTracks.count,
        "videoTrackCount": stream.videoTracks.count
      ])
      return
    }

    remoteAudioTrackId = audioTrack.trackId
    inboundAudioMonitor.reset()

    emit(.info, "Remote audio track received", metadata: [
      "trackId": audioTrack.trackId,
      "streamId": stream.streamId
    ])
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {
    guard let removedTrack = stream.audioTracks.first else { return }

    if removedTrack.trackId == remoteAudioTrackId {
      emit(.info, "Remote audio track removed", metadata: [
        "trackId": removedTrack.trackId,
        "streamId": stream.streamId
      ])
      remoteAudioTrackId = nil
      inboundAudioMonitor.reset()
      stopInboundAudioStatsMonitoring()
      stopOutboundAudioStatsMonitoring()
    }
  }

  func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
    self.emit(.debug, "ICE connection state changed", metadata: ["state": stringValue(for: newState)])
    guard let continuation = connectionContinuation else {
      return
    }

    switch newState {
    case .connected, .completed:
      startInboundAudioStatsMonitoring()
      startOutboundAudioStatsMonitoring()
      self.emit(
        .info,
        "OpenAI WebRTC connection established",
        metadata: ["state": stringValue(for: newState)],
        propagateToReactNative: true
      )
      connectionTimeoutTask?.cancel()
      connectionTimeoutTask = nil
      connectionContinuation = nil
      continuation.resume(returning: self.stringValue(for: newState))
    case .failed, .disconnected, .closed:
      stopInboundAudioStatsMonitoring()
      stopOutboundAudioStatsMonitoring()
      self.emit(
        .error,
        "OpenAI WebRTC connection failed",
        metadata: ["state": stringValue(for: newState)]
      )
      connectionTimeoutTask?.cancel()
      connectionTimeoutTask = nil
      connectionContinuation = nil
      continuation.resume(throwing: OpenAIWebRTCError.connectionFailed(self.stringValue(for: newState)))
    case .checking, .new:
      break
    case .count:
      break
    @unknown default:
      break
    }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
    let isFirstCandidate = (firstCandidateTimestamp == nil)
    if isFirstCandidate {
      firstCandidateTimestamp = Date()
    }

    var metadata: [String: Any] = [
      "sdpMid": candidate.sdpMid ?? "",
      "sdpMLineIndex": candidate.sdpMLineIndex,
      "hasServerUrl": candidate.serverUrl != nil,
      "isFirst": isFirstCandidate
    ]

    if isFirstCandidate, let start = iceGatheringStartTimestamp {
      metadata["elapsedSinceGatherStart"] = Date().timeIntervalSince(start)
    }

    self.emit(.debug, "Generated ICE candidate", metadata: metadata)
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {
    self.emit(.debug, "Removed ICE candidates", metadata: ["count": candidates.count])
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
    self.emit(.debug, "ICE gathering state changed", metadata: ["state": newState.rawValue])

    if newState == .complete {
      iceGatheringTimeoutTask?.cancel()
      iceGatheringTimeoutTask = nil
    }

    guard newState == .complete, let continuation = iceGatheringContinuation else {
      return
    }

    iceGatheringContinuation = nil
    continuation.resume(returning: ())
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
    self.emit(.info, "Data channel opened", metadata: ["label": dataChannel.label])
  }

  private func stringValue(for state: RTCIceConnectionState) -> String {
    switch state {
    case .new: return "new"
    case .checking: return "checking"
    case .connected: return "connected"
    case .completed: return "completed"
    case .failed: return "failed"
    case .disconnected: return "disconnected"
    case .closed: return "closed"
    case .count: return "count"
    @unknown default: return "unknown"
    }
  }
}

extension OpenAIWebRTCClient: RTCDataChannelDelegate {
  func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
    emit(.debug, "Data channel state changed", metadata: [
      "label": dataChannel.label,
      "state": stringValue(for: dataChannel.readyState)
    ])

    guard dataChannel == self.dataChannel else {
      return
    }

    if dataChannel.readyState == .open {
      sendInitialSessionConfiguration()
    }
  }

  func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
    if buffer.isBinary {
      emit(.debug, "Received binary data channel message", metadata: [
        "label": dataChannel.label,
        "bytes": buffer.data.count
      ])
      return
    }

    guard let text = String(data: buffer.data, encoding: .utf8) else {
      emit(
        .warn,
        "Received non-UTF8 data channel message",
        metadata: [
          "label": dataChannel.label,
          "bytes": buffer.data.count
        ],
        propagateToReactNative: true
      )
      return
    }

    emit(.debug, "Received data channel message", metadata: [
      "label": dataChannel.label,
      "payloadLength": text.count
    ])


    // Parse JSON and handle event
    do {
      if let eventDict = try JSONSerialization.jsonObject(with: buffer.data, options: []) as? [String: Any] {
        
        // ============================================
        // NEW: Capture transcripts for TTS recording
        // ============================================
        if isRecordingEnabled, let eventType = eventDict["type"] as? String {

          // Capture USER transcript
          if eventType == "conversation.item.created" {
            if let item = eventDict["item"] as? [String: Any],
                let role = item["role"] as? String,
                role == "user",
                let content = item["content"] as? [[String: Any]],
                let firstContent = content.first,
                firstContent["type"] as? String == "input_audio",
                let transcript = firstContent["transcript"] as? String,
                !transcript.isEmpty {

              // Add to recording manager
              Task { @MainActor in
                await self.recordingManager.addUserTranscript(transcript)
              }
            }
          }

          // Capture AI transcript
          if eventType == "response.audio_transcript.done" {
              if let transcript = eventDict["transcript"] as? String,
                  !transcript.isEmpty {

                  // Add to recording manager
                  Task { @MainActor in
                    await self.recordingManager.addAITranscript(transcript)
                  }
              }
          }
        }
        
        // ============================================
        // EXISTING: Pass to event handler
        // ============================================
        handleTokenUsageEventIfNeeded(eventDict)
        eventHandler.handle(event: eventDict, context: makeEventHandlerContext())
        
      } else {
        emit(
          .warn,
          "Data channel message is not a JSON object",
          metadata: [
            "payload": text
          ],
          propagateToReactNative: true
        )
      }
    } catch {
      emit(.error, "Failed to parse data channel message as JSON", metadata: [
        "error": error.localizedDescription,
         "payload": text
      ])
    } 
  } // <-- Added: close didReceiveMessageWith before declaring helpers

  private func handleTokenUsageEventIfNeeded(_ eventDict: [String: Any]) {
    guard let type = eventDict["type"] as? String,
          type == "response.token_usage",
          let usage = eventDict["usage"] as? [String: Any] else {
      return
    }

    var payload: [String: Any] = [:]

    if let value = numberValue(from: usage["input_text_tokens"]) ?? numberValue(from: usage["inputText"]) {
      payload["inputText"] = value
    }

    if let value = numberValue(from: usage["input_audio_tokens"]) ?? numberValue(from: usage["inputAudio"]) {
      payload["inputAudio"] = value
    }

    if let value = numberValue(from: usage["output_text_tokens"]) ?? numberValue(from: usage["outputText"]) {
      payload["outputText"] = value
    }

    if let value = numberValue(from: usage["output_audio_tokens"]) ?? numberValue(from: usage["outputAudio"]) {
      payload["outputAudio"] = value
    }

    if let value = numberValue(from: usage["cached_input_tokens"]) ?? numberValue(from: usage["cachedInput"]) {
      payload["cachedInput"] = value
    }

    if payload.isEmpty {
      emit(.debug, "Token usage event received without recognized counters", metadata: [
        "usageKeys": Array(usage.keys)
      ])
      return
    }

    if let responseId = eventDict["response_id"] as? String {
      payload["responseId"] = responseId
    }

    payload["timestampMs"] = Int(Date().timeIntervalSince1970 * 1000)

    emit(.debug, "Forwarding token usage event to JavaScript", metadata: payload)

    Task { @MainActor in
        emitModuleEvent("onTokenUsage", payload: payload)
    }
      
  }

  private func numberValue(from value: Any?) -> Int? {
    switch value {
    case let intValue as Int:
      return intValue
    case let doubleValue as Double:
      return Int(doubleValue)
    case let number as NSNumber:
      return number.intValue
    case let stringValue as String:
      return Int(stringValue)
    default:
      return nil
    }
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

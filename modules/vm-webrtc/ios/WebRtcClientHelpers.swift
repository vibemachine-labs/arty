import Foundation
import AVFoundation
import WebRTC

extension OpenAIWebRTCClient {
  // MARK: - Helper Methods

  func buildEndpointURL(baseURL: String?, model: String?) throws -> URL {
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

  func configureAudioSession(for output: AudioOutputPreference) throws {
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

  func stopMonitoringAudioRouteChanges() {
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

  func deactivateAudioSession() {
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
        ]
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

  func stopInboundAudioStatsMonitoring() {
    inboundAudioMonitor.stop()
  }

  private func startOutboundAudioStatsMonitoring() {
    outboundAudioMonitor.start()
  }

  func stopOutboundAudioStatsMonitoring() {
    outboundAudioMonitor.stop()
  }

  func makePeerConnection() throws -> RTCPeerConnection {
    if let existingConnection = peerConnection {
      self.emit(
        .warn,
        "Disposing existing peer connection before creating a new one"
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

  func createOffer(connection: RTCPeerConnection) async throws -> RTCSessionDescription {
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

  func setLocalDescription(_ description: RTCSessionDescription, for connection: RTCPeerConnection) async throws {
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

  func setRemoteDescription(_ description: RTCSessionDescription, for connection: RTCPeerConnection) async throws {
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

  func waitForIceGathering(on connection: RTCPeerConnection, timeout: TimeInterval?) async throws -> TimeInterval {
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
              ]
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

  func exchangeSDPWithOpenAI(apiKey: String, endpointURL: URL, offerSDP: String) async throws -> String {
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

  func waitForConnection(toReach connection: RTCPeerConnection, timeout: TimeInterval) async throws -> String {
    if connection.iceConnectionState == .connected || connection.iceConnectionState == .completed {
      self.emit(
        .info,
        "OpenAI WebRTC connection established",
        metadata: ["state": stringValue(for: connection.iceConnectionState)]
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
  func handleIdleTimeoutTriggered() {
    guard peerConnection != nil || dataChannel != nil else {
      emit(.trace, "[IdleTimer] Timeout fired without an active session; ignoring")
      return
    }

    emit(
      .trace,
      "[IdleTimer] Inactivity threshold reached, disconnecting session",
      metadata: [
        "timeoutSeconds": Constants.idleTimeoutSeconds
      ]
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
        ]
      )
      return
    }

    var tools: [[String: Any]] = []
    var definitionsByName: [String: [String: Any]] = [:]

    for definition in toolDefinitions {
      guard let name = definition["name"] as? String, !name.isEmpty else {
        emit(
          .warn,
          "Encountered tool definition without a valid name. Skipping."
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

    if tools.isEmpty && !toolDefinitions.isEmpty {
      emit(
        .warn,
        "Tool definitions were provided from JavaScript but none matched configured delegates",
        metadata: [
          "definitionCount": toolDefinitions.count
        ]
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
        metadata: ["session": prettyString]
      )
    } else {
      emit(
        .debug,
        "📑 Sending session.update payload (fallback formatting)",
        metadata: ["session": session]
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
  func sendEvent(_ payload: [String: Any]) -> Bool {
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
        metadata: ["state": stringValue(for: newState)]
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

  func stringValue(for state: RTCIceConnectionState) -> String {
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
        ]
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
          ]
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

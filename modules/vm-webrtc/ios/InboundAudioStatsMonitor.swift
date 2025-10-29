import Foundation
import WebRTC

/// Handles polling inbound RTP statistics and tracking remote speaking state.
final class InboundAudioStatsMonitor {
  typealias LogEmitter = (
    _ level: OpenAIWebRTCClient.NativeLogLevel,
    _ message: String,
    _ metadata: [String: Any]?
  ) -> Void

  typealias PeerConnectionProvider = () -> RTCPeerConnection?
  typealias RemoteTrackIdentifierProvider = () -> String?
  typealias SpeakingActivityRecorder = () -> Void

  private struct Snapshot {
    let totalAudioEnergy: Double?
    let totalSamplesReceived: Double?
  }

  private struct SpeakingDetectionState {
    var smoothedLevel: Double = 0
    var hasSmoothedLevel: Bool = false
    var consecutiveActiveTicks: Int = 0
    var inactiveCandidateStart: Date?
    var isSpeaking: Bool = false
  }

  private enum SpeakingDetectionConfig {
    static let smoothingRetention: Double = 0.6
    static let smoothingContribution: Double = 0.4
    static let activeThreshold: Double = 2e-4
    static let inactiveThreshold: Double = 1e-4
    static let energyDeltaActive: Double = 1e-6
    static let energyDeltaInactive: Double = 5e-7
    static let requiredActiveTicks = 2
    static let inactiveHoldDuration: TimeInterval = 2.0
  }

  private let peerConnectionProvider: PeerConnectionProvider
  private let remoteTrackIdentifierProvider: RemoteTrackIdentifierProvider
  private let logEmitter: LogEmitter
  private let speakingActivityRecorder: SpeakingActivityRecorder

  private var monitoringTask: Task<Void, Never>?
  private var snapshots: [String: Snapshot] = [:]
  private var speakingState = SpeakingDetectionState()

  init(
    peerConnectionProvider: @escaping PeerConnectionProvider,
    remoteTrackIdentifierProvider: @escaping RemoteTrackIdentifierProvider,
    logEmitter: @escaping LogEmitter,
    speakingActivityRecorder: @escaping SpeakingActivityRecorder
  ) {
    self.peerConnectionProvider = peerConnectionProvider
    self.remoteTrackIdentifierProvider = remoteTrackIdentifierProvider
    self.logEmitter = logEmitter
    self.speakingActivityRecorder = speakingActivityRecorder
  }

  func start() {
    guard monitoringTask == nil else { return }
    monitoringTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let strongSelf = self else { return }
        await strongSelf.pollInboundAudioStats()
        do {
          try await Task.sleep(nanoseconds: 250_000_000)
        } catch {
          return
        }
      }
    }
  }

  func stop() {
    monitoringTask?.cancel()
    monitoringTask = nil
    reset()
  }

  func reset() {
    snapshots.removeAll()
    speakingState = SpeakingDetectionState()
  }

  @MainActor
  private func pollInboundAudioStats() async {
    guard let connection = peerConnectionProvider() else { return }
    guard let report = await fetchStatistics(from: connection) else { return }

    let targetTrackId = remoteTrackIdentifierProvider()

    for stats in report.statistics.values {
      guard stats.type == "inbound-rtp" else { continue }
      guard let values = stats.values as? [String: Any] else { continue }

      let mediaDescriptor = stringValue(for: "mediaType", in: values) ?? stringValue(for: "kind", in: values)
      if let mediaDescriptor, mediaDescriptor != "audio" {
        continue
      }

      let trackIdentifier = stringValue(for: "trackIdentifier", in: values)

      if let targetTrackId,
         let trackIdentifier,
         trackIdentifier != targetTrackId {
        continue
      }

      let audioLevel = doubleValue(for: "audioLevel", in: values)
      let totalAudioEnergy = doubleValue(for: "totalAudioEnergy", in: values)
      let totalSamplesReceived = doubleValue(for: "totalSamplesReceived", in: values)

      let previousSnapshot = snapshots[stats.id]
      var energyDelta: Double?
      var samplesDelta: Double?

      if let totalAudioEnergy, let previousEnergy = previousSnapshot?.totalAudioEnergy {
        energyDelta = totalAudioEnergy - previousEnergy
      }

      if let totalSamplesReceived, let previousSamples = previousSnapshot?.totalSamplesReceived {
        samplesDelta = totalSamplesReceived - previousSamples
      }

      snapshots[stats.id] = Snapshot(
        totalAudioEnergy: totalAudioEnergy,
        totalSamplesReceived: totalSamplesReceived
      )

      let isSpeaking = updateRemoteSpeakingState(
        audioLevel: audioLevel,
        energyDelta: energyDelta
      )

      if isSpeaking {
        speakingActivityRecorder()
      }

      var metadata: [String: Any] = [
        "remoteSpeaking": isSpeaking,
        "statsId": stats.id,
        "timestampUs": formattedStatValue(stats.timestamp_us)
      ]

      if let trackIdentifier {
        metadata["trackIdentifier"] = trackIdentifier
      }
      if let totalSamplesReceived {
        metadata["totalSamplesReceived"] = formattedStatValue(totalSamplesReceived)
      }
      if let samplesDelta {
        metadata["samplesDelta"] = formattedStatValue(samplesDelta)
      }
      if let totalAudioEnergy {
        metadata["totalAudioEnergy"] = formattedStatValue(totalAudioEnergy)
      }
      if let energyDelta {
        metadata["energyDelta"] = formattedStatValue(energyDelta)
      }
      if let audioLevel {
        metadata["audioLevel"] = formattedStatValue(audioLevel)
      }

      logEmitter(.debug, "Inbound audio stats", metadata)
    }
  }

  @MainActor
  private func updateRemoteSpeakingState(
    audioLevel: Double?,
    energyDelta: Double?
  ) -> Bool {
    guard audioLevel != nil || energyDelta != nil else { return speakingState.isSpeaking }

    var state = speakingState
    let now = Date()

    if let level = audioLevel {
      if state.hasSmoothedLevel {
        state.smoothedLevel =
          (SpeakingDetectionConfig.smoothingRetention * state.smoothedLevel) +
          (SpeakingDetectionConfig.smoothingContribution * level)
      } else {
        state.smoothedLevel = level
        state.hasSmoothedLevel = true
      }
    } else if state.hasSmoothedLevel {
      state.smoothedLevel = SpeakingDetectionConfig.smoothingRetention * state.smoothedLevel
    }

    let smoothedLevel = state.hasSmoothedLevel ? state.smoothedLevel : (audioLevel ?? 0)
    let energyValue = energyDelta ?? 0

    var activationByLevel = false
    if smoothedLevel > SpeakingDetectionConfig.activeThreshold {
      state.consecutiveActiveTicks += 1
      activationByLevel = state.consecutiveActiveTicks >= SpeakingDetectionConfig.requiredActiveTicks
    } else {
      state.consecutiveActiveTicks = 0
    }

    let activationByEnergy = energyValue > SpeakingDetectionConfig.energyDeltaActive
    let wasSpeaking = state.isSpeaking

    if !state.isSpeaking && (activationByLevel || activationByEnergy) {
      state.isSpeaking = true
      state.consecutiveActiveTicks = 0
      state.inactiveCandidateStart = nil
    }

    if state.isSpeaking {
      let levelBelowThreshold = smoothedLevel < SpeakingDetectionConfig.inactiveThreshold
      let energyBelowThreshold = energyValue < SpeakingDetectionConfig.energyDeltaInactive

      if levelBelowThreshold && energyBelowThreshold {
        if let start = state.inactiveCandidateStart {
          if now.timeIntervalSince(start) >= SpeakingDetectionConfig.inactiveHoldDuration {
            state.isSpeaking = false
            state.inactiveCandidateStart = nil
            state.consecutiveActiveTicks = 0
          }
        } else {
          state.inactiveCandidateStart = now
        }
      } else {
        state.inactiveCandidateStart = nil
      }
    }

    speakingState = state

    if state.isSpeaking != wasSpeaking {
      logEmitter(.debug, "other side is speaking: \(state.isSpeaking)", nil)
    }

    return state.isSpeaking
  }

  @MainActor
  private func fetchStatistics(from connection: RTCPeerConnection) async -> RTCStatisticsReport? {
    await withCheckedContinuation { continuation in
      connection.statistics { report in
        continuation.resume(returning: report)
      }
    }
  }

  private func doubleValue(for key: String, in values: [String: Any]) -> Double? {
    guard let rawValue = values[key] else { return nil }
    if let number = rawValue as? NSNumber {
      return number.doubleValue
    }
    if let string = rawValue as? NSString {
      return Double(string as String)
    }
    return nil
  }

  private func formattedStatValue(_ value: Double) -> String {
    String(format: "%.4f", value)
  }

  private func stringValue(for key: String, in values: [String: Any]) -> String? {
    guard let rawValue = values[key] else { return nil }
    if let string = rawValue as? NSString {
      return string as String
    }
    if let number = rawValue as? NSNumber {
      return number.stringValue
    }
    return nil
  }
}

import Foundation
import AVFoundation

// MARK: - VoiceSessionRecorder

@MainActor
final class VoiceSessionRecorder {
  enum RecorderError: LocalizedError {
    case permissionDenied
    case recorderBusy
    case failedToStart

    var errorDescription: String? {
      switch self {
      case .permissionDenied:
        return "Microphone access denied."
      case .recorderBusy:
        return "Recorder already running."
      case .failedToStart:
        return "Failed to start audio recording."
      }
    }
  }


  struct RecordingSummary {
    let url: URL
    let bytes: UInt64
    let startedAt: Date
    let duration: TimeInterval
  }

  private let fileManager = FileManager.default
  private lazy var timestampFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .iso8601)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyyMMdd_HHmmss"
    return formatter
  }()
  private let recordingsDirectoryName = "voice_session_recordings"

  var recorder: AVAudioRecorder?
  private var recordingStartDate: Date?
  private var activeRecordingURL: URL?
  var metricsTimer: Timer?
  let metricsUpdateInterval: TimeInterval = 0.4

  var metricsHandler: ((AudioMetrics) -> Void)?

  // FFT capture using AVAudioEngine
  var audioEngine: AVAudioEngine?
  var latestAudioSamples: [Float] = []
  let fftSize = 1024  // Power of 2 for FFT
  let sampleBufferLock = NSLock()

  var isRecording: Bool {
    recorder?.isRecording ?? false
  }

  var currentRecordingURL: URL? {
    activeRecordingURL
  }

  // NEW: Expose the recorder instance
  func getRecorderInstance() -> AVAudioRecorder? {
      return recorder
  }
  func start(using session: AVAudioSession = .sharedInstance()) async throws {
    guard recorder == nil else {
      throw RecorderError.recorderBusy
    }

    try await ensureRecordingPermission(using: session)

    if session.isOtherAudioPlaying {
      try? session.setActive(true, options: [.notifyOthersOnDeactivation])
    }

    if session.category != .playAndRecord {
      try session.setCategory(
        .playAndRecord,
        mode: .voiceChat,
        options: [.allowBluetoothHFP, .allowBluetoothA2DP, .defaultToSpeaker]
      )
    }

    if #available(iOS 13.0, *) {
      try? session.setAllowHapticsAndSystemSoundsDuringRecording(true)
    }

    let outputURL = try makeRecordingURL()
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: 48000,
      AVNumberOfChannelsKey: 1,
      AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
    ]

    let recorder = try AVAudioRecorder(url: outputURL, settings: settings)
    recorder.isMeteringEnabled = true
    recorder.prepareToRecord()

    guard recorder.record() else {
      recorder.stop()
      throw RecorderError.failedToStart
    }

    self.recorder = recorder
    self.recordingStartDate = Date()
    self.activeRecordingURL = outputURL

    // Start audio engine for FFT capture
    do {
      try startAudioEngineForFFT()
    } catch {
      // FFT capture failed, but continue with recording
      // (FFT is optional enhancement)
    }

    scheduleMetricsUpdates()
  }

  func stop() -> RecordingSummary? {
    guard let recorder else {
      return nil
    }

    metricsTimer?.invalidate()
    metricsTimer = nil

    // Stop audio engine for FFT
    stopAudioEngineForFFT()

    let duration = recorder.currentTime
    recorder.stop()

    let startDate = recordingStartDate ?? Date()
    recordingStartDate = nil

    let url = recorder.url
    self.recorder = nil
    self.activeRecordingURL = nil

    let attributes = try? fileManager.attributesOfItem(atPath: url.path)
    let bytes = (attributes?[.size] as? NSNumber)?.uint64Value ?? 0

    return RecordingSummary(
      url: url,
      bytes: bytes,
      startedAt: startDate,
      duration: duration
    )
  }

  private func ensureRecordingPermission(using session: AVAudioSession) async throws {
    switch session.recordPermission {
    case .granted:
      return
    case .denied:
      throw RecorderError.permissionDenied
    case .undetermined:
      let granted = await withCheckedContinuation { continuation in
        session.requestRecordPermission { continuation.resume(returning: $0) }
      }
      if !granted {
        throw RecorderError.permissionDenied
      }
    @unknown default:
      throw RecorderError.permissionDenied
    }
  }

  private func makeRecordingURL() throws -> URL {
    let documents = try fileManager.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )

    let directory = documents.appendingPathComponent(recordingsDirectoryName, isDirectory: true)
    if !fileManager.fileExists(atPath: directory.path) {
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
    }

    let timestamp = timestampFormatter.string(from: Date())
    return directory.appendingPathComponent("session_\(timestamp).m4a")
  }
}

// MARK: - VoiceSessionRecordingManager

@MainActor
final class VoiceSessionRecordingManager {

  // MARK: - Properties

  private let USE_OPENAI_TTS = true
  private let conversationRecorder = ConversationRecorder()
  private let ttsSegmentGenerator = TTSSegmentGenerator()
  private let smartAudioMerger = SmartAudioMerger()
  private let openAITTSGenerator = OpenAITTSGenerator()
  private lazy var incomingAudioRecorder = VoiceSessionRecorder()

  private var lastRecordingURL: URL?
  private var lastConversationTurns: [ConversationTurn] = []
  private var openAIAPIKey: String?
  private var sessionVoice: String = "cedar"

  // Logging callback
  var logEmitter: ((String, String, [String: Any]?) -> Void)?

  // MARK: - Setup

  func setMetricsHandler(_ handler: @escaping (AudioMetrics) -> Void) {
    incomingAudioRecorder.metricsHandler = handler
  }

  func setLogEmitter(_ emitter: @escaping (String, String, [String: Any]?) -> Void) {
    self.logEmitter = emitter
  }

  // MARK: - Recording Control

  func startRecording(
    using audioSession: AVAudioSession,
    apiKey: String,
    voice: String
  ) async throws {
    self.openAIAPIKey = apiKey
    self.sessionVoice = voice

    emit("debug", "Attempting to start microphone audio recording", metadata: [
      "alreadyRecording": incomingAudioRecorder.isRecording
    ])

    try await incomingAudioRecorder.start(using: audioSession)

    // Pass recorder reference to conversation recorder
    conversationRecorder.setAudioRecorder(incomingAudioRecorder.getRecorderInstance())
    emit("debug", "Recorder reference passed to conversation recorder")

    var startMetadata: [String: Any] = [
      "isRecording": incomingAudioRecorder.isRecording
    ]
    if let fileURL = incomingAudioRecorder.currentRecordingURL {
      startMetadata["file"] = fileURL.lastPathComponent
      startMetadata["path"] = fileURL.path
    }

    emit("info", "Microphone recording active", metadata: startMetadata)
  }

  func startConversationTracking() {
    conversationRecorder.startCall()
    emit("info", "🎙️ Started conversation recording with timestamps")
  }

  func addUserTranscript(_ text: String) {
    conversationRecorder.addUserTranscript(text)
    emit("info", "✅ User transcript captured", metadata: ["transcript": text])
  }

  func addAITranscript(_ text: String) {
    conversationRecorder.addAITranscript(text)
    emit("info", "✅ AI transcript captured", metadata: ["transcript": text])
  }

  // MARK: - Stop Recording & Process

  func stopRecordingAndProcess(completion: @escaping () -> Void) {
    guard let summary = incomingAudioRecorder.stop() else {
      emit("debug", "No active microphone recording to process")
      conversationRecorder.reset()
      completion()
      return
    }

    let micAudioURL = summary.url

    emit("info", "🎤 Microphone recording stopped", metadata: [
      "file": micAudioURL.lastPathComponent,
      "path": micAudioURL.path,
      "bytes": summary.bytes,
      "durationSeconds": summary.duration
    ])

    // Get all conversation turns
    let turns = conversationRecorder.getAllTurns()
    lastRecordingURL = micAudioURL
    lastConversationTurns = turns

    guard !turns.isEmpty else {
      emit("warn", "No conversation turns recorded - keeping mic file only")
      conversationRecorder.reset()
      completion()
      return
    }

    emit("info", "📊 Conversation summary", metadata: [
      "totalTurns": turns.count,
      "userTurns": turns.filter { $0.speaker == .user }.count,
      "aiTurns": turns.filter { $0.speaker == .ai }.count,
      "summary": conversationRecorder.getSummary()
    ])

    // Check if we have AI turns to generate TTS for
    let aiTurns = conversationRecorder.getAITurns()
    guard !aiTurns.isEmpty else {
      emit("warn", "No AI responses to generate TTS - keeping mic file only")
      conversationRecorder.reset()
      completion()
      return
    }

    // ============================================
    // Process TTS + Merge in BACKGROUND
    // ============================================

    emit("info", "🎙️ Starting background TTS generation for \(aiTurns.count) AI responses...")

    // Dispatch to background queue
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }

      // Run on main thread for the generator
      DispatchQueue.main.async {
        if self.USE_OPENAI_TTS {
          self.processWithOpenAITTS(turns: turns, micAudioURL: micAudioURL, completion: completion)
        } else {
          self.processWithSiriTTS(turns: turns, micAudioURL: micAudioURL, completion: completion)
        }
      }
    }
  }

  // MARK: - TTS Processing

  private func processWithOpenAITTS(
    turns: [ConversationTurn],
    micAudioURL: URL,
    completion: @escaping () -> Void
  ) {
    emit("info", "🎙️ Using OpenAI TTS (premium voice)...")

    let keyToUse = self.openAIAPIKey ?? ""
    guard !keyToUse.isEmpty else {
      emit("error", "❌ OpenAI API key missing; cannot generate OpenAI TTS.")
      conversationRecorder.reset()
      completion()
      return
    }

    let ttsVoice = resolvedTTSVoice(from: sessionVoice)

    openAITTSGenerator.generateSegments(
      from: turns,
      apiKey: keyToUse,
      voice: ttsVoice
    ) { [weak self] segments in
      guard let self = self else { return }

      guard !segments.isEmpty else {
        self.emit("error", "❌ OpenAI TTS generation failed")
        self.conversationRecorder.reset()
        completion()
        return
      }

      self.emit("info", "✅ OpenAI TTS generation complete", metadata: [
        "segments": segments.count
      ])

      let finalURL = self.createMergedAudioURL(prefix: "openai")

      self.emit("info", "🔗 Merging audio with OpenAI voice...", metadata: [
        "micFile": micAudioURL.lastPathComponent,
        "aiSegments": segments.count,
        "outputFile": finalURL.lastPathComponent
      ])

      self.smartAudioMerger.mergeConversation(
        micAudioURL: micAudioURL,
        aiSegments: segments,
        outputURL: finalURL
      ) { result in
        switch result {
        case .success(let url):
          self.emit("info", "✅ ✅ ✅ OPENAI VOICE MERGED AUDIO SAVED! ✅ ✅ ✅", metadata: [
            "file": url.lastPathComponent,
            "path": url.path,
            "voice": ttsVoice,
            "turns": turns.count
          ])

          // Log each turn for verification
          for (index, turn) in turns.enumerated() {
            let speaker = turn.speaker == .user ? "👤 User" : "🤖 AI"
            let time = String(format: "%.2f", turn.relativeTime)
            self.emit("debug", "Turn \(index + 1): \(speaker) at +\(time)s", metadata: [
              "text": turn.text
            ])
          }

          // Delete the session recording file as it's now merged
          do {
            try FileManager.default.removeItem(at: micAudioURL)
            self.emit("info", "🗑️ Deleted session recording (merged into final audio)", metadata: [
              "file": micAudioURL.lastPathComponent
            ])
          } catch {
            self.emit("warn", "Failed to delete session recording", metadata: [
              "file": micAudioURL.lastPathComponent,
              "error": error.localizedDescription
            ])
          }

        case .failure(let error):
          self.emit("error", "❌ OpenAI audio merge failed", metadata: [
            "error": error.localizedDescription
          ])
        }

        self.conversationRecorder.reset()
        completion()
      }
    }
  }

  private func processWithSiriTTS(
    turns: [ConversationTurn],
    micAudioURL: URL,
    completion: @escaping () -> Void
  ) {
    emit("info", "🎙️ Using Siri TTS (fast & offline)...")

    ttsSegmentGenerator.generateSegments(from: turns) { [weak self] segments in
      guard let self = self else { return }

      guard !segments.isEmpty else {
        self.emit("warn", "No TTS segments generated - keeping mic file only")
        self.conversationRecorder.reset()
        completion()
        return
      }

      self.emit("info", "✅ Siri TTS generation complete", metadata: [
        "segments": segments.count
      ])

      let finalURL = self.createMergedAudioURL(prefix: "siri")

      self.emit("info", "🔗 Merging audio with Siri voice...", metadata: [
        "micFile": micAudioURL.lastPathComponent,
        "aiSegments": segments.count,
        "outputFile": finalURL.lastPathComponent
      ])

      self.smartAudioMerger.mergeConversation(
        micAudioURL: micAudioURL,
        aiSegments: segments,
        outputURL: finalURL
      ) { result in
        switch result {
        case .success(let url):
          self.emit("info", "✅ ✅ ✅ SIRI VOICE MERGED AUDIO SAVED! ✅ ✅ ✅", metadata: [
            "file": url.lastPathComponent,
            "path": url.path,
            "turns": turns.count
          ])

          // Log each turn for verification
          for (index, turn) in turns.enumerated() {
            let speaker = turn.speaker == .user ? "👤 User" : "🤖 AI"
            let time = String(format: "%.2f", turn.relativeTime)
            self.emit("debug", "Turn \(index + 1): \(speaker) at +\(time)s", metadata: [
              "text": turn.text
            ])
          }

          // Delete the session recording file as it's now merged
          do {
            try FileManager.default.removeItem(at: micAudioURL)
            self.emit("info", "🗑️ Deleted session recording (merged into final audio)", metadata: [
              "file": micAudioURL.lastPathComponent
            ])
          } catch {
            self.emit("warn", "Failed to delete session recording", metadata: [
              "file": micAudioURL.lastPathComponent,
              "error": error.localizedDescription
            ])
          }

        case .failure(let error):
          self.emit("error", "❌ Siri audio merge failed", metadata: [
            "error": error.localizedDescription
          ])
        }

        self.conversationRecorder.reset()
        completion()
      }
    }
  }

  // MARK: - Manual TTS Conversion (for testing)

  func convertTranscriptToOpenAIVoice(apiKey: String, voice: String? = nil) {
    guard let micAudioURL = lastRecordingURL else {
      emit("error", "❌ No recording found. End a call first.")
      return
    }

    guard !lastConversationTurns.isEmpty else {
      emit("error", "❌ No conversation transcript found.")
      return
    }

    let keyToUse = apiKey.isEmpty ? (self.openAIAPIKey ?? "") : apiKey
    guard !keyToUse.isEmpty else {
      emit("error", "❌ OpenAI API key missing for TTS generation.")
      return
    }

    let voiceToUse = (voice?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
      ? voice!.trimmingCharacters(in: .whitespacesAndNewlines)
      : sessionVoice

    let ttsVoice = resolvedTTSVoice(from: voiceToUse)

    emit("info", "🎙️ Converting to OpenAI TTS voice: \(ttsVoice)...")

    openAITTSGenerator.generateSegments(
      from: lastConversationTurns,
      apiKey: keyToUse,
      voice: ttsVoice
    ) { [weak self] segments in
      guard let self = self else { return }

      guard !segments.isEmpty else {
        self.emit("error", "❌ OpenAI TTS generation failed")
        return
      }

      self.emit("info", "✅ OpenAI TTS complete: \(segments.count) segments")

      let finalURL = self.createMergedAudioURL(prefix: "openai")

      self.smartAudioMerger.mergeConversation(
        micAudioURL: micAudioURL,
        aiSegments: segments,
        outputURL: finalURL
      ) { result in
        switch result {
        case .success(let url):
          self.emit("info", "✅ ✅ ✅ OPENAI VOICE MERGED! ✅ ✅ ✅", metadata: [
            "file": url.lastPathComponent,
            "voice": ttsVoice
          ])
        case .failure(let error):
          self.emit("error", "❌ Merge failed", metadata: [
            "error": error.localizedDescription
          ])
        }
      }
    }
  }

  // MARK: - Helper Methods

  func reset() {
    conversationRecorder.reset()
  }

  private func createMergedAudioURL(prefix: String = "siri") -> URL {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .iso8601)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyyMMdd_HHmmss"
    let timestamp = formatter.string(from: Date())

    let documentsPath = try! FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )

    let recordingsDir = documentsPath.appendingPathComponent("voice_session_recordings", isDirectory: true)

    if !FileManager.default.fileExists(atPath: recordingsDir.path) {
      try? FileManager.default.createDirectory(
        at: recordingsDir,
        withIntermediateDirectories: true,
        attributes: nil
      )
    }

    return recordingsDir.appendingPathComponent("merged_\(prefix)_\(timestamp).m4a")
  }

  private func resolvedTTSVoice(from voice: String) -> String {
    switch voice.lowercased() {
    case "cedar": return "ash"
    case "marin": return "shimmer"
    default: return voice
    }
  }

  private func emit(_ level: String, _ message: String, metadata: [String: Any]? = nil) {
    logEmitter?(level, message, metadata)
  }
}

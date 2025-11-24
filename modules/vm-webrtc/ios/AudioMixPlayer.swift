import Foundation
import AVFoundation

/// Plays audio files mixed with ongoing WebRTC audio session
/// Designed to work alongside WebRTC's AVAudioSession configuration
final class AudioMixPlayer: NSObject {

  private var audioPlayer: AVAudioPlayer?
  private let logger = VmWebrtcLogging.logger

  // For looping random beeps
  private var isLoopingBeeps: Bool = false
  private var beepURLs: [URL] = []

  // Serial queue for thread-safe access to mutable state
  private let stateQueue = DispatchQueue(label: "com.vmwebrtc.audiomixplayer.state")

  // Callback to check if assistant audio is currently streaming
  // If true, audio playback will be blocked to prevent overlap
  var isAssistantAudioStreamingCheck: (() -> Bool)?

  /// Plays an audio file while WebRTC session is active
  /// - Parameter filename: The audio file name (e.g., "audio.mp3" or "audio.wav")
  /// - Note: The file should be in the app bundle or a known location
  func playAudio(filename: String) {
    // Try multiple locations and formats
    let possibleExtensions = ["mp3", "wav", "m4a", "aac"]
    var audioURL: URL?

    // First try the exact filename
    if let url = Bundle.main.url(forResource: filename, withExtension: nil) {
      audioURL = url
    } else {
      // Try stripping extension and searching for common formats
      let baseName = (filename as NSString).deletingPathExtension
      for ext in possibleExtensions {
        if let url = Bundle.main.url(forResource: baseName, withExtension: ext) {
          audioURL = url
          break
        }
      }
    }

    // Also check in the module's resources directory
    if audioURL == nil {
      let moduleBundle = Bundle(for: AudioMixPlayer.self)
      if let url = moduleBundle.url(forResource: filename, withExtension: nil) {
        audioURL = url
      } else {
        let baseName = (filename as NSString).deletingPathExtension
        for ext in possibleExtensions {
          if let url = moduleBundle.url(forResource: baseName, withExtension: ext) {
            audioURL = url
            break
          }
        }
      }
    }

    guard let url = audioURL else {
      logger.log(
        "[AudioMixPlayer] Audio file not found (stub mode - file will be added later)",
        attributes: logAttributes(for: .warn, metadata: [
          "filename": filename,
          "searchedExtensions": possibleExtensions
        ])
      )
      return
    }

    stateQueue.async {
      self.playAudioInternal(url: url)
    }
  }

  /// Plays audio from a URL
  func playAudio(url: URL) {
    stateQueue.async {
      self.playAudioInternal(url: url)
    }
  }

  /// Internal implementation - must be called on stateQueue
  private func playAudioInternal(url: URL) {
    // CRITICAL PROTECTION: Do not play audio if assistant is currently speaking
    // This prevents audio overlap based on precise OpenAI Realtime API events
    if let streamingCheck = isAssistantAudioStreamingCheck, streamingCheck() {
      logger.log(
        "[AudioMixPlayer] Blocked audio playback - assistant is speaking",
        attributes: logAttributes(for: .info, metadata: [
          "url": url.lastPathComponent,
          "reason": "assistant_audio_streaming"
        ])
      )
      return
    }

    // Stop any existing playback (but preserve loop state)
    stopPlaybackInternal()

    do {
      // Configure for mixing with WebRTC
      // Note: WebRTC should already have AVAudioSession configured with .mixWithOthers
      let session = AVAudioSession.sharedInstance()

      logger.log(
        "[AudioMixPlayer] Current audio session state before playback",
        attributes: logAttributes(for: .debug, metadata: [
          "category": session.category.rawValue,
          "mode": session.mode.rawValue,
          "options": describeCategoryOptions(session.categoryOptions),
          "isOtherAudioPlaying": session.isOtherAudioPlaying
        ])
      )

      audioPlayer = try AVAudioPlayer(contentsOf: url)
      audioPlayer?.delegate = self
      audioPlayer?.prepareToPlay()

      // Set volume (may need adjustment based on WebRTC audio levels)
      audioPlayer?.volume = 0.8

      let success = audioPlayer?.play() ?? false

      logger.log(
        "[AudioMixPlayer] Started audio playback",
        attributes: logAttributes(for: .info, metadata: [
          "url": url.lastPathComponent,
          "duration": audioPlayer?.duration ?? 0,
          "success": success
        ])
      )

    } catch {
      logger.log(
        "[AudioMixPlayer] Failed to play audio",
        attributes: logAttributes(for: .error, metadata: [
          "url": url.lastPathComponent,
          "error": error.localizedDescription
        ])
      )
    }
  }

  /// Starts playing random beeps matching a prefix until stop() is called
  /// Searches the app bundle for all audio files starting with the given prefix
  /// - Parameter prefix: Filename prefix to match (e.g., "ArtyBeeps")
  func startLoopingRandomBeeps(prefix: String) {
    // Find all audio files in bundle matching the prefix
    let audioExtensions = ["mp3", "wav", "m4a", "aac"]
    var foundURLs: [URL] = []

    // Log bundle paths for debugging
    logger.log(
      "[AudioMixPlayer] Searching for audio files",
      attributes: logAttributes(for: .debug, metadata: [
        "prefix": prefix,
        "mainBundlePath": Bundle.main.bundlePath,
        "mainBundleResourcePath": Bundle.main.resourcePath ?? "nil"
      ])
    )

    // Search main bundle
    for ext in audioExtensions {
      if let urls = Bundle.main.urls(forResourcesWithExtension: ext, subdirectory: nil) {
        logger.log(
          "[AudioMixPlayer] Found files in main bundle",
          attributes: logAttributes(for: .debug, metadata: [
            "extension": ext,
            "count": urls.count,
            "files": urls.map { $0.lastPathComponent }
          ])
        )
        let matching = urls.filter { $0.lastPathComponent.hasPrefix(prefix) }
        foundURLs.append(contentsOf: matching)
      } else {
        logger.log(
          "[AudioMixPlayer] No files found in main bundle",
          attributes: logAttributes(for: .debug, metadata: [
            "extension": ext
          ])
        )
      }
    }

    // Also search module bundle
    let moduleBundle = Bundle(for: AudioMixPlayer.self)
    logger.log(
      "[AudioMixPlayer] Module bundle info",
      attributes: logAttributes(for: .debug, metadata: [
        "moduleBundlePath": moduleBundle.bundlePath,
        "isSameAsMain": moduleBundle == Bundle.main
      ])
    )

    for ext in audioExtensions {
      if let urls = moduleBundle.urls(forResourcesWithExtension: ext, subdirectory: nil) {
        let matching = urls.filter { $0.lastPathComponent.hasPrefix(prefix) }
        foundURLs.append(contentsOf: matching)
      }
    }

    // Remove duplicates
    let uniqueURLs = Array(Set(foundURLs))

    guard !uniqueURLs.isEmpty else {
      logger.log(
        "[AudioMixPlayer] Cannot start looping - no files found with prefix",
        attributes: logAttributes(for: .error, metadata: [
          "prefix": prefix,
          "searchedExtensions": audioExtensions,
          "mainBundlePath": Bundle.main.bundlePath
        ])
      )
      return
    }

    stateQueue.async {
      self.isLoopingBeeps = true
      self.beepURLs = uniqueURLs

      // Play the first random beep
      let randomURL = uniqueURLs.randomElement()!
      self.playAudioInternal(url: randomURL)

      self.logger.log(
        "[AudioMixPlayer] Started looping random beeps",
        attributes: logAttributes(for: .info, metadata: [
          "prefix": prefix,
          "fileCount": uniqueURLs.count,
          "files": uniqueURLs.map { $0.lastPathComponent },
          "firstBeep": randomURL.lastPathComponent
        ])
      )
    }
  }

  /// Stops current audio playback and cancels looping
  func stop() {
    stateQueue.async {
      let wasLooping = self.isLoopingBeeps
      let hadBeeps = self.beepURLs.count

      // Clear loop state - only done in public stop()
      self.isLoopingBeeps = false
      self.beepURLs = []

      self.stopPlaybackInternal()

      self.logger.log(
        "[AudioMixPlayer] Stop called - cleared loop state",
        attributes: logAttributes(for: .info, metadata: [
          "wasLooping": wasLooping,
          "hadBeepsCount": hadBeeps
        ])
      )
    }
  }

  /// Internal implementation - stops playback but preserves loop state
  /// Must be called on stateQueue
  private func stopPlaybackInternal() {
    if let player = audioPlayer, player.isPlaying {
      player.stop()
      logger.log(
        "[AudioMixPlayer] Stopped active playback",
        attributes: logAttributes(for: .debug)
      )
    }
    audioPlayer = nil
  }

  /// Returns true if audio is currently playing
  var isPlaying: Bool {
    return stateQueue.sync {
      audioPlayer?.isPlaying ?? false
    }
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
}

extension AudioMixPlayer: AVAudioPlayerDelegate {
  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    stateQueue.async {
      self.logger.log(
        "[AudioMixPlayer] Playback finished",
        attributes: logAttributes(for: .debug, metadata: [
          "success": flag,
          "isLoopingBeeps": self.isLoopingBeeps,
          "beepURLsCount": self.beepURLs.count
        ])
      )

      // If looping, play the next random beep
      if self.isLoopingBeeps && !self.beepURLs.isEmpty {
        let nextURL = self.beepURLs.randomElement()!
        self.logger.log(
          "[AudioMixPlayer] Looping - playing next beep",
          attributes: logAttributes(for: .debug, metadata: [
            "nextFile": nextURL.lastPathComponent
          ])
        )
        self.playAudioInternal(url: nextURL)
      } else {
        self.logger.log(
          "[AudioMixPlayer] Not looping - playback stopped",
          attributes: logAttributes(for: .debug, metadata: [
            "reason": !self.isLoopingBeeps ? "isLoopingBeeps=false" : "beepURLs empty"
          ])
        )
      }
    }
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    logger.log(
      "[AudioMixPlayer] Decode error occurred",
      attributes: logAttributes(for: .error, metadata: [
        "error": error?.localizedDescription ?? "unknown"
      ])
    )
  }
}

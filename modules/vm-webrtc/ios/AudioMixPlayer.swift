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
    // Stop any existing playback
    stopInternal()

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

    // Search main bundle
    for ext in audioExtensions {
      if let urls = Bundle.main.urls(forResourcesWithExtension: ext, subdirectory: nil) {
        let matching = urls.filter { $0.lastPathComponent.hasPrefix(prefix) }
        foundURLs.append(contentsOf: matching)
      }
    }

    // Also search module bundle
    let moduleBundle = Bundle(for: AudioMixPlayer.self)
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
        attributes: logAttributes(for: .warn, metadata: [
          "prefix": prefix
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

  /// Stops current audio playback
  func stop() {
    stateQueue.async {
      self.stopInternal()
    }
  }

  /// Internal implementation - must be called on stateQueue
  private func stopInternal() {
    isLoopingBeeps = false
    beepURLs = []

    if let player = audioPlayer, player.isPlaying {
      player.stop()
      logger.log(
        "[AudioMixPlayer] Stopped audio playback",
        attributes: logAttributes(for: .info)
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
          "isLoopingBeeps": self.isLoopingBeeps
        ])
      )

      // If looping, play the next random beep
      if self.isLoopingBeeps && !self.beepURLs.isEmpty {
        let nextURL = self.beepURLs.randomElement()!
        self.playAudioInternal(url: nextURL)
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

import Foundation
import AVFoundation

/// Plays audio files mixed with ongoing WebRTC audio session
/// Designed to work alongside WebRTC's AVAudioSession configuration
final class AudioMixPlayer: NSObject {

  private var audioPlayer: AVAudioPlayer?
  private let logger = VmWebrtcLogging.logger

  // For looping random beeps
  private var isLoopingBeeps: Bool = false
  private var beepFilenames: [String] = []

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

    playAudio(url: url)
  }

  /// Plays audio from a URL
  func playAudio(url: URL) {
    // Stop any existing playback
    stop()

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

  /// Starts playing random beeps from the provided filenames until stop() is called
  /// - Parameter filenames: Array of audio filenames to randomly choose from
  func startLoopingRandomBeeps(filenames: [String]) {
    guard !filenames.isEmpty else {
      logger.log(
        "[AudioMixPlayer] Cannot start looping - no filenames provided",
        attributes: logAttributes(for: .warn)
      )
      return
    }

    isLoopingBeeps = true
    beepFilenames = filenames

    // Play the first random beep
    let randomFilename = filenames.randomElement()!
    playAudio(filename: randomFilename)

    logger.log(
      "[AudioMixPlayer] Started looping random beeps",
      attributes: logAttributes(for: .info, metadata: [
        "filenameCount": filenames.count,
        "firstBeep": randomFilename
      ])
    )
  }

  /// Stops current audio playback
  func stop() {
    isLoopingBeeps = false
    beepFilenames = []

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
    return audioPlayer?.isPlaying ?? false
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
    logger.log(
      "[AudioMixPlayer] Playback finished",
      attributes: logAttributes(for: .debug, metadata: [
        "success": flag,
        "isLoopingBeeps": isLoopingBeeps
      ])
    )

    // If looping, play the next random beep
    if isLoopingBeeps && !beepFilenames.isEmpty {
      let nextFilename = beepFilenames.randomElement()!
      playAudio(filename: nextFilename)
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

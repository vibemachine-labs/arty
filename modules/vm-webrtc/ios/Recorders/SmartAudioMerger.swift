import Foundation
import AVFoundation

// MARK: - SmartAudioMerger Class
class SmartAudioMerger {
    
    // MARK: - Public Methods
    
    /// Merge microphone audio with TTS segments at precise timestamps
    /// - Parameters:
    ///   - micAudioURL: URL of the microphone recording (user's voice)
    ///   - aiSegments: Array of TTS audio segments with timestamps
    ///   - outputURL: Where to save the final merged file
    ///   - completion: Called with success/failure result
    func mergeConversation(
        micAudioURL: URL,
        aiSegments: [AudioSegment],
        outputURL: URL,
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        print("[AudioMerger] 🔗 Starting merge...")
        print("[AudioMerger] 📁 Mic audio: \(micAudioURL.lastPathComponent)")
        print("[AudioMerger] 📁 AI segments: \(aiSegments.count)")
        print("[AudioMerger] 📁 Output: \(outputURL.lastPathComponent)")
        
        // Run merge on background thread to avoid blocking UI
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                // Create composition
                let composition = AVMutableComposition()
                
                // ============================================
                // TRACK 1: Microphone Audio (User's Voice)
                // ============================================
                
                let micAsset = AVAsset(url: micAudioURL)
                
                guard let micTrack = micAsset.tracks(withMediaType: .audio).first else {
                    throw NSError(
                        domain: "AudioMerger",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "No audio track found in microphone recording"]
                    )
                }
                
                guard let compositionMicTrack = composition.addMutableTrack(
                    withMediaType: .audio,
                    preferredTrackID: kCMPersistentTrackID_Invalid
                ) else {
                    throw NSError(
                        domain: "AudioMerger",
                        code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "Failed to create microphone composition track"]
                    )
                }
                
                // Insert the full microphone recording (continuous)
                try compositionMicTrack.insertTimeRange(
                    CMTimeRange(start: .zero, duration: micAsset.duration),
                    of: micTrack,
                    at: .zero
                )
                
                let micDuration = CMTimeGetSeconds(micAsset.duration)
                print("[AudioMerger] ✅ Mic track inserted (duration: \(String(format: "%.1f", micDuration))s)")
                
                // ============================================
                // TRACK 2: AI Audio Segments (TTS)
                // ============================================
                
                guard let compositionAITrack = composition.addMutableTrack(
                    withMediaType: .audio,
                    preferredTrackID: kCMPersistentTrackID_Invalid
                ) else {
                    throw NSError(
                        domain: "AudioMerger",
                        code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "Failed to create AI composition track"]
                    )
                }
                
                // Insert each AI segment at its exact timestamp
                for (index, segment) in aiSegments.enumerated() {
                    let aiAsset = AVAsset(url: segment.url)
                    
                    guard let aiTrack = aiAsset.tracks(withMediaType: .audio).first else {
                        print("[AudioMerger] ⚠️ Skipping segment \(index + 1) - no audio track found")
                        continue
                    }
                    
                    // THIS IS THE KEY: Insert at the exact timestamp when AI spoke
                    let insertTime = CMTime(
                        seconds: segment.insertTime,
                        preferredTimescale: 600
                    )
                    
                    // Insert the AI audio segment
                    try compositionAITrack.insertTimeRange(
                        CMTimeRange(start: .zero, duration: aiAsset.duration),
                        of: aiTrack,
                        at: insertTime
                    )
                    
                    print("[AudioMerger] 📍 Segment \(index + 1) inserted at +\(String(format: "%.1f", segment.insertTime))s: \"\(segment.text)\"")
                }
                
                print("[AudioMerger] ✅ All AI segments inserted (\(aiSegments.count) total)")
                
                // ============================================
                // EXPORT TO FINAL FILE
                // ============================================
                
                guard let exportSession = AVAssetExportSession(
                    asset: composition,
                    presetName: AVAssetExportPresetAppleM4A
                ) else {
                    throw NSError(
                        domain: "AudioMerger",
                        code: 4,
                        userInfo: [NSLocalizedDescriptionKey: "Failed to create export session"]
                    )
                }
                
                exportSession.outputURL = outputURL
                exportSession.outputFileType = .m4a
                
                print("[AudioMerger] 📤 Exporting merged file...")
                
                exportSession.exportAsynchronously {
                    switch exportSession.status {
                    case .completed:
                        print("[AudioMerger] ✅ Export completed successfully!")
                        
                        // Get file size
                        if let fileSize = try? FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? UInt64 {
                            let fileSizeMB = Double(fileSize) / 1_048_576.0
                            print("[AudioMerger] 📊 File size: \(String(format: "%.2f", fileSizeMB)) MB")
                        }
                        
                        // Clean up temporary TTS segment files
                        self.cleanupTempFiles(segments: aiSegments)
                        
                        // Return success on main thread
                        DispatchQueue.main.async {
                            completion(.success(outputURL))
                        }
                        
                    case .failed:
                        let error = exportSession.error ?? NSError(
                            domain: "AudioMerger",
                            code: 5,
                            userInfo: [NSLocalizedDescriptionKey: "Export failed with unknown error"]
                        )
                        print("[AudioMerger] ❌ Export failed: \(error.localizedDescription)")
                        
                        DispatchQueue.main.async {
                            completion(.failure(error))
                        }
                        
                    case .cancelled:
                        let error = NSError(
                            domain: "AudioMerger",
                            code: 6,
                            userInfo: [NSLocalizedDescriptionKey: "Export was cancelled"]
                        )
                        print("[AudioMerger] ❌ Export cancelled")
                        
                        DispatchQueue.main.async {
                            completion(.failure(error))
                        }
                        
                    default:
                        break
                    }
                }
                
            } catch {
                print("[AudioMerger] ❌ Merge error: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    completion(.failure(error))
                }
            }
        }
    }
    
    // MARK: - Private Methods
    
    /// Clean up temporary TTS segment files
    private func cleanupTempFiles(segments: [AudioSegment]) {
        print("[AudioMerger] 🗑️ Cleaning up temporary files...")
        
        var deletedCount = 0
        for segment in segments {
            do {
                try FileManager.default.removeItem(at: segment.url)
                deletedCount += 1
                print("[AudioMerger] 🗑️ Deleted: \(segment.url.lastPathComponent)")
            } catch {
                print("[AudioMerger] ⚠️ Failed to delete temp file: \(segment.url.lastPathComponent)")
            }
        }
        
        print("[AudioMerger] ✅ Cleanup complete (\(deletedCount)/\(segments.count) files deleted)")
    }
}


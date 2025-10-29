import Foundation
import AVFoundation

// MARK: - AudioSegment Struct
struct AudioSegment {
    let url: URL
    let insertTime: TimeInterval
    let duration: TimeInterval
    let text: String
}

// MARK: - TTSSegmentGenerator Class
@available(iOS 13.0, *)
class TTSSegmentGenerator: NSObject {
    
    // MARK: - Properties
    private var pendingSegments: [(text: String, insertTime: TimeInterval)] = []
    private var completedSegments: [AudioSegment] = []
    private var finalCompletionHandler: (([AudioSegment]) -> Void)?
    
    // Keep synthesizer alive as instance variable
    private var currentSynthesizer: AVSpeechSynthesizer?
    
    // MARK: - Public Methods
    
    func generateSegments(
        from turns: [ConversationTurn],
        completion: @escaping ([AudioSegment]) -> Void
    ) {
        let aiTurns = turns.filter { $0.speaker == .ai }
        
        guard !aiTurns.isEmpty else {
            print("[TTSGenerator] ⚠️ No AI turns to generate")
            completion([])
            return
        }
        
        print("[TTSGenerator] 🔇 Generating \(aiTurns.count) TTS segments SILENTLY...")
//        print("[TTSGenerator] 📱 iOS Version: \(UIDevice.current.systemVersion)")
        
        pendingSegments = aiTurns.map { ($0.text, $0.relativeTime) }
        completedSegments = []
        finalCompletionHandler = completion
        
        // Start with first segment
        processNextSegmentSequentially()
    }
    
    // MARK: - Private Methods
    
    private func processNextSegmentSequentially() {
        guard !pendingSegments.isEmpty else {
            // All segments processed!
            let sorted = completedSegments.sorted { $0.insertTime < $1.insertTime }
            print("[TTSGenerator] ✅ All \(sorted.count) segments generated silently!")
            finalCompletionHandler?(sorted)
            finalCompletionHandler = nil
            currentSynthesizer = nil
            return
        }
        
        // Take first pending segment
        let segment = pendingSegments.removeFirst()
        let segmentNumber = completedSegments.count + 1
        let totalSegments = completedSegments.count + pendingSegments.count + 1
        
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString + ".m4a")
        
        print("[TTSGenerator] 🔇 Processing segment \(segmentNumber)/\(totalSegments): \"\(segment.text)\"")
        
        // Generate this segment and wait for completion
        generateSingleSegment(
            text: segment.text,
            insertTime: segment.insertTime,
            outputURL: outputURL,
            segmentNumber: segmentNumber
        ) { [weak self] audioSegment in
            guard let self = self else { return }
            
            if let audioSegment = audioSegment {
                self.completedSegments.append(audioSegment)
                print("[TTSGenerator] ✅ Segment \(segmentNumber) complete: \(String(format: "%.2f", audioSegment.duration))s")
            } else {
                print("[TTSGenerator] ❌ Segment \(segmentNumber) failed")
            }
            
            // NOW process next segment (sequential!)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.processNextSegmentSequentially()
            }
        }
    }
    
    private func generateSingleSegment(
        text: String,
        insertTime: TimeInterval,
        outputURL: URL,
        segmentNumber: Int,
        completion: @escaping (AudioSegment?) -> Void
    ) {
        // Create NEW synthesizer for this segment (keep alive as instance variable)
        currentSynthesizer = AVSpeechSynthesizer()
        
        guard let synthesizer = currentSynthesizer else {
            print("[TTSGenerator] ❌ Failed to create synthesizer")
            completion(nil)
            return
        }
        
        // Create utterance
        let utterance = AVSpeechUtterance(string: text)
        
        // Use premium voice
        let availableVoices = AVSpeechSynthesisVoice.speechVoices()
        print("[TTSGenerator] 🎤 Available voices: \(availableVoices.count)")
        
        if let zoeVoice = AVSpeechSynthesisVoice(identifier: "com.apple.voice.premium.en-US.Zoe") {
            utterance.voice = zoeVoice
            print("[TTSGenerator] 🎤 Using Zoe voice")
        } else if let voice = AVSpeechSynthesisVoice(language: "en-US") {
            utterance.voice = voice
            print("[TTSGenerator] 🎤 Using fallback en-US voice")
        }
        
      // Configure speech parameters to match AI speed
      utterance.rate = 0.58        // ✅ Faster! (default is 0.5, max is 1.0)
      utterance.pitchMultiplier = 1.0
      utterance.volume = 1.0
      utterance.preUtteranceDelay = 0.0  // ✅ No delay before speaking
      utterance.postUtteranceDelay = 0.0 // ✅ No delay after speaking
        
        var audioBuffers: [AVAudioPCMBuffer] = []
        var callbackCount = 0
        var hasCalledCompletion = false
        
        print("[TTSGenerator] 📝 Calling synthesizer.write() for segment \(segmentNumber)...")
        
        // Write to buffer
        synthesizer.write(utterance) { buffer in
            callbackCount += 1
            print("[TTSGenerator] 🔔 Callback #\(callbackCount) for segment \(segmentNumber)")
            
            if let pcmBuffer = buffer as? AVAudioPCMBuffer {
                print("[TTSGenerator] 📦 Buffer type: AVAudioPCMBuffer, frames: \(pcmBuffer.frameLength)")
                
                if pcmBuffer.frameLength > 0 {
                    // Non-empty buffer - collect it
                    audioBuffers.append(pcmBuffer)
                    print("[TTSGenerator] ✅ Collected buffer \(audioBuffers.count): \(pcmBuffer.frameLength) frames")
                } else {
                    // Empty buffer = we're done!
                    print("[TTSGenerator] 🏁 Segment \(segmentNumber) - Empty buffer received (completion signal)")
                    
                    guard !hasCalledCompletion else {
                        print("[TTSGenerator] ⚠️ Completion already called, ignoring")
                        return
                    }
                    hasCalledCompletion = true
                    
                    print("[TTSGenerator] 💾 Starting save with \(audioBuffers.count) buffers...")
                    
                    // Save all collected buffers
                    self.saveBuffersToFile(
                        buffers: audioBuffers,
                        outputURL: outputURL,
                        text: text,
                        insertTime: insertTime,
                        segmentNumber: segmentNumber,
                        completion: completion
                    )
                }
            } else {
                print("[TTSGenerator] ⚠️ Received unknown buffer type: \(type(of: buffer))")
            }
        }
        
        print("[TTSGenerator] ✅ write() method called, waiting for callbacks...")
        
        // Fallback timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 20.0) { [weak self] in
            guard let self = self else { return }
            
            print("[TTSGenerator] ⏱️ Timeout check - Callbacks received: \(callbackCount), Buffers: \(audioBuffers.count), Completed: \(hasCalledCompletion)")
            
            guard !hasCalledCompletion else {
                print("[TTSGenerator] ✅ Already completed, timeout ignored")
                return
            }
            
            if audioBuffers.isEmpty {
                print("[TTSGenerator] ❌ Timeout with NO buffers - write() never called callback!")
                hasCalledCompletion = true
                completion(nil)
            } else {
                print("[TTSGenerator] ⏱️ Forcing save with \(audioBuffers.count) buffers after timeout")
                hasCalledCompletion = true
                
                self.saveBuffersToFile(
                    buffers: audioBuffers,
                    outputURL: outputURL,
                    text: text,
                    insertTime: insertTime,
                    segmentNumber: segmentNumber,
                    completion: completion
                )
            }
        }
    }
    
    private func saveBuffersToFile(
        buffers: [AVAudioPCMBuffer],
        outputURL: URL,
        text: String,
        insertTime: TimeInterval,
        segmentNumber: Int,
        completion: @escaping (AudioSegment?) -> Void
    ) {
        print("[TTSGenerator] 💾 saveBuffersToFile called with \(buffers.count) buffers")
        
        DispatchQueue.global(qos: .userInitiated).async {
            guard !buffers.isEmpty, let firstBuffer = buffers.first else {
                print("[TTSGenerator] ❌ Segment \(segmentNumber) - No buffers to save")
                DispatchQueue.main.async {
                    completion(nil)
                }
                return
            }
            
            do {
                let format = firstBuffer.format
                let totalFrames = buffers.reduce(0) { $0 + $1.frameLength }
                
                print("[TTSGenerator] 💾 Format: \(format.sampleRate)Hz, \(format.channelCount) channels")
                print("[TTSGenerator] 💾 Total frames: \(totalFrames)")
                
                // Create audio file
                let settings: [String: Any] = [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: format.sampleRate,
                    AVNumberOfChannelsKey: format.channelCount,
                    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
                ]
                
                let audioFile = try AVAudioFile(
                    forWriting: outputURL,
                    settings: settings,
                    commonFormat: .pcmFormatFloat32,
                    interleaved: false
                )
                
                // Write all buffers to file
                for (index, buffer) in buffers.enumerated() {
                    try audioFile.write(from: buffer)
                    print("[TTSGenerator] ✍️ Wrote buffer \(index + 1)/\(buffers.count)")
                }
                
                // Calculate duration
                let duration = Double(totalFrames) / format.sampleRate
                
                // Verify file
                let fileSize = (try? FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? UInt64) ?? 0
                
                print("[TTSGenerator] 📊 File saved: \(fileSize) bytes, duration: \(String(format: "%.2f", duration))s")
                
                guard fileSize > 0 else {
                    print("[TTSGenerator] ⚠️ File is empty!")
                    DispatchQueue.main.async {
                        completion(nil)
                    }
                    return
                }
                
              // Add 0.3s silence padding before each Siri segment
              // ⚠️ CRITICAL: Add 0.3s silence padding before each Siri segment
              // This accounts for AI response time so voices don't overlap
              let paddedInsertTime = insertTime + 0.3

              let segment = AudioSegment(
                  url: outputURL,
                  insertTime: paddedInsertTime,  // ← Use padded time, not raw insertTime!
                  duration: duration,
                  text: text
              )
                
                DispatchQueue.main.async {
                    completion(segment)
                }
                
            } catch {
                print("[TTSGenerator] ❌ Save error: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    completion(nil)
                }
            }
        }
    }
}

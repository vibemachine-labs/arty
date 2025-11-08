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
    private let logger = VmWebrtcLogging.logger
    
    // Keep synthesizer alive as instance variable
    private var currentSynthesizer: AVSpeechSynthesizer?
    
    // MARK: - Public Methods
    
    func generateSegments(
        from turns: [ConversationTurn],
        completion: @escaping ([AudioSegment]) -> Void
    ) {
        let aiTurns = turns.filter { $0.speaker == .ai }
        
        guard !aiTurns.isEmpty else {
            self.logger.log("[TTSGenerator] ⚠️ No AI turns to generate")
            completion([])
            return
        }
        
        self.logger.log("[TTSGenerator] 🔇 Generating \(aiTurns.count) TTS segments SILENTLY...")
//        self.logger.log("[TTSGenerator] 📱 iOS Version: \(UIDevice.current.systemVersion)")
        
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
            self.logger.log("[TTSGenerator] ✅ All \(sorted.count) segments generated silently!")
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
        
        self.logger.log("[TTSGenerator] 🔇 Processing segment \(segmentNumber)/\(totalSegments): \"\(segment.text)\"")
        
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
                self.logger.log("[TTSGenerator] ✅ Segment \(segmentNumber) complete: \(String(format: "%.2f", audioSegment.duration))s")
            } else {
                self.logger.log("[TTSGenerator] ❌ Segment \(segmentNumber) failed")
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
            self.logger.log("[TTSGenerator] ❌ Failed to create synthesizer")
            completion(nil)
            return
        }
        
        // Create utterance
        let utterance = AVSpeechUtterance(string: text)
        
        // Use premium voice
        let availableVoices = AVSpeechSynthesisVoice.speechVoices()
        self.logger.log("[TTSGenerator] 🎤 Available voices: \(availableVoices.count)")
        
        if let zoeVoice = AVSpeechSynthesisVoice(identifier: "com.apple.voice.premium.en-US.Zoe") {
            utterance.voice = zoeVoice
            self.logger.log("[TTSGenerator] 🎤 Using Zoe voice")
        } else if let voice = AVSpeechSynthesisVoice(language: "en-US") {
            utterance.voice = voice
            self.logger.log("[TTSGenerator] 🎤 Using fallback en-US voice")
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
        
        self.logger.log("[TTSGenerator] 📝 Calling synthesizer.write() for segment \(segmentNumber)...")
        
        // Write to buffer
        synthesizer.write(utterance) { buffer in
            callbackCount += 1
            self.logger.log("[TTSGenerator] 🔔 Callback #\(callbackCount) for segment \(segmentNumber)")
            
            if let pcmBuffer = buffer as? AVAudioPCMBuffer {
                self.logger.log("[TTSGenerator] 📦 Buffer type: AVAudioPCMBuffer, frames: \(pcmBuffer.frameLength)")
                
                if pcmBuffer.frameLength > 0 {
                    // Non-empty buffer - collect it
                    audioBuffers.append(pcmBuffer)
                    self.logger.log("[TTSGenerator] ✅ Collected buffer \(audioBuffers.count): \(pcmBuffer.frameLength) frames")
                } else {
                    // Empty buffer = we're done!
                    self.logger.log("[TTSGenerator] 🏁 Segment \(segmentNumber) - Empty buffer received (completion signal)")
                    
                    guard !hasCalledCompletion else {
                        self.logger.log("[TTSGenerator] ⚠️ Completion already called, ignoring")
                        return
                    }
                    hasCalledCompletion = true
                    
                    self.logger.log("[TTSGenerator] 💾 Starting save with \(audioBuffers.count) buffers...")
                    
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
                self.logger.log("[TTSGenerator] ⚠️ Received unknown buffer type: \(type(of: buffer))")
            }
        }
        
        self.logger.log("[TTSGenerator] ✅ write() method called, waiting for callbacks...")
        
        // Fallback timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 20.0) { [weak self] in
            guard let self = self else { return }
            
            self.logger.log("[TTSGenerator] ⏱️ Timeout check - Callbacks received: \(callbackCount), Buffers: \(audioBuffers.count), Completed: \(hasCalledCompletion)")
            
            guard !hasCalledCompletion else {
                self.logger.log("[TTSGenerator] ✅ Already completed, timeout ignored")
                return
            }
            
            if audioBuffers.isEmpty {
                self.logger.log("[TTSGenerator] ❌ Timeout with NO buffers - write() never called callback!")
                hasCalledCompletion = true
                completion(nil)
            } else {
                self.logger.log("[TTSGenerator] ⏱️ Forcing save with \(audioBuffers.count) buffers after timeout")
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
        self.logger.log("[TTSGenerator] 💾 saveBuffersToFile called with \(buffers.count) buffers")
        
        DispatchQueue.global(qos: .userInitiated).async {
            guard !buffers.isEmpty, let firstBuffer = buffers.first else {
                self.logger.log("[TTSGenerator] ❌ Segment \(segmentNumber) - No buffers to save")
                DispatchQueue.main.async {
                    completion(nil)
                }
                return
            }
            
            do {
                let format = firstBuffer.format
                let totalFrames = buffers.reduce(0) { $0 + $1.frameLength }
                
                self.logger.log("[TTSGenerator] 💾 Format: \(format.sampleRate)Hz, \(format.channelCount) channels")
                self.logger.log("[TTSGenerator] 💾 Total frames: \(totalFrames)")
                
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
                    self.logger.log("[TTSGenerator] ✍️ Wrote buffer \(index + 1)/\(buffers.count)")
                }
                
                // Calculate duration
                let duration = Double(totalFrames) / format.sampleRate
                
                // Verify file
                let fileSize = (try? FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? UInt64) ?? 0
                
                self.logger.log("[TTSGenerator] 📊 File saved: \(fileSize) bytes, duration: \(String(format: "%.2f", duration))s")
                
                guard fileSize > 0 else {
                    self.logger.log("[TTSGenerator] ⚠️ File is empty!")
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
                self.logger.log("[TTSGenerator] ❌ Save error: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    completion(nil)
                }
            }
        }
    }
}

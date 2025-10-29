import Foundation
import AVFoundation

@available(iOS 13.0, *)
class OpenAITTSGenerator: NSObject {
    
    func generateSegments(
        from turns: [ConversationTurn],
        apiKey: String,
        voice: String = "nova",
        completion: @escaping ([AudioSegment]) -> Void
    ) {
        let aiTurns = turns.filter { $0.speaker == .ai }
        
        guard !aiTurns.isEmpty else {
            print("[OpenAI-TTS] ⚠️ No AI turns to generate")
            completion([])
            return
        }
        
        print("[OpenAI-TTS] 🎙️ Generating \(aiTurns.count) segments using OpenAI TTS API (voice: \(voice))...")
        
        let group = DispatchGroup()
        var segments: [AudioSegment] = []
        let segmentsLock = NSLock()
        
        for (index, turn) in aiTurns.enumerated() {
            group.enter()
            
            let outputURL = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString + ".mp3")
            
            print("[OpenAI-TTS] 🔊 Generating segment \(index + 1)/\(aiTurns.count)...")
            
            // Add delay to avoid rate limits
            DispatchQueue.global().asyncAfter(deadline: .now() + Double(index) * 0.5) {
                self.generateSingleSegment(
                    text: turn.text,
                    insertTime: turn.relativeTime,
                    outputURL: outputURL,
                    apiKey: apiKey,
                    voice: voice
                ) { segment in
                    if let segment = segment {
                        segmentsLock.lock()
                        segments.append(segment)
                        segmentsLock.unlock()
                        print("[OpenAI-TTS] ✅ Segment \(index + 1) complete: \(String(format: "%.2f", segment.duration))s")
                    }
                    group.leave()
                }
            }
        }
        
        group.notify(queue: .main) {
            let sorted = segments.sorted { $0.insertTime < $1.insertTime }
            print("[OpenAI-TTS] ✅ All \(sorted.count) segments generated!")
            completion(sorted)
        }
    }
    
    private func generateSingleSegment(
        text: String,
        insertTime: TimeInterval,
        outputURL: URL,
        apiKey: String,
        voice: String,
        completion: @escaping (AudioSegment?) -> Void
    ) {
        guard let url = URL(string: "https://api.openai.com/v1/audio/speech") else {
            print("[OpenAI-TTS] ❌ Invalid URL")
            completion(nil)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let requestBody: [String: Any] = [
            "model": "tts-1",
            "input": text,
            "voice": voice,
            "response_format": "mp3",
            "speed": 1.0
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)
        } catch {
            print("[OpenAI-TTS] ❌ Failed to encode request: \(error.localizedDescription)")
            completion(nil)
            return
        }
        
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[OpenAI-TTS] ❌ Network error: \(error.localizedDescription)")
                completion(nil)
                return
            }
            
          guard let httpResponse = response as? HTTPURLResponse else {
              print("[OpenAI-TTS] ❌ No HTTP response")
              completion(nil)
              return
          }

          print("[OpenAI-TTS] 📊 API Response Status: \(httpResponse.statusCode)")

          guard (200...299).contains(httpResponse.statusCode) else {
              if let data = data, let errorBody = String(data: data, encoding: .utf8) {
                  print("[OpenAI-TTS] ❌ API error \(httpResponse.statusCode): \(errorBody)")
              } else {
                  print("[OpenAI-TTS] ❌ API error \(httpResponse.statusCode) - no error details")
              }
              completion(nil)
              return
          }
            guard let data = data else {
                print("[OpenAI-TTS] ❌ No data received")
                completion(nil)
                return
            }
            
            do {
                try data.write(to: outputURL)
                self.convertMP3ToM4A(mp3URL: outputURL, insertTime: insertTime, text: text, completion: completion)
            } catch {
                print("[OpenAI-TTS] ❌ Failed to save audio: \(error.localizedDescription)")
                completion(nil)
            }
        }
        
        task.resume()
    }
    
    private func convertMP3ToM4A(
        mp3URL: URL,
        insertTime: TimeInterval,
        text: String,
        completion: @escaping (AudioSegment?) -> Void
    ) {
        let m4aURL = mp3URL.deletingPathExtension().appendingPathExtension("m4a")
        
        let asset = AVAsset(url: mp3URL)
        
        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            print("[OpenAI-TTS] ❌ Failed to create export session")
            completion(nil)
            return
        }
        
        exportSession.outputURL = m4aURL
        exportSession.outputFileType = .m4a
        
        exportSession.exportAsynchronously {
            switch exportSession.status {
            case .completed:
                let duration = CMTimeGetSeconds(asset.duration)
                
                let segment = AudioSegment(
                    url: m4aURL,
                    insertTime: insertTime,
                    duration: duration,
                    text: text
                )
                
                try? FileManager.default.removeItem(at: mp3URL)
                completion(segment)
                
            case .failed:
                print("[OpenAI-TTS] ❌ Export failed: \(exportSession.error?.localizedDescription ?? "unknown")")
                completion(nil)
                
            default:
                completion(nil)
            }
        }
    }
}

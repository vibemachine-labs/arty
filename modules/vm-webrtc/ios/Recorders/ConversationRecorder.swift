import Foundation
import AVFoundation

// MARK: - Speaker Enum
enum Speaker {
    case user
    case ai
}

// MARK: - ConversationTurn Struct
struct ConversationTurn {
    let speaker: Speaker
    let text: String
    let timestamp: Date
    let relativeTime: TimeInterval  // Seconds from call start
}

// MARK: - ConversationRecorder Class
class ConversationRecorder {
    
    // MARK: - Properties
    private var callStartTime: Date?
    private var turns: [ConversationTurn] = []
    private weak var audioRecorder: AVAudioRecorder?  // Reference to mic recorder
    private let logger = VmWebrtcLogging.logger
    
    // MARK: - Public Methods
    
    /// Set reference to the audio recorder
    func setAudioRecorder(_ recorder: AVAudioRecorder?) {
        self.audioRecorder = recorder
        self.logger.log("[ConversationRecorder] 📹 Audio recorder reference set")
    }
    
    /// Call this when the WebRTC connection opens
    func startCall() {
        callStartTime = Date()
        turns.removeAll()
        self.logger.log("[ConversationRecorder] ✅ Call started at \(callStartTime!)")
    }
    
    /// Get current recording time
    private func getCurrentRecordingTime() -> TimeInterval {
        if let recorder = audioRecorder, recorder.isRecording {
            let recordingTime = recorder.currentTime
            self.logger.log("[ConversationRecorder] ⏱️ Current recording time: \(String(format: "%.2f", recordingTime))s")
            return recordingTime
        } else {
            // Fallback to Date-based calculation
            guard let startTime = callStartTime else { return 0 }
            let fallbackTime = Date().timeIntervalSince(startTime)
            self.logger.log("[ConversationRecorder] ⚠️ Using fallback time calculation: \(String(format: "%.2f", fallbackTime))s")
            return fallbackTime
        }
    }
    
    /// Call this when user's transcript arrives from OpenAI
    func addUserTranscript(_ text: String) {
        guard callStartTime != nil else {
            self.logger.log("[ConversationRecorder] ⚠️ Cannot add user transcript - call not started")
            return
        }
        
        guard !text.isEmpty else {
            self.logger.log("[ConversationRecorder] ⚠️ Empty user transcript, skipping")
            return
        }
        
        let now = Date()
        let relativeTime = getCurrentRecordingTime()
        
        let turn = ConversationTurn(
            speaker: .user,
            text: text,
            timestamp: now,
            relativeTime: relativeTime
        )
        
        turns.append(turn)
        
        self.logger.log("[ConversationRecorder] 👤 User [+\(String(format: "%.2f", relativeTime))s]: \(text)")
    }
    
    /// Call this when AI's transcript arrives from OpenAI
    func addAITranscript(_ text: String) {
        guard callStartTime != nil else {
            self.logger.log("[ConversationRecorder] ⚠️ Cannot add AI transcript - call not started")
            return
        }
        
        guard !text.isEmpty else {
            self.logger.log("[ConversationRecorder] ⚠️ Empty AI transcript, skipping")
            return
        }
        
        let now = Date()
        let relativeTime = getCurrentRecordingTime()
        
        let turn = ConversationTurn(
            speaker: .ai,
            text: text,
            timestamp: now,
            relativeTime: relativeTime
        )
        
        turns.append(turn)
        
        self.logger.log("[ConversationRecorder] 🤖 AI [+\(String(format: "%.2f", relativeTime))s]: \(text)")
    }
    
    /// Add AI transcript with custom timestamp
    func addAITranscriptWithTime(_ text: String, relativeTime: TimeInterval) {
        guard callStartTime != nil else {
            self.logger.log("[ConversationRecorder] ⚠️ Cannot add AI transcript - call not started")
            return
        }
        
        guard !text.isEmpty else {
            self.logger.log("[ConversationRecorder] ⚠️ Empty AI transcript, skipping")
            return
        }
        
        let now = Date()
        
        let turn = ConversationTurn(
            speaker: .ai,
            text: text,
            timestamp: now,
            relativeTime: relativeTime
        )
        
        turns.append(turn)
        
        self.logger.log("[ConversationRecorder] 🤖 AI [CUSTOM +\(String(format: "%.2f", relativeTime))s]: \(text)")
    }
    
    /// Get all conversation turns sorted by time
    func getAllTurns() -> [ConversationTurn] {
        return turns.sorted { $0.relativeTime < $1.relativeTime }
    }
    
    /// Get only AI turns (for TTS generation)
    func getAITurns() -> [ConversationTurn] {
        return turns.filter { $0.speaker == .ai }.sorted { $0.relativeTime < $1.relativeTime }
    }
    
    /// Reset for next call
    func reset() {
        callStartTime = nil
        turns.removeAll()
        audioRecorder = nil
        self.logger.log("[ConversationRecorder] 🔄 Reset")
    }
    
    /// Check if recording is active
    var isRecording: Bool {
        return callStartTime != nil
    }
    
    /// Get total number of turns
    var turnCount: Int {
        return turns.count
    }
    
    /// Get summary for logging
    func getSummary() -> String {
        let userCount = turns.filter { $0.speaker == .user }.count
        let aiCount = turns.filter { $0.speaker == .ai }.count
        return "Total: \(turns.count) turns (User: \(userCount), AI: \(aiCount))"
    }
    
    /// Get start time
    func getStartTime() -> Date? {
        return callStartTime
    }
}

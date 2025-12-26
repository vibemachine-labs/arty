import Foundation

enum VmWebrtcLogging {

    // MARK: - Log Level Configuration

    /// Minimum log level for Logfire logging.
    /// Logs below this level will be filtered out.
    ///
    /// Available levels (from most to least verbose):
    ///   .trace  - Most verbose, includes all RTP stats polling
    ///   .debug  - Includes state changes and detailed info
    ///   .info   - Standard operational messages
    ///   .warn   - Warnings only
    ///   .error  - Errors only
    ///
    /// To reduce log verbosity, uncomment the .debug line and comment the .trace line:
    // static let minimumLogLevel: OpenAIWebRTCClient.NativeLogLevel = .trace
    static let minimumLogLevel: OpenAIWebRTCClient.NativeLogLevel = .debug

    static let logger = NativeLogger(category: "VmWebrtc", tracingManager: nil)

    static func configureTracingManager(_ tracingManager: LogfireTracingManager?) {
        logger.attachTracingManager(tracingManager)
    }

    /// Check if a log level should be emitted based on the minimum log level configuration.
    /// Returns true if the level is at or above the minimum level.
    static func shouldLog(level: OpenAIWebRTCClient.NativeLogLevel) -> Bool {
        return level.numericValue >= minimumLogLevel.numericValue
    }
}

func logAttributes(
    for level: OpenAIWebRTCClient.NativeLogLevel,
    metadata: [String: Any]? = nil
) -> [String: Any] {
    var attributes = metadata ?? [:]
    attributes["level"] = level.rawValue
    return attributes
}

// MARK: - NativeLogLevel Extension for Comparison

extension OpenAIWebRTCClient.NativeLogLevel {
    /// Numeric value for log level comparison.
    /// Higher values = more severe/important logs.
    var numericValue: Int {
        switch self {
        case .trace: return 0
        case .debug: return 1
        case .info: return 2
        case .warn: return 3
        case .error: return 4
        }
    }
}

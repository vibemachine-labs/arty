import Foundation

/// Simple logger that mirrors console output to Logfire tracing events.
final class NativeLogger {
    private let category: String
    private let tracerName = LogfireTracingManager.Constants.defaultTracerName
    private weak var tracingManager: LogfireTracingManager?

    init(category: String, tracingManager: LogfireTracingManager?) {
        let trimmedCategory = category.trimmingCharacters(in: .whitespacesAndNewlines)
        self.category = trimmedCategory.isEmpty ? "VmWebrtc" : trimmedCategory
        self.tracingManager = tracingManager
    }

    func attachTracingManager(_ tracingManager: LogfireTracingManager?) {
        self.tracingManager = tracingManager
    }

    func log(_ message: String, attributes: [String: Any]? = nil) {
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedMessage.isEmpty else { return }

        let resolvedSeverity = LogfireTracingManager.severity(from: attributes) ?? .info

        // Check if this log level should be emitted based on minimum log level configuration
        let logLevel = nativeLogLevel(from: resolvedSeverity)
        guard VmWebrtcLogging.shouldLog(level: logLevel) else { return }

        let severityText = resolvedSeverity.severityText
        let severityNumber = resolvedSeverity.severityNumber

        print(
            "[NativeLogger] severityText=\(severityText) severityNumber=\(severityNumber) message=\(trimmedMessage)"
        )

        var consoleMessage = "[\(category)] \(trimmedMessage)"
        if let attributes, !attributes.isEmpty {
            let attributeSummary = attributes.map { "\($0.key)=\($0.value)" }.joined(
                separator: ", ")
            consoleMessage.append(" | \(attributeSummary)")
        }
        print(consoleMessage)

        guard let tracingManager else { return }
        guard tracingManager.isInitialized else {
            return
        }
        var resolvedAttributes = attributes ?? [:]
        resolvedAttributes["is_native_logger"] = true

        tracingManager.recordEvent(
            tracerName: tracerName,
            spanName: trimmedMessage,
            attributes: resolvedAttributes,
            severity: resolvedSeverity,
            severityText: severityText,
            severityNumber: severityNumber
        )
    }

    // MARK: - Private Helpers

    /// Convert LogfireTracingManager.Severity to OpenAIWebRTCClient.NativeLogLevel
    private func nativeLogLevel(from severity: LogfireTracingManager.Severity)
        -> OpenAIWebRTCClient.NativeLogLevel
    {
        switch severity {
        case .trace: return .trace
        case .debug: return .debug
        case .info: return .info
        case .warn: return .warn
        case .error: return .error
        }
    }
}

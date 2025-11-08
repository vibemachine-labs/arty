import Foundation

/// Simple logger that mirrors console output to Logfire tracing events.
final class NativeLogger {
  private let category: String
  private let tracerName: String?
  private weak var tracingManager: LogfireTracingManager?

  init(category: String, tracingManager: LogfireTracingManager?) {
    let trimmedCategory = category.trimmingCharacters(in: .whitespacesAndNewlines)
    self.category = trimmedCategory.isEmpty ? "VmWebrtc" : trimmedCategory
    self.tracingManager = tracingManager
    if tracingManager != nil {
      self.tracerName = LogfireTracingManager.Constants.defaultTracerName
    } else {
      self.tracerName = nil
    }
  }

  func log(_ message: String, attributes: [String: Any]? = nil) {
    let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedMessage.isEmpty else { return }

    var consoleMessage = "[\(category)] \(trimmedMessage)"
    if let attributes, !attributes.isEmpty {
      let attributeSummary = attributes.map { "\($0.key)=\($0.value)" }.joined(separator: ", ")
      consoleMessage.append(" | \(attributeSummary)")
    }
    print(consoleMessage)

    guard let tracingManager, let tracerName else { return }
    guard tracingManager.isInitialized else {
      return
    }
    tracingManager.recordEvent(
      tracerName: tracerName,
      spanName: trimmedMessage,
      attributes: attributes
    )
  }
}

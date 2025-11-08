import Foundation

enum VmWebrtcLogging {
  static let logger = NativeLogger(category: "VmWebrtc", tracingManager: nil)

  static func configureTracingManager(_ tracingManager: LogfireTracingManager?) {
    logger.attachTracingManager(tracingManager)
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

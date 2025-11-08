import Foundation

enum VmWebrtcLogging {
  static let logger = NativeLogger(category: "VmWebrtc", tracingManager: nil)

  static func configureTracingManager(_ tracingManager: LogfireTracingManager?) {
    logger.attachTracingManager(tracingManager)
  }
}

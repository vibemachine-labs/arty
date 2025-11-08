import Foundation
import OpenTelemetryApi
import OpenTelemetrySdk
import OpenTelemetryProtocolExporterCommon
import OpenTelemetryProtocolExporterHttp

final class LogfireTracingManager {
  enum Constants {
    static let traceEndpoint = "https://logfire-us.pydantic.dev/v1/traces"
    static let logEndpoint = "https://logfire-us.pydantic.dev/v1/logs"
    static let defaultTracerName = "vibemachine-tracer"
  }
  enum Severity: String {
    case trace
    case debug
    case info
    case warn
    case error

    var otelSeverity: OpenTelemetryApi.Severity {
      switch self {
      case .trace: return .trace
      case .debug: return .debug
      case .info: return .info
      case .warn: return .warn
      case .error: return .error
      }
    }

    var severityText: String {
      otelSeverity.description
    }

    var severityNumber: Int {
      otelSeverity.rawValue
    }
  }

  private let workerQueue = DispatchQueue(label: "com.vibemachine.logfire.queue", qos: .utility)
  private var tracerProvider: TracerProvider?
  private var batchSpanProcessor: BatchSpanProcessor?
  private var tracerCache: [String: Tracer] = [:]
  private var loggerProvider: LoggerProvider?
  private var logRecordProcessor: LogRecordProcessor?
  private var loggerCache: [String: Logger] = [:]
  private var currentServiceName: String?
  private var currentApiKey: String?
  private(set) var isInitialized = false

  func initialize(serviceName: String, apiKey: String) async throws {
    NSLog(
      "[LogfireTracingManager] initialize requested service=%@ apiKey=%@",
      serviceName,
      Self.redactedApiKeyDescription(apiKey)
    )

    try await withCheckedThrowingContinuation { continuation in
      workerQueue.async {
        do {
          try self.initializeIfNeeded(serviceName: serviceName, apiKey: apiKey)
          NSLog("[LogfireTracingManager] initialize completed (isInitialized=%@)", self.isInitialized.description)
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  func recordEvent(
    tracerName: String,
    spanName: String,
    attributes: [String: Any]?,
    severity: Severity? = nil,
    severityText: String? = nil,
    severityNumber: Int? = nil
  ) {
    workerQueue.async {
      guard self.isInitialized else {
        NSLog("[LogfireTracingManager] recordEvent skipped: tracing not initialized")
        return
      }

      let trimmedSpan = spanName.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedSpan.isEmpty else {
        NSLog("[LogfireTracingManager] recordEvent skipped: missing span name")
        return
      }

      let resolvedInstrumentationName = tracerName.isEmpty ? Constants.defaultTracerName : tracerName
      guard let logger = self.logger(named: resolvedInstrumentationName) else {
        NSLog("[LogfireTracingManager] recordEvent skipped: logger unavailable")
        return
      }

      let severityFromText = severityText.flatMap { Severity(anyValue: $0) }
      let severityFromNumber = severityNumber.flatMap { Severity(severityNumber: $0) }

      let resolvedSeverity = severity
        ?? severityFromText
        ?? severityFromNumber
        ?? Self.severity(from: attributes)
        ?? .info

      let resolvedSeverityText = severityText ?? resolvedSeverity.severityText
      let resolvedSeverityNumber = severityNumber ?? resolvedSeverity.severityNumber

      print(
        "[LogfireTracingManager] recordEvent span=\(trimmedSpan) severityText=\(resolvedSeverityText) severityNumber=\(resolvedSeverityNumber)"
      )

      let otelAttributes = self.otelAttributes(from: attributes ?? [:])
      logger
        .logRecordBuilder()
        .setSeverity(resolvedSeverity.otelSeverity)
        .setBody(AttributeValue.string(trimmedSpan))
        .setAttributes(otelAttributes)
        .emit()
    }
  }

  static func severity(from attributes: [String: Any]?) -> Severity? {
    guard let attributes else { return nil }
    let candidateKeys = ["severity", "level", "logLevel"]
    for key in candidateKeys {
      guard let value = attributes[key] else { continue }
      if let severity = Severity(anyValue: value) {
        return severity
      }
    }
    return nil
  }

  private func initializeIfNeeded(serviceName: String, apiKey: String) throws {
    let trimmedServiceName = serviceName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedServiceName.isEmpty else {
      throw LogfireTracingError.invalidServiceName
    }

    let trimmedApiKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedApiKey.isEmpty else {
      throw LogfireTracingError.missingApiKey
    }

    if isInitialized,
       trimmedServiceName == currentServiceName,
       trimmedApiKey == currentApiKey {
      NSLog("[LogfireTracingManager] initializeIfNeeded reused existing configuration")
      return
    }

    teardown()

    let resource = Resource(attributes: [
      "service.name": AttributeValue.string(trimmedServiceName),
      "telemetry.sdk.language": AttributeValue.string("swift")
    ])

    guard
      let traceEndpointURL = URL(string: Constants.traceEndpoint),
      let logEndpointURL = URL(string: Constants.logEndpoint)
    else {
      throw LogfireTracingError.invalidEndpoint
    }

    let configuration = OtlpConfiguration(
      timeout: OtlpConfiguration.DefaultTimeoutInterval,
      headers: [("Authorization", trimmedApiKey)],
      exportAsJson: true
    )

    let traceExporter = OtlpHttpTraceExporter(endpoint: traceEndpointURL, config: configuration)
    let traceProcessor = BatchSpanProcessor(spanExporter: traceExporter)
    let traceProvider = TracerProviderBuilder()
      .add(spanProcessor: traceProcessor)
      .with(resource: resource)
      .build()

    let logExporter = OtlpHttpLogExporter(endpoint: logEndpointURL, config: configuration)
    let logProcessor = BatchLogRecordProcessor(logRecordExporter: logExporter)
    let loggerProvider = LoggerProviderBuilder()
      .with(resource: resource)
      .with(processors: [logProcessor])
      .build()

    OpenTelemetry.registerTracerProvider(tracerProvider: traceProvider)
    OpenTelemetry.registerLoggerProvider(loggerProvider: loggerProvider)

    tracerProvider = traceProvider
    batchSpanProcessor = traceProcessor
    tracerCache.removeAll()
    self.loggerProvider = loggerProvider
    logRecordProcessor = logProcessor
    loggerCache.removeAll()
    currentServiceName = trimmedServiceName
    currentApiKey = trimmedApiKey
    isInitialized = true
    NSLog("[LogfireTracingManager] tracing initialized for service=%@ apiKey=%@", trimmedServiceName, Self.redactedApiKeyDescription(trimmedApiKey))
  }

  private func tracer(named name: String) -> Tracer? {
    if let cached = tracerCache[name] {
      return cached
    }

    guard let provider = tracerProvider else {
      return nil
    }

    let tracer = provider.get(instrumentationName: name)
    tracerCache[name] = tracer
    return tracer
  }

  private func logger(named name: String) -> Logger? {
    if let cached = loggerCache[name] {
      return cached
    }

    guard let provider = loggerProvider else {
      return nil
    }

    let logger = provider.get(instrumentationScopeName: name)
    loggerCache[name] = logger
    return logger
  }

  private func otelAttributes(from dictionary: [String: Any]) -> [String: AttributeValue] {
    var attributes: [String: AttributeValue] = [:]
    for (key, value) in dictionary {
      guard !key.isEmpty else { continue }
      if let attributeValue = attributeValue(from: value) {
        attributes[key] = attributeValue
      } else {
        attributes[key] = AttributeValue.string(String(describing: value))
      }
    }
    return attributes
  }

  private func attributeValue(from anyValue: Any) -> AttributeValue? {
    if let attributeValue = anyValue as? AttributeValue {
      return attributeValue
    }

    if let string = anyValue as? String {
      return .string(string)
    }

    if let bool = anyValue as? Bool {
      return .bool(bool)
    }

    if let int = anyValue as? Int {
      return .int(int)
    }

    if let double = anyValue as? Double {
      return .double(double)
    }

    if let number = anyValue as? NSNumber {
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        return .bool(number.boolValue)
      }

      if CFNumberIsFloatType(number) {
        return .double(number.doubleValue)
      }

      return .int(number.intValue)
    }

    if let array = anyValue as? [Any] {
      let values = array.compactMap { attributeValue(from: $0) }
      if values.isEmpty {
        return nil
      }
      return .array(AttributeArray(values: values))
    }

    return .string(String(describing: anyValue))
  }

  private func teardown() {
    if var processor = batchSpanProcessor {
      processor.shutdown()
    }
    batchSpanProcessor = nil
    if let logProcessor = logRecordProcessor {
      logProcessor.shutdown()
    }
    logRecordProcessor = nil
    tracerProvider = nil
    loggerProvider = nil
    tracerCache.removeAll()
    loggerCache.removeAll()
    currentServiceName = nil
    currentApiKey = nil
    isInitialized = false
    NSLog("[LogfireTracingManager] tracing teardown completed")
  }

  private static func redactedApiKeyDescription(_ apiKey: String) -> String {
    guard !apiKey.isEmpty else { return "empty" }
    let prefix = apiKey.prefix(4)
    let suffix = apiKey.suffix(4)
    return "\(prefix)…\(suffix) (len=\(apiKey.count))"
  }
}

enum LogfireTracingError: LocalizedError {
  case invalidServiceName
  case missingApiKey
  case invalidEndpoint

  var errorDescription: String? {
    switch self {
    case .invalidServiceName:
      return "Service name must not be empty."
    case .missingApiKey:
      return "API key must not be empty."
    case .invalidEndpoint:
      return "Logfire endpoint URL is invalid."
    }
  }
}

extension LogfireTracingManager.Severity {
  init?(anyValue: Any) {
    if let severity = anyValue as? LogfireTracingManager.Severity {
      self = severity
      return
    }
    if let string = anyValue as? String {
      self.init(rawValue: Self.normalizedSeverityString(string))
      return
    }
    if let string = anyValue as? NSString {
      self.init(rawValue: Self.normalizedSeverityString(String(string)))
      return
    }
    self.init(rawValue: Self.normalizedSeverityString(String(describing: anyValue)))
  }

  init?(severityNumber: Int) {
    switch severityNumber {
    case 1...4:
      self = .trace
    case 5...8:
      self = .debug
    case 9...12:
      self = .info
    case 13...16:
      self = .warn
    case 17...24:
      self = .error
    default:
      return nil
    }
  }

  private static func normalizedSeverityString(_ string: String) -> String {
    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if trimmed == "tracing" {
      return "trace"
    }
    return trimmed
  }
}

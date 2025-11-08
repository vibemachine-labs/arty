import Foundation
import OpenTelemetryApi
import OpenTelemetrySdk
import OpenTelemetryProtocolExporterCommon
import OpenTelemetryProtocolExporterHttp

final class LogfireTracingManager {
  enum Constants {
    static let endpoint = "https://logfire-us.pydantic.dev/v1/traces"
    static let defaultTracerName = "vibemachine-tracer"
  }
  enum Severity: String {
    case trace
    case debug
    case info
    case warn
    case error

    var severityText: String {
      rawValue.uppercased()
    }

    var severityNumber: Int {
      switch self {
      case .trace: return 3   // TRACE3
      case .debug: return 7   // DEBUG3 per OTLP spec
      case .info: return 11   // INFO3
      case .warn: return 15   // WARN3
      case .error: return 19  // ERROR3
      }
    }
  }

  private let workerQueue = DispatchQueue(label: "com.vibemachine.logfire.queue", qos: .utility)
  private var tracerProvider: TracerProvider?
  private var batchSpanProcessor: BatchSpanProcessor?
  private var tracerCache: [String: Tracer] = [:]
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
    severity: Severity? = nil
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

      let resolvedTracerName = tracerName.isEmpty ? Constants.defaultTracerName : tracerName
      guard let tracer = self.tracer(named: resolvedTracerName) else {
        NSLog("[LogfireTracingManager] recordEvent skipped: tracer unavailable")
        return
      }

      let resolvedSeverity = severity ?? Self.severity(from: attributes) ?? .info
      let span = tracer.spanBuilder(spanName: trimmedSpan).startSpan()
      span.setAttribute(key: "otel.log.severity.text", value: AttributeValue.string(resolvedSeverity.severityText))
      span.setAttribute(key: "otel.log.severity.number", value: AttributeValue.int(resolvedSeverity.severityNumber))
      span.setAttribute(key: "logfire.level", value: AttributeValue.string(resolvedSeverity.rawValue))

      if let attributes = attributes {
        for (key, value) in attributes {
          guard !key.isEmpty else { continue }
          if let attributeValue = self.attributeValue(from: value) {
            span.setAttribute(key: key, value: attributeValue)
          } else {
            span.setAttribute(key: key, value: AttributeValue.string(String(describing: value)))
          }
        }
      }
      span.end()
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

    guard let endpointURL = URL(string: Constants.endpoint) else {
      throw LogfireTracingError.invalidEndpoint
    }

    let configuration = OtlpConfiguration(
      timeout: OtlpConfiguration.DefaultTimeoutInterval,
      headers: [("Authorization", trimmedApiKey)],
      exportAsJson: true
    )

    let exporter = OtlpHttpTraceExporter(endpoint: endpointURL, config: configuration)
    let processor = BatchSpanProcessor(spanExporter: exporter)

    let provider = TracerProviderBuilder()
      .add(spanProcessor: processor)
      .with(resource: resource)
      .build()

    OpenTelemetry.registerTracerProvider(tracerProvider: provider)

    tracerProvider = provider
    batchSpanProcessor = processor
    tracerCache.removeAll()
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
    tracerProvider = nil
    tracerCache.removeAll()
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

  private static func normalizedSeverityString(_ string: String) -> String {
    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if trimmed == "tracing" {
      return "trace"
    }
    return trimmed
  }
}

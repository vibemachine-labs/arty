import Foundation
import ExpoModulesCore

// MARK: - Tool Call Responder

/// Protocol adopted by classes capable of relaying tool execution results back to OpenAI.
public protocol ToolCallResponder: AnyObject {
  /// Send a successful tool execution result.
  func sendToolCallResult(callId: String, result: String)
  /// Send an error response for a tool execution.
  func sendToolCallError(callId: String, error: String)
}

// MARK: - Base Tool Helper

/// Base class that provides shared functionality for all tool implementations
/// Handles common tasks like JSON parsing, callback management, timeout handling, and event emission
public class ToolHelper {
  
  // MARK: - Properties
  
  private weak var module: Module?
  private var callbacks: [String: (Int?, Error?) -> Void] = [:]
  private let timeoutDuration: TimeInterval
  private let logger = VmWebrtcLogging.logger
  
  // MARK: - Initialization
  
  public init(module: Module, timeoutDuration: TimeInterval = 45.0) {
    self.module = module
    self.timeoutDuration = timeoutDuration
  }
  
  // MARK: - JSON Parsing
  
  /// Parse JSON arguments and extract integer operands
  /// - Parameters:
  ///   - argumentsJSON: JSON string containing the arguments
  ///   - keys: Array of keys to extract (defaults to ["a", "b"])
  /// - Returns: Array of parsed integers, or nil if parsing fails
  public func parseOperands(from argumentsJSON: String, keys: [String] = ["a", "b"]) -> [Int]? {
    guard let argsData = argumentsJSON.data(using: .utf8),
          let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any] else {
      self.logger.log("[ToolHelper] Failed to parse JSON arguments")
      return nil
    }
    
    var operands: [Int] = []
    
    for key in keys {
      if let intValue = argsDict[key] as? Int {
        operands.append(intValue)
      } else if let doubleValue = argsDict[key] as? Double {
        operands.append(Int(doubleValue))
      } else {
        self.logger.log("[ToolHelper] Missing or invalid parameter: \(key)")
        return nil
      }
    }
    
    return operands
  }
  
  // MARK: - Callback Management
  
  /// Register a callback for a specific request
  /// - Parameters:
  ///   - requestId: Unique identifier for the request
  ///   - callback: Callback to invoke when response is received
  public func registerCallback(requestId: String, callback: @escaping (Int?, Error?) -> Void) {
    callbacks[requestId] = callback
  }
  
  /// Execute and remove a callback
  /// - Parameters:
  ///   - requestId: Unique identifier for the request
  ///   - result: Result value (optional)
  ///   - error: Error value (optional)
  /// - Returns: True if callback was found and executed, false otherwise
  @discardableResult
  public func executeCallback(requestId: String, result: Int? = nil, error: Error? = nil) -> Bool {
    guard let callback = callbacks[requestId] else {
      self.logger.log("[ToolHelper] No callback found for requestId=\(requestId)")
      return false
    }
    
    callback(result, error)
    callbacks.removeValue(forKey: requestId)
    return true
  }
  
  // MARK: - Event Emission
  
  /// Emit a tool request event to JavaScript
  /// - Parameters:
  ///   - eventName: Name of the event to emit
  ///   - requestId: Unique identifier for the request
  ///   - parameters: Dictionary of parameters to send
  /// - Returns: Generated event identifier for correlation
  @discardableResult
  public func emitToolRequest(eventName: String, requestId: String, parameters: [String: Any]) -> String {
    let eventId = ToolHelper.generateEventId()
    
    guard let module = module else {
      self.logger.log("[ToolHelper] Module reference is nil, cannot emit event \(eventName) requestId=\(requestId) eventId=\(eventId)")
      return eventId
    }
    
    var eventData = parameters
    eventData["requestId"] = requestId
    eventData["eventId"] = eventId
    
    module.sendEvent(eventName, eventData)
    self.logger.log(
      "[ToolHelper] Emitted event",
      attributes: [
        "eventName": eventName,
        "requestId": requestId,
        "eventId": eventId,
        "parameter_keys": Array(parameters.keys)
      ]
    )
    return eventId
  }
  
  // MARK: - Timeout Management
  
  /// Set up a timeout for a request
  /// - Parameters:
  ///   - requestId: Unique identifier for the request
  ///   - errorMessage: Custom error message (optional)
  public func setupTimeout(for requestId: String, errorMessage: String = "Request timed out") {
    DispatchQueue.main.asyncAfter(deadline: .now() + timeoutDuration) { [weak self] in
      guard let self = self else { return }
      
      if self.callbacks[requestId] != nil {
        self.logger.log("[ToolHelper] Request timed out: requestId=\(requestId)")
        let error = NSError(domain: "ToolHelper", code: -1, userInfo: [
          NSLocalizedDescriptionKey: errorMessage
        ])
        self.executeCallback(requestId: requestId, error: error)
      }
    }
  }
  
  // MARK: - Utility Methods
  
  /// Generate a unique request ID
  /// - Returns: UUID string
  public static func generateRequestId() -> String {
    return UUID().uuidString
  }
  
  /// Generate a unique event ID
  /// - Returns: UUID string
  public static func generateEventId() -> String {
    return UUID().uuidString
  }
}

// MARK: - Base Tool Protocol

/// Protocol for tool implementations that use ToolHelper
public protocol BaseTool: AnyObject {
  /// The tool name used for identification
  var toolName: String { get }
  
  /// Handle a tool call from OpenAI
  /// - Parameters:
  ///   - callId: The tool call identifier
  ///   - argumentsJSON: JSON string containing the arguments
  func handleToolCall(callId: String, argumentsJSON: String)
  
  /// Handle a response from JavaScript
  /// - Parameters:
  ///   - requestId: The unique request identifier
  ///   - result: The calculation result
  func handleResponse(requestId: String, result: Int)
}

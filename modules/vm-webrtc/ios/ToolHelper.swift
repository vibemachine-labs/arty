import ExpoModulesCore
import Foundation

// MARK: - Tool Call Responder

/// Protocol adopted by classes capable of relaying tool execution results back to OpenAI.
public protocol ToolCallResponder: AnyObject {
    /// Send a successful tool execution result.
    func sendToolCallResult(callId: String, result: String)
    /// Send an error response for a tool execution.
    func sendToolCallError(callId: String, error: String)
    /// Send an arbitrary event to the OpenAI data channel.
    func sendEvent(_ payload: [String: Any]) -> Bool
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

    // Track callback usage count to detect anomalies
    private var callbackUsageCount: [String: Int] = [:]

    // Serial queue to synchronize access to callbacks and callbackUsageCount
    private let callbackQueue = DispatchQueue(label: "com.arty.ToolHelper.callbacks")

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
            let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any]
        else {
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
        callbackQueue.sync {
            callbacks[requestId] = callback
        }
    }

    /// Execute a callback (without removing it)
    /// - Parameters:
    ///   - requestId: Unique identifier for the request
    ///   - result: Result value (optional)
    ///   - error: Error value (optional)
    /// - Returns: True if callback was found and executed, false otherwise
    @discardableResult
    public func executeCallback(requestId: String, result: Int? = nil, error: Error? = nil) -> Bool
    {
        // Retrieve callback and update usage count on queue, then invoke outside to avoid deadlocks
        let (callback, newUsageCount, isAnomalous): (((Int?, Error?) -> Void)?, Int, Bool) =
            callbackQueue.sync {
                // Track usage count for anomaly detection
                let currentUsageCount = callbackUsageCount[requestId] ?? 0
                let count = currentUsageCount + 1
                callbackUsageCount[requestId] = count

                let cb = callbacks[requestId]
                return (cb, count, count > 1)
            }

        // Check for anomalous behavior (callback used more than once)
        if isAnomalous {
            self.logger.log(
                "[ToolHelper] 🚨 ANOMALY DETECTED: Callback used multiple times!",
                attributes: [
                    "requestId": requestId,
                    "usageCount": newUsageCount,
                    "warning":
                        "This indicates a bug - requestId may be reused or callback invoked multiple times",
                ]
            )
        }

        guard let callback = callback else {
            self.logger.log(
                "[ToolHelper] No callback found for requestId",
                attributes: [
                    "requestId": requestId,
                    "usageCount": newUsageCount,
                    "note": "Callback may have been cleaned up or never registered",
                ]
            )
            return false
        }

        callback(result, error)
        // Don't remove the callback - keep it to track usage patterns
        self.logger.log(
            "[ToolHelper] Callback executed",
            attributes: [
                "requestId": requestId,
                "usageCount": newUsageCount,
                "isFirstUse": newUsageCount == 1,
            ]
        )
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
    public func emitToolRequest(eventName: String, requestId: String, parameters: [String: Any])
        -> String
    {
        let eventId = ToolHelper.generateEventId()

        guard let module = module else {
            self.logger.log(
                "[ToolHelper] Module reference is nil, cannot emit event \(eventName) requestId=\(requestId) eventId=\(eventId)"
            )
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
                "parameter_keys": Array(parameters.keys),
            ]
        )
        return eventId
    }

    // MARK: - Timeout Management (LEGACY - UNUSED)

    /// Set up a timeout for a request
    /// - Parameters:
    ///   - requestId: Unique identifier for the request
    ///   - errorMessage: Custom error message (optional)
    ///
    /// - Note: LEGACY CODE - This method is never called. Each tool class (ToolGithubConnector,
    ///   ToolGDriveConnector, etc.) has its own setupStringTimeout implementation.
    ///   This method doesn't integrate with the state machine and causes confusing UX
    ///   when toolkit eventually returns after timeout (tells user it failed, then succeeds).
    ///   Consider removing in future cleanup.
    @available(
        *, deprecated,
        message: "Legacy unused method - each tool class has its own timeout implementation"
    )
    public func setupTimeout(for requestId: String, errorMessage: String = "Request timed out") {
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutDuration) { [weak self] in
            guard let self = self else { return }

            // Check if callback has already been used (thread-safe access)
            let (hasCallback, usageCount) = self.callbackQueue.sync {
                (self.callbacks[requestId] != nil, self.callbackUsageCount[requestId] ?? 0)
            }

            if hasCallback, usageCount == 0 {
                self.logger.log(
                    "[ToolHelper] Request timed out",
                    attributes: [
                        "requestId": requestId,
                        "usageCount": usageCount,
                    ]
                )
                let error = NSError(
                    domain: "ToolHelper", code: -1,
                    userInfo: [
                        NSLocalizedDescriptionKey: errorMessage
                    ])
                self.executeCallback(requestId: requestId, error: error)
            } else if usageCount > 0 {
                self.logger.log(
                    "[ToolHelper] Timeout fired but callback already used",
                    attributes: [
                        "requestId": requestId,
                        "usageCount": usageCount,
                    ]
                )
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

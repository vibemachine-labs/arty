import Foundation
import ExpoModulesCore

// MARK: - Toolkit Tool Manager

/// Manages Gen2 toolkit tool calls between OpenAI WebRTC and JavaScript
/// Handles all toolkit-based tools using a mux/demux approach with a single delegate
public class ToolkitHelper: BaseTool {

  // MARK: - Properties

  public let toolName = "toolkit_helper"

  private weak var module: Module?
  private weak var responder: ToolCallResponder?
  private let helper: ToolHelper
  private let logger = VmWebrtcLogging.logger

  // Track pending callbacks by requestId
  private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]

  // Track callback usage count to detect anomalies
  private var callbackUsageCount: [String: Int] = [:]

  // MARK: - Initialization

  public init(module: Module, responder: ToolCallResponder) {
    self.module = module
    self.responder = responder
    self.helper = ToolHelper(module: module)
    self.logger.log("[ToolkitHelper] Initialized")
  }

  // MARK: - Public Methods

  /// Handle a toolkit tool call from OpenAI
  /// - Parameters:
  ///   - callId: The tool call identifier from OpenAI
  ///   - toolName: The fully qualified tool name (e.g., "hacker_news__showTopStories")
  ///   - argumentsJSON: JSON string containing the tool arguments
  public func handleToolkitCall(callId: String, toolName: String, argumentsJSON: String) {
    self.logger.log(
      "[ToolkitHelper] Processing toolkit tool call",
      attributes: [
        "callId": callId,
        "toolName": toolName,
        "arguments_length": argumentsJSON.count,
        "arguments": argumentsJSON
      ]
    )

    // Parse the tool name to extract group and tool name
    guard let (groupName, shortToolName) = parseToolName(toolName) else {
      self.logger.log(
        "[ToolkitHelper] Failed to parse tool name",
        attributes: [
          "callId": callId,
          "toolName": toolName
        ]
      )
      responder?.sendToolCallError(callId: callId, error: "Invalid toolkit tool name format: \(toolName)")
      return
    }

    self.logger.log(
      "[ToolkitHelper] Parsed toolkit tool name",
      attributes: [
        "callId": callId,
        "groupName": groupName,
        "toolName": shortToolName
      ]
    )

    // Execute the toolkit operation
    executeToolkitOperation(
      callId: callId,
      groupName: groupName,
      toolName: shortToolName,
      argumentsJSON: argumentsJSON
    )
  }

  /// Handle a toolkit tool call from OpenAI (BaseTool protocol requirement)
  /// - Parameters:
  ///   - callId: The tool call identifier
  ///   - argumentsJSON: JSON string containing the arguments
  public func handleToolCall(callId: String, argumentsJSON: String) {
    // This is called from the event handler but we need the tool name
    // which should be passed separately. Log a warning for now.
    self.logger.log(
      "[ToolkitHelper] handleToolCall called without tool name",
      attributes: [
        "callId": callId,
        "note": "Use handleToolkitCall with explicit toolName instead"
      ]
    )
    responder?.sendToolCallError(callId: callId, error: "Toolkit tool called without tool name")
  }

  /// Handle a response from JavaScript
  /// - Parameters:
  ///   - requestId: The unique request identifier
  ///   - result: The response string from JavaScript
  public func handleResponse(requestId: String, result: String) {
    self.logger.log(
      "[ToolkitHelper] 📥 Received toolkit response from JavaScript",
      attributes: [
        "requestId": requestId,
        "result_preview": String(result.prefix(500)),
        "result": result
      ]
    )

    // Track usage count for anomaly detection
    let currentUsageCount = callbackUsageCount[requestId] ?? 0
    let newUsageCount = currentUsageCount + 1
    callbackUsageCount[requestId] = newUsageCount

    // Check for anomalous behavior (callback used more than once)
    if newUsageCount > 1 {
      self.logger.log(
        "[ToolkitHelper] 🚨 ANOMALY DETECTED: Callback used multiple times!",
        attributes: [
          "requestId": requestId,
          "usageCount": newUsageCount,
          "warning": "This indicates a bug - requestId may be reused or callback invoked multiple times"
        ]
      )
    }

    if let callback = stringCallbacks[requestId] {
      callback(result, nil)
      // Don't remove the callback - keep it to track usage patterns
      self.logger.log(
        "[ToolkitHelper] ✅ Toolkit callback executed successfully",
        attributes: [
          "requestId": requestId,
          "result_length": result.count,
          "usageCount": newUsageCount,
          "isFirstUse": newUsageCount == 1
        ]
      )
    } else {
      self.logger.log(
        "[ToolkitHelper] ⚠️ No callback found for requestId",
        attributes: [
          "requestId": requestId,
          "usageCount": newUsageCount,
          "note": "Callback may have been cleaned up or never registered"
        ]
      )
    }
  }

  /// Handle a response from JavaScript (BaseTool protocol requirement for Int results)
  /// - Parameters:
  ///   - requestId: The unique request identifier
  ///   - result: The integer result
  public func handleResponse(requestId: String, result: Int) {
    self.logger.log(
      "[ToolkitHelper] ⚠️ Received int result, but toolkit expects string",
      attributes: [
        "requestId": requestId,
        "result": result
      ]
    )
  }

  // MARK: - Private Methods

  /// Parse a fully qualified tool name into group and tool name
  /// - Parameter fullName: The full tool name (e.g., "hacker_news__showTopStories")
  /// - Returns: Tuple of (groupName, toolName) or nil if invalid format
  private func parseToolName(_ fullName: String) -> (String, String)? {
    // Look for the double underscore separator "__"
    guard let range = fullName.range(of: "__") else {
      self.logger.log(
        "[ToolkitHelper] Tool name does not contain double underscore separator",
        attributes: ["fullName": fullName]
      )
      return nil
    }

    let groupName = String(fullName[..<range.lowerBound])
    let toolName = String(fullName[range.upperBound...])

    // Validate both parts are non-empty
    guard !groupName.isEmpty, !toolName.isEmpty else {
      self.logger.log(
        "[ToolkitHelper] Tool name has empty group or tool component",
        attributes: [
          "fullName": fullName,
          "groupName": groupName,
          "toolName": toolName
        ]
      )
      return nil
    }

    return (groupName, toolName)
  }

  /// Execute a toolkit operation by forwarding to JavaScript
  /// - Parameters:
  ///   - callId: The OpenAI tool call identifier
  ///   - groupName: The toolkit group name (e.g., "hacker_news")
  ///   - toolName: The tool name (e.g., "showTopStories")
  ///   - argumentsJSON: JSON string containing the arguments
  private func executeToolkitOperation(
    callId: String,
    groupName: String,
    toolName: String,
    argumentsJSON: String
  ) {
    self.logger.log(
      "[ToolkitHelper] Executing toolkit tool call",
      attributes: [
        "callId": callId,
        "groupName": groupName,
        "toolName": toolName,
        "arguments_length": argumentsJSON.count
      ]
    )

    // Generate a request ID for tracking this operation
    let requestId = ToolHelper.generateRequestId()

    self.logger.log(
      "[ToolkitHelper] Generated request ID for toolkit operation",
      attributes: [
        "callId": callId,
        "requestId": requestId,
        "groupName": groupName,
        "toolName": toolName
      ]
    )

    // Register callback for this request
    registerStringCallback(requestId: requestId) { result, error in
      if let error = error {
        self.logger.log(
          "[ToolkitHelper] Toolkit operation failed",
          attributes: [
            "callId": callId,
            "requestId": requestId,
            "groupName": groupName,
            "toolName": toolName,
            "error": error.localizedDescription
          ]
        )
        self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
        return
      }

      guard let result = result else {
        self.logger.log(
          "[ToolkitHelper] Toolkit operation returned no result",
          attributes: [
            "callId": callId,
            "requestId": requestId,
            "groupName": groupName,
            "toolName": toolName
          ]
        )
        self.responder?.sendToolCallError(callId: callId, error: "No result from toolkit operation")
        return
      }

      self.logger.log(
        "[ToolkitHelper] Toolkit operation result received",
        attributes: [
          "callId": callId,
          "requestId": requestId,
          "groupName": groupName,
          "toolName": toolName,
          "result_preview": String(result.prefix(1000))
        ]
      )

      // Send the result back to OpenAI
      self.responder?.sendToolCallResult(callId: callId, result: result)
    }

    // Emit event to JavaScript
    self.logger.log(
      "[ToolkitHelper] 📤 Emitting toolkit request to JavaScript",
      attributes: [
        "eventName": "onToolkitRequest",
        "requestId": requestId,
        "groupName": groupName,
        "toolName": toolName,
        "callId": callId,
        "arguments": argumentsJSON
      ]
    )

    let eventId = helper.emitToolRequest(
      eventName: "onToolkitRequest",
      requestId: requestId,
      parameters: [
        "callId": callId,
        "groupName": groupName,
        "toolName": toolName,
        "arguments": argumentsJSON
      ]
    )

    self.logger.log(
      "[ToolkitHelper] 🆔 Event emitted to JavaScript",
      attributes: [
        "requestId": requestId,
        "eventId": eventId,
        "groupName": groupName,
        "toolName": toolName,
        "arguments": argumentsJSON
      ]
    )

    // Set up timeout
    setupStringTimeout(for: requestId, errorMessage: "Toolkit operation timed out")
  }

  /// Register a callback for a string result
  /// - Parameters:
  ///   - requestId: The unique request identifier
  ///   - callback: Callback to invoke when response is received
  private func registerStringCallback(requestId: String, callback: @escaping (String?, Error?) -> Void) {
    stringCallbacks[requestId] = callback
    self.logger.log(
      "[ToolkitHelper] 🔐 Registered string callback",
      attributes: [
        "requestId": requestId,
        "pendingCallbacks": stringCallbacks.count
      ]
    )
  }

  /// Set up a timeout for a toolkit operation
  /// - Parameters:
  ///   - requestId: The unique request identifier
  ///   - errorMessage: Error message to use if timeout occurs
  private func setupStringTimeout(for requestId: String, errorMessage: String) {
    self.logger.log(
      "[ToolkitHelper] ⏱️ Scheduling timeout",
      attributes: [
        "requestId": requestId,
        "timeoutSeconds": 60
      ]
    )

    DispatchQueue.main.asyncAfter(deadline: .now() + 60.0) { [weak self] in
      guard let self = self else { return }

      // Check if callback has already been used
      let usageCount = self.callbackUsageCount[requestId] ?? 0

      if let callback = self.stringCallbacks[requestId], usageCount == 0 {
        self.logger.log(
          "[ToolkitHelper] ⏰ Request timed out",
          attributes: [
            "requestId": requestId,
            "usageCount": usageCount
          ]
        )
        let error = NSError(
          domain: "ToolkitHelper",
          code: -1,
          userInfo: [NSLocalizedDescriptionKey: errorMessage]
        )

        // Mark as used before calling callback
        self.callbackUsageCount[requestId] = 1

        callback(nil, error)
        // Don't remove the callback - keep it to track usage patterns
      } else if usageCount > 0 {
        self.logger.log(
          "[ToolkitHelper] ⏰ Timeout fired but callback already used",
          attributes: [
            "requestId": requestId,
            "usageCount": usageCount
          ]
        )
      }
    }
  }
}

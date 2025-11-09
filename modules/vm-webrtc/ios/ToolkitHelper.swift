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
        "arguments_preview": String(argumentsJSON.prefix(500))
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
        "result_length": result.count,
        "result_preview": String(result.prefix(500))
      ]
    )

    if let callback = stringCallbacks[requestId] {
      callback(result, nil)
      stringCallbacks.removeValue(forKey: requestId)
      self.logger.log(
        "[ToolkitHelper] ✅ Toolkit callback executed successfully",
        attributes: [
          "requestId": requestId,
          "result_length": result.count
        ]
      )
    } else {
      self.logger.log(
        "[ToolkitHelper] ⚠️ No callback found for requestId",
        attributes: [
          "requestId": requestId
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
    let components = fullName.split(separator: "_", maxSplits: 2, omittingEmptySubsequences: false)

    // Expected format: "group__toolName" which splits into ["group", "", "toolName"]
    // The double underscore creates an empty component in the middle
    guard components.count == 3,
          !components[0].isEmpty,
          components[1].isEmpty,  // This is the empty part from "__"
          !components[2].isEmpty else {
      return nil
    }

    let groupName = String(components[0])
    let toolName = String(components[2])

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
            "requestId": requestId
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
          "result_length": result.count,
          "result_preview": String(result.prefix(500))
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
        "callId": callId
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
        "toolName": toolName
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

      if let callback = self.stringCallbacks[requestId] {
        self.logger.log(
          "[ToolkitHelper] ⏰ Request timed out",
          attributes: [
            "requestId": requestId
          ]
        )
        let error = NSError(
          domain: "ToolkitHelper",
          code: -1,
          userInfo: [NSLocalizedDescriptionKey: errorMessage]
        )
        callback(nil, error)
        self.stringCallbacks.removeValue(forKey: requestId)
      }
    }
  }
}

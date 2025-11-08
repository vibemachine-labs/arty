import Foundation
import ExpoModulesCore

// MARK: - Protocols

/// Protocol for classes that can handle GDrive connector tool requests from OpenAI
public protocol GDriveConnectorToolDelegate: AnyObject {
  /// Handle a GDrive connector tool call from OpenAI
  /// - Parameters:
  ///   - callId: The tool call identifier
  ///   - argumentsJSON: JSON string containing the arguments
  func handleToolCall(callId: String, argumentsJSON: String)
  
  /// Request a GDrive API operation to be performed via JavaScript
  /// - Parameters:
  ///   - codeSnippet: Self-contained JavaScript code snippet that uses the Google Drive API
  ///   - completion: Callback with result or error
  func requestGDriveOperation(codeSnippet: String, completion: @escaping (String?, Error?) -> Void)
}

// MARK: - GDrive Connector Tool Manager

/// Manages GDrive connector tool calls between OpenAI WebRTC and JavaScript
/// Uses the Google Drive API
public class ToolGDriveConnector: BaseTool {
  
  // MARK: - Properties
  
  public let toolName = "gdrive_connector"
  
  private weak var module: Module?
  private weak var responder: ToolCallResponder?
  private let helper: ToolHelper
  private let logger = VmWebrtcLogging.logger
  
  // MARK: - Initialization
  
  public init(module: Module, responder: ToolCallResponder) {
    self.module = module
    self.responder = responder
    self.helper = ToolHelper(module: module)
    self.logger.log("[ToolGDriveConnector] init: toolName=\(toolName)")
  }
  
  // MARK: - Public Methods
  
  /// Handle a GDrive connector tool call from OpenAI
  /// - Parameters:
  ///   - callId: The tool call identifier
  ///   - argumentsJSON: JSON string containing the arguments
  public func handleToolCall(callId: String, argumentsJSON: String) {
    self.logger.log("[VmWebrtc] Processing GDrive connector tool call handleToolCall: callId=\(callId)")
    self.logger.log("[VmWebrtc] Raw argumentsJSON received: '\(argumentsJSON)'")
    self.logger.log("[VmWebrtc] ArgumentsJSON length: \(argumentsJSON.count)")
    
    // Parse arguments to extract self_contained_javascript_gdrive_code_snippet parameter
    guard let argsData = argumentsJSON.data(using: .utf8) else {
      self.logger.log("[VmWebrtc] Failed to convert argumentsJSON to UTF8 data")
      responder?.sendToolCallError(callId: callId, error: "Failed to convert arguments to data")
      return
    }
    
    guard let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any] else {
      self.logger.log("[VmWebrtc] Failed to parse argumentsJSON as JSON dictionary")
      self.logger.log("[VmWebrtc] Attempting to decode as raw string...")
      // If it's not valid JSON, maybe it's the raw code snippet?
      executegDriveOperation(callId: callId, codeSnippet: argumentsJSON)
      return
    }
    
    self.logger.log("[VmWebrtc] Parsed argsDict keys: \(argsDict.keys)")
    
    guard let codeSnippet = argsDict["self_contained_javascript_gdrive_code_snippet"] as? String else {
      self.logger.log("[VmWebrtc] Failed to extract 'self_contained_javascript_gdrive_code_snippet' from argsDict")
      self.logger.log("[VmWebrtc] Available keys: \(argsDict.keys)")
      responder?.sendToolCallError(callId: callId, error: "Missing parameter 'self_contained_javascript_gdrive_code_snippet'")
      return
    }
    
    executegDriveOperation(callId: callId, codeSnippet: codeSnippet)
  }
  
  /// Handle a GDrive connector response from JavaScript
  /// - Parameters:
  ///   - requestId: The unique request identifier
  ///   - result: The response string
  public func handleResponse(requestId: String, result: String) {
    self.logger.log("[ToolGDriveConnector] 📥 Received GDrive connector response from JavaScript: requestId=\(requestId), resultLen=\(result.count)")
    
    if let callback = stringCallbacks[requestId] {
      callback(result, nil)
      stringCallbacks.removeValue(forKey: requestId)
      self.logger.log("[ToolGDriveConnector] ✅ GDrive connector callback executed successfully")
    } else {
      self.logger.log("[ToolGDriveConnector] ⚠️ No callback found for requestId=\(requestId)")
    }
  }
  
  // Override the default handleResponse to handle Int (not used for GDrive connector)
  public func handleResponse(requestId: String, result: Int) {
    self.logger.log("[ToolGDriveConnector] ⚠️ Received int result, but GDrive connector expects string")
  }
  
  /// Perform a GDrive operation via JavaScript (for direct Swift-to-JS testing)
  /// - Parameters:
  ///   - codeSnippet: Self-contained JavaScript code snippet that uses the Google Drive API
  ///   - promise: Promise to resolve with result
  public func gdriveOperationFromSwift(codeSnippet: String, promise: Promise) {
    let requestId = ToolHelper.generateRequestId()
    self.logger.log("[ToolGDriveConnector] 📱 gdriveOperationFromSwift called: snippet length=\(codeSnippet.count), requestId=\(requestId)")
    
    // Register string callback
    registerStringCallback(requestId: requestId) { result, error in
      if let error = error {
        self.logger.log("[ToolGDriveConnector] ❌ GDrive connector error: \(error.localizedDescription)")
        promise.reject("E_GDRIVE_CONNECTOR_ERROR", error.localizedDescription)
      } else if let result = result {
        self.logger.log("[ToolGDriveConnector] ✅ GDrive connector success: result=\(result)")
        promise.resolve(result)
      } else {
        self.logger.log("[ToolGDriveConnector] ❌ No result received from GDrive connector")
        promise.reject("E_GDRIVE_CONNECTOR_ERROR", "No result received")
      }
    }
    
    self.logger.log("[ToolGDriveConnector] 🧭 Emitting event 'onGDriveConnectorRequest' with requestId=\(requestId)")
    // Emit event to JavaScript using helper
    let eventId = helper.emitToolRequest(
      eventName: "onGDriveConnectorRequest",
      requestId: requestId,
      parameters: ["self_contained_javascript_gdrive_code_snippet": codeSnippet]
    )
    self.logger.log("[ToolGDriveConnector] 🆔 Event emitted: requestId=\(requestId) eventId=\(eventId)")
    
    // Set up timeout
    setupStringTimeout(for: requestId, errorMessage: "GDrive connector request timed out")
  }
  
  // MARK: - Private Methods
  
  private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]
  
  private func registerStringCallback(requestId: String, callback: @escaping (String?, Error?) -> Void) {
    self.logger.log("[ToolGDriveConnector] 🔐 registerStringCallback for requestId=\(requestId)")
    stringCallbacks[requestId] = callback
  }
  
  private func setupStringTimeout(for requestId: String, errorMessage: String) {
    self.logger.log("[ToolGDriveConnector] ⏱️ Scheduling timeout for requestId=\(requestId)")
    DispatchQueue.main.asyncAfter(deadline: .now() + 60.0) { [weak self] in
      guard let self = self else { return }
      
      if let callback = self.stringCallbacks[requestId] {
        self.logger.log("[ToolGDriveConnector] Request timed out: requestId=\(requestId)")
        let error = NSError(domain: "ToolGDriveConnector", code: -1, userInfo: [
          NSLocalizedDescriptionKey: errorMessage
        ])
        callback(nil, error)
        self.stringCallbacks.removeValue(forKey: requestId)
      }
    }
  }
  
  private func executegDriveOperation(callId: String, codeSnippet: String) {
    self.logger.log("[VmWebrtc] Executing GDrive connector tool call: callId=\(callId) snippet length=\(codeSnippet.count)")
    self.logger.log("[VmWebrtc] 🔁 Forwarding request to JavaScript via requestGDriveOperation")
    
    // Call JavaScript GDrive connector via delegate (self)
    requestGDriveOperation(codeSnippet: codeSnippet) { result, error in
      if let error = error {
        self.logger.log("[VmWebrtc] GDrive connector request failed: callId=\(callId) error=\(error.localizedDescription)")
        self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
        return
      }
      
      guard let result = result else {
        self.logger.log("[VmWebrtc] GDrive connector returned no result: callId=\(callId)")
        self.responder?.sendToolCallError(callId: callId, error: "No result from GDrive connector")
        return
      }
      
      self.logger.log("[VmWebrtc] GDrive connector result received: callId=\(callId) snippet length=\(codeSnippet.count) result=\(result)")
      // Send the actual JSON result string to OpenAI
      self.responder?.sendToolCallResult(callId: callId, result: result)
    }
  }
}

// MARK: - GDriveConnectorToolDelegate Implementation

extension ToolGDriveConnector: GDriveConnectorToolDelegate {
  
  /// Request a GDrive operation to be performed via JavaScript (for OpenAI tool calls)
  /// - Parameters:
  ///   - codeSnippet: Self-contained JavaScript code snippet that uses the Google Drive API
  ///   - completion: Callback with result or error
  public func requestGDriveOperation(codeSnippet: String, completion: @escaping (String?, Error?) -> Void) {
    let requestId = ToolHelper.generateRequestId()
    self.logger.log("[ToolGDriveConnector] 🤖 OpenAI tool call requesting GDrive operation: snippet length=\(codeSnippet.count), requestId=\(requestId)")
    
    // Register string callback
    registerStringCallback(requestId: requestId, callback: completion)
    
    // Emit event to JavaScript using helper
    self.logger.log("[ToolGDriveConnector] 📤 Emitting GDrive connector request to JavaScript")
    let eventId = helper.emitToolRequest(
      eventName: "onGDriveConnectorRequest",
      requestId: requestId,
      parameters: ["self_contained_javascript_gdrive_code_snippet": codeSnippet]
    )
    self.logger.log("[ToolGDriveConnector] 🆔 Event emitted for OpenAI tool call: requestId=\(requestId) eventId=\(eventId)")
    
    // Set up timeout
    setupStringTimeout(for: requestId, errorMessage: "GDrive connector request timed out")
  }
}

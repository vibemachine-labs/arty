import Foundation
import ExpoModulesCore

// MARK: - Protocols

/// Protocol for classes that can handle github connector tool requests from OpenAI
public protocol GithubConnectorToolDelegate: AnyObject {
  /// Handle a github connector tool call from OpenAI
  /// - Parameters:
  ///   - callId: The tool call identifier
  ///   - argumentsJSON: JSON string containing the arguments
  func handleToolCall(callId: String, argumentsJSON: String)
  
  /// Request a github API operation to be performed via JavaScript
  /// - Parameters:
  ///   - codeSnippet: Self-contained JavaScript code snippet that uses Octokit
  ///   - completion: Callback with result or error
  func requestGithubOperation(codeSnippet: String, completion: @escaping (String?, Error?) -> Void)
}

// MARK: - Github Connector Tool Manager

/// Manages github connector tool calls between OpenAI WebRTC and JavaScript
/// Uses the Github API
public class ToolGithubConnector: BaseTool {
  
  // MARK: - Properties
  
  public let toolName = "github_connector"
  
  private weak var module: Module?
  private weak var responder: ToolCallResponder?
  private let helper: ToolHelper
  
  // MARK: - Initialization
  
  public init(module: Module, responder: ToolCallResponder) {
    self.module = module
    self.responder = responder
    self.helper = ToolHelper(module: module)
  }
  
  // MARK: - Public Methods
  
  /// Handle a github connector tool call from OpenAI
  /// - Parameters:
  ///   - callId: The tool call identifier
  ///   - argumentsJSON: JSON string containing the arguments
  public func handleToolCall(callId: String, argumentsJSON: String) {
    print("[VmWebrtc] Processing github connector tool call handleToolCall: callId=\(callId)")
    print("[VmWebrtc] Raw argumentsJSON received: '\(argumentsJSON)'")
    print("[VmWebrtc] ArgumentsJSON length: \(argumentsJSON.count)")
    
    // Parse arguments to extract self_contained_javascript_octokit_code_snippet parameter
    guard let argsData = argumentsJSON.data(using: .utf8) else {
      print("[VmWebrtc] Failed to convert argumentsJSON to UTF8 data")
      responder?.sendToolCallError(callId: callId, error: "Failed to convert arguments to data")
      return
    }
    
    guard let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any] else {
      print("[VmWebrtc] Failed to parse argumentsJSON as JSON dictionary")
      print("[VmWebrtc] Attempting to decode as raw string...")
      
      // If it's not valid JSON, maybe it's the raw code snippet?
      // Try using it directly as the code snippet
      executeGithubOperation(callId: callId, codeSnippet: argumentsJSON)
      return
    }
    
    print("[VmWebrtc] Parsed argsDict keys: \(argsDict.keys)")
    
    guard let codeSnippet = argsDict["self_contained_javascript_octokit_code_snippet"] as? String else {
      print("[VmWebrtc] Failed to extract 'self_contained_javascript_octokit_code_snippet' from argsDict")
      print("[VmWebrtc] Available keys: \(argsDict.keys)")
      responder?.sendToolCallError(callId: callId, error: "Missing parameter 'self_contained_javascript_octokit_code_snippet'")
      return
    }
    
    executeGithubOperation(callId: callId, codeSnippet: codeSnippet)
  }
  
  /// Handle a github connector response from JavaScript
  /// - Parameters:
  ///   - requestId: The unique request identifier
  ///   - result: The response string
  public func handleResponse(requestId: String, result: String) {
    print("[ToolGithubConnector] 📥 Received github connector response from JavaScript: requestId=\(requestId), result=\(result)")
    
    if let callback = stringCallbacks[requestId] {
      callback(result, nil)
      stringCallbacks.removeValue(forKey: requestId)
      print("[ToolGithubConnector] ✅ Github connector callback executed successfully")
    } else {
      print("[ToolGithubConnector] ⚠️ No callback found for requestId=\(requestId)")
    }
  }
  
  // Override the default handleResponse to handle Int (not used for github connector)
  public func handleResponse(requestId: String, result: Int) {
    print("[ToolGithubConnector] ⚠️ Received int result, but github connector expects string")
  }
  
  /// Perform a github operation via JavaScript (for direct Swift-to-JS testing)
  /// - Parameters:
  ///   - codeSnippet: Self-contained JavaScript code snippet that uses Octokit
  ///   - promise: Promise to resolve with result
  public func githubOperationFromSwift(codeSnippet: String, promise: Promise) {
    let requestId = ToolHelper.generateRequestId()
    print("[ToolGithubConnector] 📱 githubOperationFromSwift called: snippet length=\(codeSnippet.count), requestId=\(requestId)")
    
    // Register string callback
    registerStringCallback(requestId: requestId) { result, error in
      if let error = error {
        print("[ToolGithubConnector] ❌ Github connector error: \(error.localizedDescription)")
        promise.reject("E_GITHUB_CONNECTOR_ERROR", error.localizedDescription)
      } else if let result = result {
        print("[ToolGithubConnector] ✅ Github connector success: result=\(result)")
        promise.resolve(result)
      } else {
        print("[ToolGithubConnector] ❌ No result received from github connector")
        promise.reject("E_GITHUB_CONNECTOR_ERROR", "No result received")
      }
    }
    
    // Emit event to JavaScript using helper
    print("[ToolGithubConnector] 📤 Emitting onGithubConnectorRequest event to JavaScript")
    helper.emitToolRequest(
      eventName: "onGithubConnectorRequest",
      requestId: requestId,
      parameters: ["self_contained_javascript_octokit_code_snippet": codeSnippet]
    )
    
    // Set up timeout
    setupStringTimeout(for: requestId, errorMessage: "Github connector request timed out")
  }
  
  // MARK: - Private Methods
  
  private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]
  
  private func registerStringCallback(requestId: String, callback: @escaping (String?, Error?) -> Void) {
    stringCallbacks[requestId] = callback
  }
  
  private func setupStringTimeout(for requestId: String, errorMessage: String) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 60.0) { [weak self] in
      guard let self = self else { return }
      
      if let callback = self.stringCallbacks[requestId] {
        print("[ToolGithubConnector] Request timed out: requestId=\(requestId)")
        let error = NSError(domain: "ToolGithubConnector", code: -1, userInfo: [
          NSLocalizedDescriptionKey: errorMessage
        ])
        callback(nil, error)
        self.stringCallbacks.removeValue(forKey: requestId)
      }
    }
  }
  
  private func executeGithubOperation(callId: String, codeSnippet: String) {
    print("[VmWebrtc] Executing github connector tool call: callId=\(callId) snippet length=\(codeSnippet.count)")
    
    // Call JavaScript github connector via delegate (self)
    requestGithubOperation(codeSnippet: codeSnippet) { result, error in
      if let error = error {
        print("[VmWebrtc] Github connector request failed: callId=\(callId) error=\(error.localizedDescription)")
        self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
        return
      }
      
      guard let result = result else {
        print("[VmWebrtc] Github connector returned no result: callId=\(callId)")
        self.responder?.sendToolCallError(callId: callId, error: "No result from github connector")
        return
      }
      
      print("[VmWebrtc] Github connector result received: callId=\(callId) snippet length=\(codeSnippet.count) result=\(result)")
      // Send the actual JSON result string to OpenAI
      self.responder?.sendToolCallResult(callId: callId, result: result)
    }
  }
}

// MARK: - GithubConnectorToolDelegate Implementation

extension ToolGithubConnector: GithubConnectorToolDelegate {
  
  /// Request a github operation to be performed via JavaScript (for OpenAI tool calls)
  /// - Parameters:
  ///   - codeSnippet: Self-contained JavaScript code snippet that uses Octokit
  ///   - completion: Callback with result or error
  public func requestGithubOperation(codeSnippet: String, completion: @escaping (String?, Error?) -> Void) {
    let requestId = ToolHelper.generateRequestId()
    print("[ToolGithubConnector] 🤖 OpenAI tool call requesting github operation: snippet length=\(codeSnippet.count), requestId=\(requestId)")
    
    // Register string callback
    registerStringCallback(requestId: requestId, callback: completion)
    
    // Emit event to JavaScript using helper
    print("[ToolGithubConnector] 📤 Emitting github connector request to JavaScript")
    helper.emitToolRequest(
      eventName: "onGithubConnectorRequest",
      requestId: requestId,
      parameters: ["self_contained_javascript_octokit_code_snippet": codeSnippet]
    )
    
    // Set up timeout
    setupStringTimeout(for: requestId, errorMessage: "Github connector request timed out")
  }
}

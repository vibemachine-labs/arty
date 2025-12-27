import ExpoModulesCore
import Foundation

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
    func requestGithubOperation(
        codeSnippet: String, completion: @escaping (String?, Error?) -> Void)
}

// MARK: - Github Connector Tool Manager (Legacy Codegen)

/// **Legacy Codegen Tool** - Manages GitHub connector tool calls between OpenAI WebRTC and JavaScript.
///
/// This is the **legacy codegen-based** GitHub tool where the AI generates self-contained JavaScript
/// code snippets that are executed by the JavaScript runtime using Octokit to interact with the GitHub API.
///
/// The AI provides a `self_contained_javascript_octokit_code_snippet` parameter containing executable
/// JavaScript code, which is then forwarded to the JS side for execution.
///
/// - Note: This is distinct from the **Gen2 toolkit** approach (see `ToolkitHelper`) which uses
///   structured tool definitions with a mux/demux pattern. The Gen2 toolkit is the preferred approach
///   for new tools.
///
/// - SeeAlso: `ToolkitHelper` for the Gen2 toolkit-based tools
/// - SeeAlso: `ToolGDriveConnector` for the similar legacy codegen tool for Google Drive
public class ToolGithubConnector: BaseTool {

    // MARK: - Properties

    public let toolName = "github_connector"

    private weak var module: Module?
    private weak var responder: ToolCallResponder?
    private let helper: ToolHelper
    private let logger = VmWebrtcLogging.logger

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
        self.logger.log(
            "Processing github connector tool call handleToolCall",
            attributes: [
                "callId": callId,
                "arguments_length": argumentsJSON.count,
                "arguments_preview": String(argumentsJSON.prefix(1000)),
            ])

        // Parse arguments to extract self_contained_javascript_octokit_code_snippet parameter
        guard let argsData = argumentsJSON.data(using: .utf8) else {
            self.logger.log("Failed to convert argumentsJSON to UTF8 data")
            responder?.sendToolCallError(
                callId: callId, error: "Failed to convert arguments to data")
            return
        }

        guard let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any]
        else {
            self.logger.log("Failed to parse argumentsJSON as JSON dictionary")
            self.logger.log("Attempting to decode as raw string...")

            // If it's not valid JSON, maybe it's the raw code snippet?
            // Try using it directly as the code snippet
            executeGithubOperation(callId: callId, codeSnippet: argumentsJSON)
            return
        }

        self.logger.log("Parsed argsDict keys", attributes: ["keys": Array(argsDict.keys)])

        guard
            let codeSnippet = argsDict["self_contained_javascript_octokit_code_snippet"] as? String
        else {
            self.logger.log(
                "Failed to extract octokit code snippet from argsDict",
                attributes: [
                    "missing_key": "self_contained_javascript_octokit_code_snippet",
                    "available_keys": Array(argsDict.keys),
                ])
            responder?.sendToolCallError(
                callId: callId,
                error: "Missing parameter 'self_contained_javascript_octokit_code_snippet'")
            return
        }

        executeGithubOperation(callId: callId, codeSnippet: codeSnippet)
    }

    /// Handle a github connector response from JavaScript
    /// - Parameters:
    ///   - requestId: The unique request identifier
    ///   - result: The response string
    public func handleResponse(requestId: String, result: String) {
        self.logger.log(
            "📥 Received github connector response from JavaScript",
            attributes: [
                "requestId": requestId,
                "result_length": result.count,
                "result_preview": String(result.prefix(1000)),
            ])

        if let callback = stringCallbacks[requestId] {
            callback(result, nil)
            stringCallbacks.removeValue(forKey: requestId)
            self.logger.log(
                "✅ Github connector callback executed successfully",
                attributes: [
                    "requestId": requestId,
                    "result_length": result.count,
                ])
        } else {
            self.logger.log(
                "⚠️ No callback found for requestId", attributes: ["requestId": requestId])
        }
    }

    // Override the default handleResponse to handle Int (not used for github connector)
    public func handleResponse(requestId: String, result: Int) {
        self.logger.log("⚠️ Received int result, but github connector expects string")
    }

    /// Perform a github operation via JavaScript (for direct Swift-to-JS testing)
    /// - Parameters:
    ///   - codeSnippet: Self-contained JavaScript code snippet that uses Octokit
    ///   - promise: Promise to resolve with result
    public func githubOperationFromSwift(codeSnippet: String, promise: Promise) {
        let requestId = ToolHelper.generateRequestId()
        self.logger.log(
            "📱 githubOperationFromSwift called",
            attributes: [
                "snippet_length": codeSnippet.count,
                "requestId": requestId,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ])

        // Register string callback
        registerStringCallback(requestId: requestId) { result, error in
            if let error = error {
                self.logger.log(
                    "❌ Github connector error", attributes: ["error": error.localizedDescription])
                promise.reject("E_GITHUB_CONNECTOR_ERROR", error.localizedDescription)
            } else if let result = result {
                self.logger.log(
                    "✅ Github connector success",
                    attributes: [
                        "result_length": result.count,
                        "result_preview": String(result.prefix(1000)),
                    ])
                promise.resolve(result)
            } else {
                self.logger.log("❌ No result received from github connector")
                promise.reject("E_GITHUB_CONNECTOR_ERROR", "No result received")
            }
        }

        // Emit event to JavaScript using helper
        self.logger.log(
            "📤 Emitting onGithubConnectorRequest event to JavaScript",
            attributes: [
                "requestId": requestId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ])
        let eventId = helper.emitToolRequest(
            eventName: "onGithubConnectorRequest",
            requestId: requestId,
            parameters: ["self_contained_javascript_octokit_code_snippet": codeSnippet]
        )
        self.logger.log(
            "🆔 Event emitted",
            attributes: [
                "requestId": requestId,
                "eventId": eventId,
                "snippet_length": codeSnippet.count,
            ])

        // NOTE: Timeout disabled - it doesn't cancel the actual work and causes confusing UX
        // when the operation eventually succeeds after we've already reported failure.
    }

    // MARK: - Private Methods

    private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]

    private func registerStringCallback(
        requestId: String, callback: @escaping (String?, Error?) -> Void
    ) {
        stringCallbacks[requestId] = callback
        self.logger.log(
            "registerStringCallback",
            attributes: [
                "requestId": requestId,
                "pendingCallbacks": stringCallbacks.count,
            ])
    }

    private func executeGithubOperation(callId: String, codeSnippet: String) {
        self.logger.log(
            "Executing github connector tool call",
            attributes: [
                "callId": callId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ])

        // Call JavaScript github connector via delegate (self)
        requestGithubOperation(codeSnippet: codeSnippet) { result, error in
            if let error = error {
                self.logger.log(
                    "Github connector request failed",
                    attributes: [
                        "callId": callId,
                        "error": error.localizedDescription,
                    ])
                self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
                return
            }

            guard let result = result else {
                self.logger.log(
                    "Github connector returned no result", attributes: ["callId": callId])
                self.responder?.sendToolCallError(
                    callId: callId, error: "No result from github connector")
                return
            }

            self.logger.log(
                "Github connector result received",
                attributes: [
                    "callId": callId,
                    "snippet_length": codeSnippet.count,
                    "result_length": result.count,
                    "result_preview": String(result.prefix(1000)),
                ])
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
    public func requestGithubOperation(
        codeSnippet: String, completion: @escaping (String?, Error?) -> Void
    ) {
        let requestId = ToolHelper.generateRequestId()
        self.logger.log(
            "🤖 OpenAI tool call requesting github operation",
            attributes: [
                "snippet_length": codeSnippet.count,
                "requestId": requestId,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ])

        // Register string callback
        registerStringCallback(requestId: requestId, callback: completion)

        // Emit event to JavaScript using helper
        self.logger.log("📤 Emitting github connector request to JavaScript")
        let eventId = helper.emitToolRequest(
            eventName: "onGithubConnectorRequest",
            requestId: requestId,
            parameters: ["self_contained_javascript_octokit_code_snippet": codeSnippet]
        )
        self.logger.log(
            "🆔 Event emitted for OpenAI tool call",
            attributes: [
                "requestId": requestId,
                "eventId": eventId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ])

        // NOTE: Timeout disabled - it doesn't cancel the actual work and causes confusing UX
        // when the operation eventually succeeds after we've already reported failure.
    }
}

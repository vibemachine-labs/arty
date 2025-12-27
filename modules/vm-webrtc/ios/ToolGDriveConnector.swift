import ExpoModulesCore
import Foundation

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
    func requestGDriveOperation(
        codeSnippet: String, completion: @escaping (String?, Error?) -> Void)
}

// MARK: - GDrive Connector Tool Manager (Legacy Codegen)

/// **Legacy Codegen Tool** - Manages GDrive connector tool calls between OpenAI WebRTC and JavaScript.
///
/// This is the **legacy codegen-based** GDrive tool where the AI generates self-contained JavaScript
/// code snippets that are executed by the JavaScript runtime to interact with the Google Drive API.
///
/// The AI provides a `self_contained_javascript_gdrive_code_snippet` parameter containing executable
/// JavaScript code, which is then forwarded to the JS side for execution.
///
/// - Note: This is distinct from the **Gen2 toolkit** approach (see `ToolkitHelper`) which uses
///   structured tool definitions with a mux/demux pattern. The Gen2 toolkit is the preferred approach
///   for new tools.
///
/// - SeeAlso: `ToolkitHelper` for the Gen2 toolkit-based tools
/// - SeeAlso: `ToolGPT5GDriveFixer` for the GPT-5 based fixer tool that repairs broken codegen snippets
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
        self.logger.log(
            "[VmWebrtc] Processing GDrive connector tool call",
            attributes: [
                "callId": callId,
                "arguments_length": argumentsJSON.count,
                "arguments_preview": String(argumentsJSON.prefix(1000)),
            ]
        )

        // Parse arguments to extract self_contained_javascript_gdrive_code_snippet parameter
        guard let argsData = argumentsJSON.data(using: .utf8) else {
            self.logger.log(
                "[VmWebrtc] Failed to convert argumentsJSON to UTF8 data",
                attributes: [
                    "callId": callId
                ])
            responder?.sendToolCallError(
                callId: callId, error: "Failed to convert arguments to data")
            return
        }

        guard let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any]
        else {
            self.logger.log(
                "[VmWebrtc] Failed to parse argumentsJSON as JSON dictionary",
                attributes: [
                    "callId": callId
                ])
            self.logger.log(
                "[VmWebrtc] Attempting to decode as raw string...",
                attributes: [
                    "callId": callId
                ])
            // If it's not valid JSON, maybe it's the raw code snippet?
            executegDriveOperation(callId: callId, codeSnippet: argumentsJSON)
            return
        }

        self.logger.log(
            "[VmWebrtc] Parsed GDrive argument keys",
            attributes: [
                "keys": Array(argsDict.keys),
                "callId": callId,
            ]
        )

        guard let codeSnippet = argsDict["self_contained_javascript_gdrive_code_snippet"] as? String
        else {
            self.logger.log(
                "[VmWebrtc] Failed to extract required GDrive code snippet",
                attributes: [
                    "missing_key": "self_contained_javascript_gdrive_code_snippet",
                    "available_keys": Array(argsDict.keys),
                    "callId": callId,
                ]
            )
            responder?.sendToolCallError(
                callId: callId,
                error: "Missing parameter 'self_contained_javascript_gdrive_code_snippet'")
            return
        }

        executegDriveOperation(callId: callId, codeSnippet: codeSnippet)
    }

    /// Handle a GDrive connector response from JavaScript
    /// - Parameters:
    ///   - requestId: The unique request identifier
    ///   - result: The response string
    public func handleResponse(requestId: String, result: String) {
        self.logger.log(
            "[ToolGDriveConnector] 📥 Received GDrive connector response from JavaScript",
            attributes: [
                "requestId": requestId,
                "result_length": result.count,
                "result_preview": String(result.prefix(1000)),
            ]
        )

        // Retrieve and remove callback on queue, then invoke outside queue to avoid deadlocks
        let callback = stringCallbacksQueue.sync { () -> ((String?, Error?) -> Void)? in
            guard let cb = stringCallbacks[requestId] else { return nil }
            stringCallbacks.removeValue(forKey: requestId)
            return cb
        }

        if let callback = callback {
            callback(result, nil)
            self.logger.log(
                "[ToolGDriveConnector] ✅ GDrive connector callback executed successfully",
                attributes: [
                    "requestId": requestId,
                    "result_length": result.count,
                ]
            )
        } else {
            self.logger.log(
                "[ToolGDriveConnector] ⚠️ No callback found",
                attributes: [
                    "requestId": requestId
                ])
        }
    }

    // Override the default handleResponse to handle Int (not used for GDrive connector)
    public func handleResponse(requestId: String, result: Int) {
        self.logger.log(
            "[ToolGDriveConnector] ⚠️ Received int result, but GDrive connector expects string")
    }

    /// Perform a GDrive operation via JavaScript (for direct Swift-to-JS testing)
    /// - Parameters:
    ///   - codeSnippet: Self-contained JavaScript code snippet that uses the Google Drive API
    ///   - promise: Promise to resolve with result
    public func gdriveOperationFromSwift(codeSnippet: String, promise: Promise) {
        let requestId = ToolHelper.generateRequestId()
        self.logger.log(
            "[ToolGDriveConnector] 📱 gdriveOperationFromSwift invoked",
            attributes: [
                "requestId": requestId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ]
        )

        // Register string callback (capture self weakly to avoid retain cycle)
        registerStringCallback(requestId: requestId) { [weak self] result, error in
            guard let self = self else {
                // Self was deallocated, reject the promise to avoid hanging
                promise.reject("E_GDRIVE_CONNECTOR_ERROR", "GDrive connector was deallocated")
                return
            }
            if let error = error {
                self.logger.log(
                    "[ToolGDriveConnector] ❌ GDrive connector error: \(error.localizedDescription)")
                promise.reject("E_GDRIVE_CONNECTOR_ERROR", error.localizedDescription)
            } else if let result = result {
                self.logger.log(
                    "[ToolGDriveConnector] ✅ GDrive connector success: result=\(result)")
                promise.resolve(result)
            } else {
                self.logger.log("[ToolGDriveConnector] ❌ No result received from GDrive connector")
                promise.reject("E_GDRIVE_CONNECTOR_ERROR", "No result received")
            }
        }

        self.logger.log(
            "[ToolGDriveConnector] 🧭 Emitting event to JavaScript",
            attributes: [
                "eventName": "onGDriveConnectorRequest",
                "requestId": requestId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ]
        )
        // Emit event to JavaScript using helper
        let eventId = helper.emitToolRequest(
            eventName: "onGDriveConnectorRequest",
            requestId: requestId,
            parameters: ["self_contained_javascript_gdrive_code_snippet": codeSnippet]
        )
        self.logger.log(
            "[ToolGDriveConnector] 🆔 Event emitted",
            attributes: [
                "requestId": requestId,
                "eventId": eventId,
            ]
        )

        // NOTE: Timeout disabled - it doesn't cancel the actual work and causes confusing UX
        // when the operation eventually succeeds after we've already reported failure.
    }

    // MARK: - Private Methods

    private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]
    private let stringCallbacksQueue = DispatchQueue(
        label: "com.arty.ToolGDriveConnector.stringCallbacks")

    private func registerStringCallback(
        requestId: String, callback: @escaping (String?, Error?) -> Void
    ) {
        let count = stringCallbacksQueue.sync { () -> Int in
            stringCallbacks[requestId] = callback
            return stringCallbacks.count
        }
        self.logger.log(
            "[ToolGDriveConnector] 🔐 registerStringCallback",
            attributes: [
                "requestId": requestId,
                "pendingCallbacks": count,
            ]
        )
    }

    private func executegDriveOperation(callId: String, codeSnippet: String) {
        self.logger.log(
            "[VmWebrtc] Executing GDrive connector tool call",
            attributes: [
                "callId": callId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ]
        )
        self.logger.log(
            "[VmWebrtc] Forwarding request to JavaScript",
            attributes: [
                "callId": callId
            ]
        )

        // Call JavaScript GDrive connector via delegate (self)
        // Capture self weakly to avoid retain cycle
        requestGDriveOperation(codeSnippet: codeSnippet) { [weak self] result, error in
            guard let self = self else { return }

            if let error = error {
                self.logger.log(
                    "[VmWebrtc] GDrive connector request failed",
                    attributes: [
                        "callId": callId,
                        "error": error.localizedDescription,
                    ]
                )
                self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
                return
            }

            guard let result = result else {
                self.logger.log(
                    "[VmWebrtc] GDrive connector returned no result",
                    attributes: [
                        "callId": callId
                    ]
                )
                self.responder?.sendToolCallError(
                    callId: callId, error: "No result from GDrive connector")
                return
            }

            self.logger.log(
                "[VmWebrtc] GDrive connector result received",
                attributes: [
                    "callId": callId,
                    "snippet_length": codeSnippet.count,
                    "result_length": result.count,
                    "result_preview": String(result.prefix(1000)),
                ]
            )
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
    public func requestGDriveOperation(
        codeSnippet: String, completion: @escaping (String?, Error?) -> Void
    ) {
        let requestId = ToolHelper.generateRequestId()
        self.logger.log(
            "[ToolGDriveConnector] 🤖 OpenAI tool call requesting GDrive operation",
            attributes: [
                "requestId": requestId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ]
        )

        // Register string callback
        registerStringCallback(requestId: requestId, callback: completion)

        // Emit event to JavaScript using helper
        self.logger.log(
            "[ToolGDriveConnector] 📤 Emitting GDrive connector request to JavaScript",
            attributes: [
                "eventName": "onGDriveConnectorRequest",
                "requestId": requestId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ]
        )
        let eventId = helper.emitToolRequest(
            eventName: "onGDriveConnectorRequest",
            requestId: requestId,
            parameters: ["self_contained_javascript_gdrive_code_snippet": codeSnippet]
        )
        self.logger.log(
            "[ToolGDriveConnector] 🆔 Event emitted for OpenAI tool call",
            attributes: [
                "requestId": requestId,
                "eventId": eventId,
                "snippet_length": codeSnippet.count,
                "snippet_preview": String(codeSnippet.prefix(1000)),
            ]
        )

        // NOTE: Timeout disabled - it doesn't cancel the actual work and causes confusing UX
        // when the operation eventually succeeds after we've already reported failure.
    }
}

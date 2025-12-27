import ExpoModulesCore
import Foundation

// MARK: - GPT-5 Web Search Tool (Standalone Structured Tool)

/// **Standalone Structured Tool** - Uses GPT-5 to perform web searches and return results.
///
/// This is a **standalone tool with structured parameters** - it is neither a legacy codegen tool
/// nor a Gen2 toolkit tool. It accepts a simple `query` parameter and delegates the web search
/// to the JavaScript side, which performs the actual search and returns formatted results.
///
/// Unlike the legacy codegen tools (`ToolGDriveConnector`, `ToolGithubConnector`) which require
/// the AI to generate executable JavaScript code, this tool uses a simple structured interface
/// where the AI only provides the search query.
///
/// Parameters:
/// - `query`: The search query string
///
/// - Note: This tool pattern (structured parameters delegated to JS) is simpler than legacy codegen
///   but predates the Gen2 toolkit. For new tools, consider using the **Gen2 toolkit** approach
///   (see `ToolkitHelper`) which provides a unified mux/demux pattern for all toolkit-based tools.
///
/// - SeeAlso: `ToolkitHelper` for the Gen2 toolkit-based tools
/// - SeeAlso: `ToolGDriveConnector` for an example of legacy codegen tools
public class ToolGPT5WebSearch: BaseTool {
    public let toolName = "GPT5-web-search"

    private weak var module: Module?
    private weak var responder: ToolCallResponder?
    private let helper: ToolHelper
    private let logger = VmWebrtcLogging.logger

    private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]
    private let stringCallbacksQueue = DispatchQueue(
        label: "com.arty.ToolGPT5WebSearch.stringCallbacks")
    private let eventName = "onGPT5WebSearchRequest"
    private let requestTimeout: TimeInterval = 45.0

    public init(module: Module, responder: ToolCallResponder) {
        self.module = module
        self.responder = responder
        self.helper = ToolHelper(module: module, timeoutDuration: requestTimeout)
        self.logger.log("[ToolGPT5WebSearch] init: toolName=\(toolName)")
    }

    public func handleToolCall(callId: String, argumentsJSON: String) {
        self.logger.log("[ToolGPT5WebSearch] handleToolCall: callId=\(callId)")

        guard
            let argsData = argumentsJSON.data(using: .utf8),
            let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any]
        else {
            self.logger.log("[ToolGPT5WebSearch] Failed to decode JSON arguments")
            responder?.sendToolCallError(
                callId: callId, error: "Invalid arguments for GPT5-web-search")
            return
        }

        guard let rawQuery = argsDict["query"] as? String else {
            self.logger.log("[ToolGPT5WebSearch] Missing 'query' parameter in arguments")
            responder?.sendToolCallError(callId: callId, error: "Missing parameter 'query'")
            return
        }

        requestWebSearch(query: rawQuery) { [weak self] result, error in
            guard let self = self else { return }

            if let error = error {
                self.logger.log(
                    "[ToolGPT5WebSearch] ❌ Web search operation error",
                    attributes: ["error": error.localizedDescription]
                )
                self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
                return
            }

            guard let result = result else {
                self.logger.log("[ToolGPT5WebSearch] ❌ Web search returned no result")
                self.responder?.sendToolCallError(
                    callId: callId, error: "No result from GPT5-web-search")
                return
            }

            let preview = String(result.prefix(180))
            self.logger.log(
                "[ToolGPT5WebSearch] ✅ Web search succeeded; returning payload (length=\(result.count)) preview=\(preview)"
            )
            self.responder?.sendToolCallResult(callId: callId, result: result)
        }
    }

    public func handleResponse(requestId: String, result: String) {
        self.logger.log(
            "[ToolGPT5WebSearch] 📥 Received response from JavaScript: requestId=\(requestId), len=\(result.count)"
        )

        // Retrieve and remove callback on queue, then invoke outside queue to avoid deadlocks
        let callback = stringCallbacksQueue.sync { () -> ((String?, Error?) -> Void)? in
            guard let cb = stringCallbacks[requestId] else { return nil }
            stringCallbacks.removeValue(forKey: requestId)
            return cb
        }

        if let callback = callback {
            callback(result, nil)
            self.logger.log("[ToolGPT5WebSearch] ✅ Callback executed for requestId=\(requestId)")
        } else {
            self.logger.log(
                "[ToolGPT5WebSearch] ⚠️ No callback registered for requestId=\(requestId)")
        }
    }

    public func handleResponse(requestId: String, result: Int) {
        self.logger.log(
            "[ToolGPT5WebSearch] ⚠️ Received int result, but GPT5 web search expects string payloads"
        )
    }

    private func registerStringCallback(
        requestId: String, callback: @escaping (String?, Error?) -> Void
    ) {
        self.logger.log("[ToolGPT5WebSearch] 🔐 registerStringCallback requestId=\(requestId)")
        stringCallbacksQueue.sync {
            stringCallbacks[requestId] = callback
        }
    }

    private func requestWebSearch(query: String, completion: @escaping (String?, Error?) -> Void) {
        let requestId = ToolHelper.generateRequestId()
        self.logger.log(
            "[ToolGPT5WebSearch] 🤖 OpenAI tool call requesting web search: requestId=\(requestId)")

        registerStringCallback(requestId: requestId, callback: completion)

        let eventId = helper.emitToolRequest(
            eventName: eventName,
            requestId: requestId,
            parameters: ["query": query]
        )
        self.logger.log(
            "[ToolGPT5WebSearch] 🆔 Event emitted: requestId=\(requestId) eventId=\(eventId)")

        // NOTE: Timeout disabled - it doesn't cancel the actual work and causes confusing UX
        // when the operation eventually succeeds after we've already reported failure.
    }

    public func gpt5WebSearchOperationFromSwift(query: String, promise: Promise) {
        let requestId = ToolHelper.generateRequestId()
        self.logger.log(
            "[ToolGPT5WebSearch] 📱 gpt5WebSearchOperationFromSwift called: requestId=\(requestId)")

        // Capture self weakly to avoid retain cycle
        registerStringCallback(requestId: requestId) { [weak self] result, error in
            guard let self = self else {
                // Self was deallocated, reject the promise to avoid hanging
                promise.reject("E_GPT5_WEB_SEARCH_ERROR", "Web search was deallocated")
                return
            }
            if let error = error {
                self.logger.log(
                    "[ToolGPT5WebSearch] ❌ web search error: \(error.localizedDescription)")
                promise.reject("E_GPT5_WEB_SEARCH_ERROR", error.localizedDescription)
            } else if let result = result {
                self.logger.log("[ToolGPT5WebSearch] ✅ web search success")
                promise.resolve(result)
            } else {
                self.logger.log("[ToolGPT5WebSearch] ❌ No result received from web search")
                promise.reject("E_GPT5_WEB_SEARCH_ERROR", "No result received")
            }
        }

        let eventId = helper.emitToolRequest(
            eventName: eventName,
            requestId: requestId,
            parameters: ["query": query]
        )
        self.logger.log(
            "[ToolGPT5WebSearch] 🆔 Event emitted (Swift bridge): requestId=\(requestId) eventId=\(eventId)"
        )

        // NOTE: Timeout disabled - it doesn't cancel the actual work and causes confusing UX
        // when the operation eventually succeeds after we've already reported failure.
    }
}

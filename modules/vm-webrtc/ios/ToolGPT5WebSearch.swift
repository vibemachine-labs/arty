import ExpoModulesCore
import Foundation

public class ToolGPT5WebSearch: BaseTool {
  public let toolName = "GPT5-web-search"

  private weak var module: Module?
  private weak var responder: ToolCallResponder?
  private let helper: ToolHelper

  private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]
  private let eventName = "onGPT5WebSearchRequest"
  private let requestTimeout: TimeInterval = 45.0

  public init(module: Module, responder: ToolCallResponder) {
    self.module = module
    self.responder = responder
    self.helper = ToolHelper(module: module, timeoutDuration: requestTimeout)
    print("[ToolGPT5WebSearch] init: toolName=\(toolName)")
  }

  public func handleToolCall(callId: String, argumentsJSON: String) {
    print("[ToolGPT5WebSearch] handleToolCall: callId=\(callId)")

    guard
      let argsData = argumentsJSON.data(using: .utf8),
      let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any]
    else {
      print("[ToolGPT5WebSearch] Failed to decode JSON arguments")
      responder?.sendToolCallError(callId: callId, error: "Invalid arguments for GPT5-web-search")
      return
    }

    guard let rawQuery = argsDict["query"] as? String else {
      print("[ToolGPT5WebSearch] Missing 'query' parameter in arguments")
      responder?.sendToolCallError(callId: callId, error: "Missing parameter 'query'")
      return
    }

    requestWebSearch(query: rawQuery) { [weak self] result, error in
      guard let self = self else { return }

      if let error = error {
        print("[ToolGPT5WebSearch] ❌ Web search operation error:", error.localizedDescription)
        self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
        return
      }

      guard let result = result else {
        print("[ToolGPT5WebSearch] ❌ Web search returned no result")
        self.responder?.sendToolCallError(callId: callId, error: "No result from GPT5-web-search")
        return
      }

      let preview = String(result.prefix(180))
      print("[ToolGPT5WebSearch] ✅ Web search succeeded; returning payload (length=\(result.count)) preview=\(preview)")
      self.responder?.sendToolCallResult(callId: callId, result: result)
    }
  }

  public func handleResponse(requestId: String, result: String) {
    print("[ToolGPT5WebSearch] 📥 Received response from JavaScript: requestId=\(requestId), len=\(result.count)")

    if let callback = stringCallbacks[requestId] {
      callback(result, nil)
      stringCallbacks.removeValue(forKey: requestId)
      print("[ToolGPT5WebSearch] ✅ Callback executed for requestId=\(requestId)")
    } else {
      print("[ToolGPT5WebSearch] ⚠️ No callback registered for requestId=\(requestId)")
    }
  }

  public func handleResponse(requestId: String, result: Int) {
    print("[ToolGPT5WebSearch] ⚠️ Received int result, but GPT5 web search expects string payloads")
  }

  private func registerStringCallback(requestId: String, callback: @escaping (String?, Error?) -> Void) {
    print("[ToolGPT5WebSearch] 🔐 registerStringCallback requestId=\(requestId)")
    stringCallbacks[requestId] = callback
  }

  private func setupStringTimeout(for requestId: String, errorMessage: String) {
    print("[ToolGPT5WebSearch] ⏱️ Scheduling timeout for requestId=\(requestId)")
    DispatchQueue.main.asyncAfter(deadline: .now() + requestTimeout) { [weak self] in
      guard let self else { return }

      if let callback = self.stringCallbacks[requestId] {
        print("[ToolGPT5WebSearch] Request timed out: requestId=\(requestId)")
        let error = NSError(
          domain: "ToolGPT5WebSearch",
          code: -1,
          userInfo: [NSLocalizedDescriptionKey: errorMessage]
        )
        callback(nil, error)
        self.stringCallbacks.removeValue(forKey: requestId)
      }
    }
  }

  private func requestWebSearch(query: String, completion: @escaping (String?, Error?) -> Void) {
    let requestId = ToolHelper.generateRequestId()
    print("[ToolGPT5WebSearch] 🤖 OpenAI tool call requesting web search: requestId=\(requestId)")

    registerStringCallback(requestId: requestId, callback: completion)

    helper.emitToolRequest(
      eventName: eventName,
      requestId: requestId,
      parameters: ["query": query]
    )

    setupStringTimeout(for: requestId, errorMessage: "GPT5 web search request timed out")
  }

  public func gpt5WebSearchOperationFromSwift(query: String, promise: Promise) {
    let requestId = ToolHelper.generateRequestId()
    print("[ToolGPT5WebSearch] 📱 gpt5WebSearchOperationFromSwift called: requestId=\(requestId)")

    registerStringCallback(requestId: requestId) { result, error in
      if let error = error {
        print("[ToolGPT5WebSearch] ❌ web search error: \(error.localizedDescription)")
        promise.reject("E_GPT5_WEB_SEARCH_ERROR", error.localizedDescription)
      } else if let result = result {
        print("[ToolGPT5WebSearch] ✅ web search success")
        promise.resolve(result)
      } else {
        print("[ToolGPT5WebSearch] ❌ No result received from web search")
        promise.reject("E_GPT5_WEB_SEARCH_ERROR", "No result received")
      }
    }

    helper.emitToolRequest(
      eventName: eventName,
      requestId: requestId,
      parameters: ["query": query]
    )

    setupStringTimeout(for: requestId, errorMessage: "GPT5 web search request timed out")
  }
}

import Foundation
import ExpoModulesCore

enum HackerNewsToolName: String, CaseIterable {
  case hackerNews_item
  case hackerNews_user
  case hackerNews_topstories
  case hackerNews_beststories
  case hackerNews_newstories
  case hackerNews_showstories
  case hackerNews_askstories
  case hackerNews_jobstories
  case hackerNews_updates
}

public class ToolHackerNews: BaseTool {
  public let toolName: String

  private weak var module: Module?
  private weak var responder: ToolCallResponder?
  private let helper: ToolHelper
  private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]

  public init(module: Module, responder: ToolCallResponder, name: HackerNewsToolName) {
    self.module = module
    self.responder = responder
    self.helper = ToolHelper(module: module, timeoutDuration: 45.0)
    self.toolName = name.rawValue
  }

  public func handleToolCall(callId: String, argumentsJSON: String) {
    guard let argsData = argumentsJSON.data(using: .utf8) else {
      responder?.sendToolCallError(callId: callId, error: "Unable to decode arguments for \(toolName)")
      return
    }

    var arguments: [String: Any] = [:]
    if let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any] {
      arguments = argsDict
    }

    requestHackerNewsOperation(arguments: arguments) { [weak self] result, error in
      guard let self else { return }

      if let error = error {
        self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
        return
      }

      guard let result = result else {
        self.responder?.sendToolCallError(callId: callId, error: "No result from Hacker News tool")
        return
      }

      self.responder?.sendToolCallResult(callId: callId, result: result)
    }
  }

  public func handleResponse(requestId: String, result: String) {
    if let callback = stringCallbacks[requestId] {
      callback(result, nil)
      stringCallbacks.removeValue(forKey: requestId)
    } else {
      print("[ToolHackerNews] No callback for requestId=\(requestId)")
    }
  }

  public func handleResponse(requestId: String, result: Int) {
    // Not used for Hacker News, but required by BaseTool
  }

  private func requestHackerNewsOperation(
    arguments: [String: Any],
    completion: @escaping (String?, Error?) -> Void
  ) {
    guard let module = module else {
      completion(nil, NSError(domain: "ToolHackerNews", code: -1, userInfo: [
        NSLocalizedDescriptionKey: "Module unavailable",
      ]))
      return
    }

    let requestId = ToolHelper.generateRequestId()
    stringCallbacks[requestId] = completion

    helper.emitToolRequest(
      eventName: "onHackerNewsToolRequest",
      requestId: requestId,
      parameters: [
        "toolName": toolName,
        "arguments": arguments,
      ]
    )

    DispatchQueue.main.asyncAfter(deadline: .now() + 60.0) { [weak self] in
      guard let self else { return }
      if let callback = self.stringCallbacks[requestId] {
        let timeoutError = NSError(
          domain: "ToolHackerNews",
          code: -2,
          userInfo: [NSLocalizedDescriptionKey: "Hacker News tool request timed out"]
        )
        callback(nil, timeoutError)
        self.stringCallbacks.removeValue(forKey: requestId)
      }
    }
  }
}

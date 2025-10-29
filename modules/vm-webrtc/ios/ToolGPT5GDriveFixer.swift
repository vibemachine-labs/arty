import ExpoModulesCore
import Foundation

public class ToolGPT5GDriveFixer: BaseTool {
  public let toolName = "GPT5-gdrive-fixer"

  private weak var module: Module?
  private weak var responder: ToolCallResponder?
  private let helper: ToolHelper

  private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]

  public init(module: Module, responder: ToolCallResponder) {
    self.module = module
    self.responder = responder
    self.helper = ToolHelper(module: module)
    print("[ToolGPT5GDriveFixer] init: toolName=\(toolName)")
  }

  public func handleToolCall(callId: String, argumentsJSON: String) {
    print("[ToolGPT5GDriveFixer] handleToolCall: callId=\(callId)")
    guard let argsData = argumentsJSON.data(using: .utf8),
          let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any] else {
      print("[ToolGPT5GDriveFixer] Failed to parse JSON arguments")
      responder?.sendToolCallError(callId: callId, error: "Invalid arguments for GPT5-gdrive-fixer")
      return
    }

    let taskDescription = argsDict["task_description"] as? String ?? ""
    let brokenCode = argsDict["broken_code"] as? String ?? ""
    let errorMessage = argsDict["error_message"] as? String ?? ""

    requestFixOperation(
      taskDescription: taskDescription,
      brokenCode: brokenCode,
      errorMessage: errorMessage
    ) { [weak self] result, error in
      guard let self = self else { return }

      if let error = error {
        print("[ToolGPT5GDriveFixer] ❌ Fix operation error: \(error.localizedDescription)")
        self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
        return
      }

      guard let result = result else {
        print("[ToolGPT5GDriveFixer] ❌ Fix operation returned no result")
        self.responder?.sendToolCallError(callId: callId, error: "No result from GPT5-gdrive-fixer")
        return
      }

      print("[ToolGPT5GDriveFixer] ✅ Fix operation succeeded, returning result")
      self.responder?.sendToolCallResult(callId: callId, result: result)
    }
  }

  public func handleResponse(requestId: String, result: String) {
    print("[ToolGPT5GDriveFixer] 📥 Received response from JavaScript: requestId=\(requestId), len=\(result.count)")

    if let callback = stringCallbacks[requestId] {
      callback(result, nil)
      stringCallbacks.removeValue(forKey: requestId)
      print("[ToolGPT5GDriveFixer] ✅ Callback executed for requestId=\(requestId)")
    } else {
      print("[ToolGPT5GDriveFixer] ⚠️ No callback found for requestId=\(requestId)")
    }
  }

  public func handleResponse(requestId: String, result: Int) {
    print("[ToolGPT5GDriveFixer] ⚠️ Received int result, but GPT5 fixer expects string")
  }

  private func registerStringCallback(requestId: String, callback: @escaping (String?, Error?) -> Void) {
    print("[ToolGPT5GDriveFixer] 🔐 registerStringCallback requestId=\(requestId)")
    stringCallbacks[requestId] = callback
  }

  private func setupStringTimeout(for requestId: String, errorMessage: String) {
    print("[ToolGPT5GDriveFixer] ⏱️ Scheduling timeout for requestId=\(requestId)")
    DispatchQueue.main.asyncAfter(deadline: .now() + 60.0) { [weak self] in
      guard let self = self else { return }

      if let callback = self.stringCallbacks[requestId] {
        print("[ToolGPT5GDriveFixer] Request timed out: requestId=\(requestId)")
        let error = NSError(
          domain: "ToolGPT5GDriveFixer",
          code: -1,
          userInfo: [NSLocalizedDescriptionKey: errorMessage]
        )
        callback(nil, error)
        self.stringCallbacks.removeValue(forKey: requestId)
      }
    }
  }

  private func requestFixOperation(
    taskDescription: String,
    brokenCode: String,
    errorMessage: String,
    completion: @escaping (String?, Error?) -> Void
  ) {
    let requestId = ToolHelper.generateRequestId()
    print("[ToolGPT5GDriveFixer] 🤖 OpenAI tool call requesting fix operation: requestId=\(requestId)")

    registerStringCallback(requestId: requestId, callback: completion)

    helper.emitToolRequest(
      eventName: "onGPT5GDriveFixerRequest",
      requestId: requestId,
      parameters: [
        "task_description": taskDescription,
        "broken_code": brokenCode,
        "error_message": errorMessage
      ]
    )

    setupStringTimeout(for: requestId, errorMessage: "GPT5 gdrive fixer request timed out")
  }

  public func gpt5GDriveFixerOperationFromSwift(paramsJson: String, promise: Promise) {
    let requestId = ToolHelper.generateRequestId()
    print("[ToolGPT5GDriveFixer] 📱 gpt5GDriveFixerOperationFromSwift called: requestId=\(requestId)")

    registerStringCallback(requestId: requestId) { result, error in
      if let error = error {
        print("[ToolGPT5GDriveFixer] ❌ gpt5 fixer error: \(error.localizedDescription)")
        promise.reject("E_GPT5_FIXER_ERROR", error.localizedDescription)
      } else if let result = result {
        print("[ToolGPT5GDriveFixer] ✅ gpt5 fixer success")
        promise.resolve(result)
      } else {
        print("[ToolGPT5GDriveFixer] ❌ No result received from gpt5 fixer")
        promise.reject("E_GPT5_FIXER_ERROR", "No result received")
      }
    }

    var taskDescription = ""
    var brokenCode = ""
    var errorMessage = ""

    if let data = paramsJson.data(using: .utf8),
       let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      taskDescription = dict["task_description"] as? String ?? ""
      brokenCode = dict["broken_code"] as? String ?? ""
      errorMessage = dict["error_message"] as? String ?? ""
    }

    helper.emitToolRequest(
      eventName: "onGPT5GDriveFixerRequest",
      requestId: requestId,
      parameters: [
        "task_description": taskDescription,
        "broken_code": brokenCode,
        "error_message": errorMessage
      ]
    )

    setupStringTimeout(for: requestId, errorMessage: "GPT5 gdrive fixer request timed out")
  }
}

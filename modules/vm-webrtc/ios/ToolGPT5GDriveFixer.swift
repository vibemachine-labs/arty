import ExpoModulesCore
import Foundation

public class ToolGPT5GDriveFixer: BaseTool {
    public let toolName = "GPT5-gdrive-fixer"

    private weak var module: Module?
    private weak var responder: ToolCallResponder?
    private let helper: ToolHelper
    private let logger = VmWebrtcLogging.logger

    private var stringCallbacks: [String: (String?, Error?) -> Void] = [:]
    private let stringCallbacksQueue = DispatchQueue(
        label: "com.arty.ToolGPT5GDriveFixer.stringCallbacks")

    public init(module: Module, responder: ToolCallResponder) {
        self.module = module
        self.responder = responder
        self.helper = ToolHelper(module: module)
        self.logger.log("[ToolGPT5GDriveFixer] init: toolName=\(toolName)")
    }

    public func handleToolCall(callId: String, argumentsJSON: String) {
        self.logger.log("[ToolGPT5GDriveFixer] handleToolCall: callId=\(callId)")
        guard let argsData = argumentsJSON.data(using: .utf8),
            let argsDict = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any]
        else {
            self.logger.log("[ToolGPT5GDriveFixer] Failed to parse JSON arguments")
            responder?.sendToolCallError(
                callId: callId, error: "Invalid arguments for GPT5-gdrive-fixer")
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
                self.logger.log(
                    "[ToolGPT5GDriveFixer] ❌ Fix operation error: \(error.localizedDescription)")
                self.responder?.sendToolCallError(callId: callId, error: error.localizedDescription)
                return
            }

            guard let result = result else {
                self.logger.log("[ToolGPT5GDriveFixer] ❌ Fix operation returned no result")
                self.responder?.sendToolCallError(
                    callId: callId, error: "No result from GPT5-gdrive-fixer")
                return
            }

            self.logger.log("[ToolGPT5GDriveFixer] ✅ Fix operation succeeded, returning result")
            self.responder?.sendToolCallResult(callId: callId, result: result)
        }
    }

    public func handleResponse(requestId: String, result: String) {
        self.logger.log(
            "[ToolGPT5GDriveFixer] 📥 Received response from JavaScript: requestId=\(requestId), len=\(result.count)"
        )

        // Retrieve and remove callback on queue, then invoke outside queue to avoid deadlocks
        let callback = stringCallbacksQueue.sync { () -> ((String?, Error?) -> Void)? in
            guard let cb = stringCallbacks[requestId] else { return nil }
            stringCallbacks.removeValue(forKey: requestId)
            return cb
        }

        if let callback = callback {
            callback(result, nil)
            self.logger.log("[ToolGPT5GDriveFixer] ✅ Callback executed for requestId=\(requestId)")
        } else {
            self.logger.log("[ToolGPT5GDriveFixer] ⚠️ No callback found for requestId=\(requestId)")
        }
    }

    public func handleResponse(requestId: String, result: Int) {
        self.logger.log(
            "[ToolGPT5GDriveFixer] ⚠️ Received int result, but GPT5 fixer expects string")
    }

    private func registerStringCallback(
        requestId: String, callback: @escaping (String?, Error?) -> Void
    ) {
        self.logger.log("[ToolGPT5GDriveFixer] 🔐 registerStringCallback requestId=\(requestId)")
        stringCallbacksQueue.sync {
            stringCallbacks[requestId] = callback
        }
    }

    private func requestFixOperation(
        taskDescription: String,
        brokenCode: String,
        errorMessage: String,
        completion: @escaping (String?, Error?) -> Void
    ) {
        let requestId = ToolHelper.generateRequestId()
        self.logger.log(
            "[ToolGPT5GDriveFixer] 🤖 OpenAI tool call requesting fix operation: requestId=\(requestId)"
        )

        registerStringCallback(requestId: requestId, callback: completion)

        let eventId = helper.emitToolRequest(
            eventName: "onGPT5GDriveFixerRequest",
            requestId: requestId,
            parameters: [
                "task_description": taskDescription,
                "broken_code": brokenCode,
                "error_message": errorMessage,
            ]
        )
        self.logger.log(
            "[ToolGPT5GDriveFixer] 🆔 Event emitted: requestId=\(requestId) eventId=\(eventId)")

        // NOTE: Timeout disabled - it doesn't cancel the actual work and causes confusing UX
        // when the operation eventually succeeds after we've already reported failure.
    }

    public func gpt5GDriveFixerOperationFromSwift(paramsJson: String, promise: Promise) {
        let requestId = ToolHelper.generateRequestId()
        self.logger.log(
            "[ToolGPT5GDriveFixer] 📱 gpt5GDriveFixerOperationFromSwift called: requestId=\(requestId)"
        )

        // Capture self weakly to avoid retain cycle
        registerStringCallback(requestId: requestId) { [weak self] result, error in
            guard let self = self else {
                // Self was deallocated, reject the promise to avoid hanging
                promise.reject("E_GPT5_FIXER_ERROR", "GPT5 fixer was deallocated")
                return
            }
            if let error = error {
                self.logger.log(
                    "[ToolGPT5GDriveFixer] ❌ gpt5 fixer error: \(error.localizedDescription)")
                promise.reject("E_GPT5_FIXER_ERROR", error.localizedDescription)
            } else if let result = result {
                self.logger.log("[ToolGPT5GDriveFixer] ✅ gpt5 fixer success")
                promise.resolve(result)
            } else {
                self.logger.log("[ToolGPT5GDriveFixer] ❌ No result received from gpt5 fixer")
                promise.reject("E_GPT5_FIXER_ERROR", "No result received")
            }
        }

        var taskDescription = ""
        var brokenCode = ""
        var errorMessage = ""

        if let data = paramsJson.data(using: .utf8),
            let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            taskDescription = dict["task_description"] as? String ?? ""
            brokenCode = dict["broken_code"] as? String ?? ""
            errorMessage = dict["error_message"] as? String ?? ""
        }

        let eventId = helper.emitToolRequest(
            eventName: "onGPT5GDriveFixerRequest",
            requestId: requestId,
            parameters: [
                "task_description": taskDescription,
                "broken_code": brokenCode,
                "error_message": errorMessage,
            ]
        )
        self.logger.log(
            "[ToolGPT5GDriveFixer] 🆔 Event emitted (Swift bridge): requestId=\(requestId) eventId=\(eventId)"
        )

        // NOTE: Timeout disabled - it doesn't cancel the actual work and causes confusing UX
        // when the operation eventually succeeds after we've already reported failure.
    }
}

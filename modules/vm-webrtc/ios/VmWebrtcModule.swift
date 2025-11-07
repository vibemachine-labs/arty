import ExpoModulesCore
import Foundation

struct OpenAIConnectionOptions: Record {
  @Field
  var apiKey: String

  @Field
  var model: String?

  @Field
  var baseUrl: String?

  @Field
  var audioOutput: String?

  @Field
  var instructions: String

  @Field
  var voice: String?

  @Field
  var toolDefinitions: [[String: Any]]?

  @Field
  var vadMode: String?

  @Field
  var audioSpeed: Double?

  @Field
  var enableRecording: Bool?

  @Field
  var maxConversationTurns: Int?

  @Field
  var retentionRatio: Double?
}

public class VmWebrtcModule: Module {
  private lazy var webrtcClient = OpenAIWebRTCClient()
  private var toolGithubConnector: ToolGithubConnector?
  // Add GDrive connector tool instance
  private var toolGDriveConnector: ToolGDriveConnector?
  private var toolGPT5GDriveFixer: ToolGPT5GDriveFixer?
  private var toolGPT5WebSearch: ToolGPT5WebSearch?
  private let logfireTracingManager = LogfireTracingManager()
  private lazy var logger = NativeLogger(category: "VmWebrtc", tracingManager: logfireTracingManager)

  public func helloFromExpoModule() -> String {
    return "Hello world from module"
  }

  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  public func definition() -> ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('VmWebrtc')` in JavaScript.
    Name("VmWebrtc")

    // Defines constant property on the module.
    Constant("PI") {
      Double.pi
    }

    // Defines event names that the module can send to JavaScript.
    Events(
      "onChange",
      "onGithubConnectorRequest",
      "onGithubConnectorResponse",
      // Add GDrive events
      "onGDriveConnectorRequest",
      "onGDriveConnectorResponse",
      "onGPT5GDriveFixerRequest",
      "onGPT5GDriveFixerResponse",
      "onGPT5WebSearchRequest",
      "onGPT5WebSearchResponse",
      "onIdleTimeout",
      "onTokenUsage",
      "onRealtimeError",
      "onAudioMetrics",
      "onNativeLog"
    )

    // Initialize native tool delegates used by the module
    OnCreate {
      self.logger.log("OnCreate: initializing tool delegates")
      self.webrtcClient.setEventEmitter { [weak self] eventName, payload in
        guard let self else { return }
        self.sendEvent(eventName, payload)
      }
      self.logger.log("Event emitter configured for OpenAI WebRTC client")
      self.webrtcClient.setMinimumLogLevel(.debug)
      self.logger.log("Minimum log level set to debug")
      // Initialize github connector tool
      self.toolGithubConnector = ToolGithubConnector(module: self, responder: self.webrtcClient)
      let githubInitialized = self.toolGithubConnector != nil
      self.logger.log("ToolGithubConnector initialized = \(githubInitialized)")

      // Initialize gdrive connector tool
      self.toolGDriveConnector = ToolGDriveConnector(module: self, responder: self.webrtcClient)
      let gdriveInitialized = self.toolGDriveConnector != nil
      self.logger.log("ToolGDriveConnector initialized = \(gdriveInitialized)")

      // Initialize GPT5 gdrive fixer tool
      self.toolGPT5GDriveFixer = ToolGPT5GDriveFixer(module: self, responder: self.webrtcClient)
      print("[VmWebrtc] ToolGPT5GDriveFixer initialized =", self.toolGPT5GDriveFixer != nil)

      // Initialize GPT5 web search tool
      self.toolGPT5WebSearch = ToolGPT5WebSearch(module: self, responder: self.webrtcClient)
      print("[VmWebrtc] ToolGPT5WebSearch initialized =", self.toolGPT5WebSearch != nil)

      // Wire delegates into the WebRTC client
      self.webrtcClient.setGithubConnectorDelegate(self.toolGithubConnector!)
      if let gdrive = self.toolGDriveConnector {
        self.webrtcClient.setGDriveConnectorDelegate(gdrive)
        print("[VmWebrtc] Delegate set: gdrive")
      } else {
        print("[VmWebrtc] Delegate set NOT: gdrive")
      }
      if let fixer = self.toolGPT5GDriveFixer {
        self.webrtcClient.setGPT5GDriveFixerDelegate(fixer)
        print("[VmWebrtc] Delegate set: GPT5 fixer")
      } else {
        print("[VmWebrtc] Delegate set NOT: GPT5 fixer")
      }
      if let webSearch = self.toolGPT5WebSearch {
        self.webrtcClient.setGPT5WebSearchDelegate(webSearch)
        print("[VmWebrtc] Delegate set: GPT5 web search")
      } else {
        print("[VmWebrtc] Delegate set NOT: GPT5 web search")
      }
      print("[VmWebrtc] Delegates set: github, possibly GDrive")
    }

    // Defines a JavaScript synchronous function that runs the native code on the JavaScript thread.
    Function("hello") {
      return "Hello world! 👋"
    }

    Function("helloFromExpoModule") { () -> String in
      return self.helloFromExpoModule()
    }

    // Defines a JavaScript function that always returns a Promise and whose native code
    // is by default dispatched on the different thread than the JavaScript runtime runs on.
    AsyncFunction("setValueAsync") { (value: String) in
      // Send an event to JavaScript.
      self.sendEvent("onChange", [
        "value": value
      ])
    }

    AsyncFunction("openOpenAIConnectionAsync") { (options: OpenAIConnectionOptions) -> String in
      print("[VmWebrtc] openOpenAIConnectionAsync called with model=\(options.model ?? "nil"), audioOutput=\(options.audioOutput ?? "nil"), voice=\(options.voice ?? "nil"), vadMode=\(options.vadMode ?? "nil")")
      let outputPreference = OpenAIWebRTCClient.AudioOutputPreference(
        rawValue: options.audioOutput ?? "handset"
      ) ?? .handset

      let sanitizedInstructions = options.instructions
        .trimmingCharacters(in: .whitespacesAndNewlines)

      guard !sanitizedInstructions.isEmpty else {
        throw NSError(
          domain: "VmWebrtc",
          code: 1001,
          userInfo: [
            NSLocalizedDescriptionKey: "instructions must be a non-empty string."
          ]
        )
      }

      let toolDefinitions = options.toolDefinitions ?? []
      await MainActor.run {
        self.webrtcClient.setToolDefinitions(toolDefinitions)
      }

      let state = try await self.webrtcClient.openConnection(
        apiKey: options.apiKey,
        model: options.model,
        baseURL: options.baseUrl,
        audioOutput: outputPreference,
        instructions: sanitizedInstructions,
        voice: options.voice,
        vadMode: options.vadMode,
        audioSpeed: options.audioSpeed,
        enableRecording: options.enableRecording ?? false,
        maxConversationTurns: options.maxConversationTurns,
        retentionRatio: options.retentionRatio
      )
      return state
    }

    AsyncFunction("closeOpenAIConnectionAsync") { () -> String in
      let state = await MainActor.run {
        self.webrtcClient.closeConnection()
      }
      return state
    }

    AsyncFunction("initializeLogfireTracing") { (serviceName: String, apiKey: String) in
      try await self.logfireTracingManager.initialize(serviceName: serviceName, apiKey: apiKey)
    }

    Function("logfireEvent") { (tracerName: String, spanName: String, attributes: [String: Any]?) in
      self.logfireTracingManager.recordEvent(tracerName: tracerName, spanName: spanName, attributes: attributes)
    }

    // JavaScript calls this to send github connector result back
    Function("sendGithubConnectorResponse") { (requestId: String, result: String) in
      print("[VmWebrtc] JS→Native sendGithubConnectorResponse requestId=\(requestId) resultLen=\(result.count)")
      self.toolGithubConnector?.handleResponse(requestId: requestId, result: result)
    }

    // Add: JavaScript calls this to send GDrive connector result back
    Function("sendGDriveConnectorResponse") { (requestId: String, result: String) in
      print("[VmWebrtc] JS→Native sendGDriveConnectorResponse requestId=\(requestId) resultLen=\(result.count)")
      self.toolGDriveConnector?.handleResponse(requestId: requestId, result: result)
    }

    Function("sendGPT5GDriveFixerResponse") { (requestId: String, result: String) in
      print("[VmWebrtc] JS→Native sendGPT5GDriveFixerResponse requestId=\(requestId) resultLen=\(result.count)")
      self.toolGPT5GDriveFixer?.handleResponse(requestId: requestId, result: result)
    }

    Function("sendGPT5WebSearchResponse") { (requestId: String, result: String) in
      print("[VmWebrtc] JS→Native sendGPT5WebSearchResponse requestId=\(requestId) resultLen=\(result.count)")
      self.toolGPT5WebSearch?.handleResponse(requestId: requestId, result: result)
    }

    // Github Connector function - calls JavaScript github connector via events
    AsyncFunction("githubOperationFromSwift") { (codeSnippet: String, promise: Promise) in
      print("[VmWebrtc] Swift→JS githubOperationFromSwift snippetLen=\(codeSnippet.count)")
      self.toolGithubConnector?.githubOperationFromSwift(codeSnippet: codeSnippet, promise: promise)
    }

    // GDrive bridge: call JS GDrive connector via events for Swift testing
    AsyncFunction("gdriveOperationFromSwift") { (codeSnippet: String, promise: Promise) in
      self.toolGDriveConnector?.gdriveOperationFromSwift(codeSnippet: codeSnippet, promise: promise)
    }

    AsyncFunction("gpt5GDriveFixerOperationFromSwift") { (paramsJson: String, promise: Promise) in
      self.toolGPT5GDriveFixer?.gpt5GDriveFixerOperationFromSwift(paramsJson: paramsJson, promise: promise)
    }

    AsyncFunction("gpt5WebSearchOperationFromSwift") { (query: String, promise: Promise) in
      self.toolGPT5WebSearch?.gpt5WebSearchOperationFromSwift(query: query, promise: promise)
    }

    Function("muteUnmuteOutgoingAudio") { (shouldMute: Bool) in
      Task { @MainActor in
        self.webrtcClient.setOutgoingAudioMuted(shouldMute)
      }
    }

  }
}

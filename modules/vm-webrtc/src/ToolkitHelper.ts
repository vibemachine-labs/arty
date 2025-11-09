import { log } from '../../../lib/logger';
import { type ToolNativeModule } from './ToolHelper';

// MARK: - Types

export interface ToolkitRequestEvent {
  requestId: string;
  callId: string;
  groupName: string;
  toolName: string;
  arguments: string;
  eventId?: string;
}

export interface ToolkitHelperNativeModule extends ToolNativeModule {
  sendToolkitResponse(requestId: string, result: string): void;
}

// MARK: - Toolkit Helper Manager

/**
 * Manages Gen2 toolkit tool calls between JavaScript and native Swift code.
 * Uses a mux/demux approach to handle all toolkit tools through a single delegate.
 */
export class ToolkitHelper {
  private readonly toolName = 'ToolkitHelper';
  private readonly requestEventName = 'onToolkitRequest';
  private readonly module: ToolkitHelperNativeModule | null;

  constructor(nativeModule: ToolkitHelperNativeModule | null) {
    this.module = nativeModule;

    if (this.module) {
      this.module.addListener(this.requestEventName, this.handleRequest.bind(this));
      log.info('[ToolkitHelper] Initialized with native module', {}, { eventName: this.requestEventName });
    } else {
      log.warn('[ToolkitHelper] Native module unavailable', {});
    }
  }

  // MARK: - Private Methods

  /**
   * Handle a toolkit request from Swift.
   */
  private async handleRequest(event: ToolkitRequestEvent) {
    const { requestId, callId, groupName, toolName, arguments: argumentsJSON, eventId } = event;
    log.info(`[${this.toolName}] 📥 Received toolkit request from Swift`, {}, {
      requestId,
      callId,
      groupName,
      toolName,
      eventId,
      argumentsLength: argumentsJSON?.length || 0,
    });

    try {
      // Parse arguments
      let args: any = {};
      if (argumentsJSON) {
        try {
          args = JSON.parse(argumentsJSON);
        } catch (parseError) {
          log.warn(`[${this.toolName}] Failed to parse arguments JSON`, {}, {
            requestId,
            argumentsJSON,
            error: parseError instanceof Error ? parseError.message : String(parseError),
          });
        }
      }

      // Execute the toolkit operation (stubbed for now)
      const result = await this.executeToolkitOperation(groupName, toolName, args, { requestId, callId, eventId });

      log.info(`[${this.toolName}] ✅ Toolkit operation completed`, {}, {
        requestId,
        callId,
        groupName,
        toolName,
        resultLength: String(result).length,
      });

      if (this.module) {
        this.module.sendToolkitResponse(requestId, result);
        log.info(`[${this.toolName}] 📤 Sent response to Swift`, {}, {
          requestId,
          callId,
          responseLength: String(result).length,
        });
      } else {
        log.warn(`[${this.toolName}] ⚠️ Cannot send response; native module missing`, {}, { requestId });
      }
    } catch (error) {
      log.error(`[${this.toolName}] ❌ Toolkit operation failed`, {}, {
        requestId,
        callId,
        groupName,
        toolName,
        eventId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      }, error);

      if (this.module) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorResult = JSON.stringify({ error: errorMessage });
        this.module.sendToolkitResponse(requestId, errorResult);
        log.info(`[${this.toolName}] 📤 Sent error response to Swift`, {}, {
          requestId,
          callId,
          errorMessage,
        });
      }
    }
  }

  /**
   * Execute a toolkit operation (STUBBED).
   * This is where the actual tool logic will be implemented later.
   */
  private async executeToolkitOperation(
    groupName: string,
    toolName: string,
    args: any,
    context: { requestId: string; callId: string; eventId?: string }
  ): Promise<string> {
    const { requestId, callId, eventId } = context;

    log.info(`[${this.toolName}] 🔧 Executing toolkit operation (STUBBED)`, {}, {
      groupName,
      toolName,
      args,
      requestId,
      callId,
      eventId,
    });

    // STUB: Return a bogus response
    // In the future, this will route to actual toolkit implementations
    const stubbedResponse = {
      success: true,
      data: "I found 2 top stories on hacker news. Story 1: rust goes open source. Story 2: open ai raises 10 trillion on a 100 trillion valuation",
      metadata: {
        groupName,
        toolName,
        timestamp: new Date().toISOString(),
      }
    };

    // Simulate some async work
    await new Promise(resolve => setTimeout(resolve, 100));

    return JSON.stringify(stubbedResponse);
  }

  // MARK: - Public Methods

  /**
   * Execute a toolkit operation directly (for testing).
   */
  async execute(groupName: string, toolName: string, args: any): Promise<string> {
    return this.executeToolkitOperation(groupName, toolName, args, {
      requestId: 'direct-call',
      callId: 'direct-call',
    });
  }
}

// MARK: - Factory Function

/**
 * Creates a new ToolkitHelper instance with the provided native module.
 * Returns null if the module is not available.
 */
export const createToolkitHelper = (nativeModule: ToolkitHelperNativeModule | null): ToolkitHelper | null => {
  if (!nativeModule) {
    log.warn('[ToolkitHelper] Native module not available, toolkit helper will not be initialized', {});
    return null;
  }
  return new ToolkitHelper(nativeModule);
};

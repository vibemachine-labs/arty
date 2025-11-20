import { log } from '../../../lib/logger';
import { type ToolNativeModule } from './ToolHelper';
import { executeToolkitFunction } from './toolkit_functions/toolkit_functions';
import {
  type ToolSessionContext,
  isToolSessionContextEmpty,
  summarizeToolSessionContext,
} from './toolkit_functions/types';

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
 * Also maintains per-tool session context for stateful tool interactions.
 */
export class ToolkitHelper {
  private readonly toolName = 'ToolkitHelper';
  private readonly requestEventName = 'onToolkitRequest';
  private readonly module: ToolkitHelperNativeModule | null;
  private readonly toolSessionContexts: Map<string, ToolSessionContext> = new Map();

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
      arguments: argumentsJSON,
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
        result: result,
      });

      if (this.module) {
      this.module.sendToolkitResponse(requestId, result);
      log.info(`[${this.toolName}] 📤 Sent response to Swift`, {}, {
        requestId,
        callId,
        responseLength: String(result).length,
        response: result,
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
   * Execute a toolkit operation by routing to the appropriate toolkit function.
   * Handles per-tool session context round-tripping.
   * TODO: can this be DRY'd with ToolManager.executeGen2ToolCall()?
   */
  private async executeToolkitOperation(
    groupName: string,
    toolName: string,
    args: any,
    context: { requestId: string; callId: string; eventId?: string }
  ): Promise<string> {
    const { requestId, callId, eventId } = context;

    log.info(`[${this.toolName}] 🔧 Executing toolkit operation`, {}, {
      groupName,
      toolName,
      args,
      requestId,
      callId,
      eventId,
    });

    try {
      // Prepare context parameters based on the toolkit group
      let context_params;
      if (groupName === 'web') {
        context_params = {
          maxLength: 1500,
          minHtmlForBody: 15000,
          maxRawBytes: 3000000,
        };
      }

      // Get the current session context for this tool
      const toolKey = `${groupName}__${toolName}`;
      const currentSessionContext = this.toolSessionContexts.get(toolKey) || {};

      // Route to the appropriate toolkit function
      const toolkitResult = await executeToolkitFunction(
        groupName,
        toolName,
        args,
        context_params,
        currentSessionContext
      );

      // Store the updated session context for this tool
      this.toolSessionContexts.set(toolKey, toolkitResult.updatedToolSessionContext);

      // Append session context to result if non-empty
      let finalResult = toolkitResult.result;
      if (!isToolSessionContextEmpty(toolkitResult.updatedToolSessionContext)) {
        const contextSummary = summarizeToolSessionContext(toolkitResult.updatedToolSessionContext);
        finalResult = `${toolkitResult.result}\n\nTool session context: ${contextSummary}`;
      }

      log.info(`[${this.toolName}] ✅ Toolkit function executed successfully`, {}, {
        groupName,
        toolName,
        requestId,
        callId,
        resultLength: finalResult.length,
        result: finalResult,
        sessionContextKeys: Object.keys(toolkitResult.updatedToolSessionContext),
      });

      return finalResult;
    } catch (error) {
      log.error(`[${this.toolName}] ❌ Toolkit function execution failed`, {}, {
        groupName,
        toolName,
        requestId,
        callId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      }, error);

      // Return error as JSON
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          groupName,
          toolName,
          timestamp: new Date().toISOString(),
        }
      });
    }
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

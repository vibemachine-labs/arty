import { log } from '../../../lib/logger';

// MARK: - Types

export interface ToolNativeModule {
  sendResponse?(requestId: string, result: number): void;
  addListener(eventName: string, listener: (event: any) => void): void;
}

export interface ToolRequestPayload {
  requestId: string;
  [key: string]: any;
}

export interface ToolParams {
  [key: string]: number;
}

// MARK: - Base Tool Helper

/**
 * Base class that provides shared functionality for all tool implementations.
 * Handles common tasks like event listener setup, error handling, and response management.
 */
export abstract class ToolHelper<TParams extends ToolParams> {
  protected readonly moduleName: string;
  protected readonly eventName: string;
  protected module: ToolNativeModule | null;
  protected isListenerRegistered = false;

  constructor(
    moduleName: string,
    eventName: string,
    nativeModule: ToolNativeModule | null
  ) {
    this.moduleName = moduleName;
    this.eventName = eventName;
    this.module = nativeModule;
    this.setupEventListener();
  }

  // MARK: - Abstract Methods

  /**
   * Perform the actual calculation/operation.
   * Must be implemented by subclasses.
   */
  protected abstract performOperation(params: TParams): Promise<number>;

  /**
   * Get the name of the response method on the native module.
   * Must be implemented by subclasses.
   */
  protected abstract getResponseMethodName(): string;

  // MARK: - Public Methods

  /**
   * Execute the tool operation with the given parameters.
   */
  async execute(params: TParams): Promise<number> {
    log.info(`[${this.moduleName}] 🧮 ${this.eventName} - Operation invoked`, params);

    const result = await this.performOperation(params);

    log.info(`[${this.moduleName}] ✅ ${this.eventName} - Operation result computed`, {
      ...params,
      result,
    });

    return result;
  }

  /**
   * Bridge function - calls JS tool from Swift via native bridge.
   * Used for testing the Swift → JS → Swift flow.
   */
  async executeFromSwift(...args: number[]): Promise<number> {
    if (!this.module) {
      throw new Error(`Native module not available for ${this.moduleName} bridge function`);
    }

    const params = this.argsToParams(args);

    log.info(`[${this.moduleName}] 📱 executeFromSwift invoked (testing Swift → JS → Swift flow)`, params);

    const result = await this.performOperation(params);

    log.info(`[${this.moduleName}] 📱 executeFromSwift completed`, { ...params, result });

    return result;
  }

  /**
   * Check if the tool is available (native module is loaded).
   */
  isAvailable(): boolean {
    return this.module !== null;
  }

  // MARK: - Protected Methods

  /**
   * Convert an array of arguments to a params object.
   * Can be overridden by subclasses for custom mapping.
   */
  protected argsToParams(args: number[]): TParams {
    const params: any = {};
    const keys = ['a', 'b', 'c', 'd', 'e']; // Support up to 5 params
    
    args.forEach((value, index) => {
      if (index < keys.length) {
        params[keys[index]] = value;
      }
    });

    return params as TParams;
  }

  /**
   * Send response back to native module.
   */
  protected sendResponse(requestId: string, result: number): void {
    if (!this.module) {
      log.error(`[${this.moduleName}] Cannot send response: module not available`);
      return;
    }

    const methodName = this.getResponseMethodName();
    const sendMethod = (this.module as any)[methodName];

    if (typeof sendMethod === 'function') {
      sendMethod.call(this.module, requestId, result);
    } else {
      log.error(`[${this.moduleName}] Response method '${methodName}' not found on module`);
    }
  }

  // MARK: - Private Methods

  /**
   * Set up event listener for tool requests from native Swift code.
   * This handles OpenAI tool calls that come from the native WebRTC client.
   */
  private setupEventListener(): void {
    if (!this.module || this.isListenerRegistered) {
      return;
    }

    try {
      this.module.addListener(this.eventName, async (event: ToolRequestPayload) => {
        log.info(`[${this.moduleName}] 📥 ${this.eventName} - Tool request received from native (OpenAI tool call)`, {}, event);

        try {
          // Extract params from event (excluding requestId)
          const { requestId, ...params } = event;

          // Execute the operation
          const result = await this.execute(params as TParams);

          log.info(`[${this.moduleName}] 📤 ${this.eventName} - Sending result back to native`, {}, {
            requestId,
            result,
          });

          // Send result back to native
          this.sendResponse(requestId, result);
        } catch (error) {
          log.error(`[${this.moduleName}] ❌ Operation error`, {}, {
            requestId: event.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Send error result (0 as fallback)
          this.sendResponse(event.requestId, 0);
        }
      });

      this.isListenerRegistered = true;
      log.info(`[${this.moduleName}] ✓ Event listener registered for '${this.eventName}' ✅`);
    } catch (error) {
      log.error(`[${this.moduleName}] ❌ Failed to register event listener`, {}, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

import type { RequestParams } from './types';

import { ZodSchema } from 'zod';
import { log } from '../../../../lib/logger';
import {
  CallToolRequest,
  CallToolResult,
  JSONRPC_VERSION,
  JSONRPCError,
  JSONRPCRequest,
  JSONRPCResponse,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequest,
  ListToolsResult,
  ListToolsResultSchema,
  ResultSchema
} from './types';

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Maximum characters allowed in MCP tool results to prevent context window overflow.
 * Results larger than this will be truncated.
 */
const MAX_MCP_RESULT_LENGTH = 25000;

/**
 * MCP Client for communicating with remote MCP servers via HTTP with session management
 * 
 * A bit of a hack to work around missing/unclear react native compatibility in 
 * reference typescript client: https://github.com/modelcontextprotocol/typescript-sdk/issues/1117
 */
export class MCPClient {
  private endpoint: string;
  private requestId = 0;
  private sessionId: string | null = null;
  private initializePromise: Promise<void> | null = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  /**
   * Initialize the MCP session
   */
  private async initialize(): Promise<void> {
    if (this.sessionId) {
      return; // Already initialized
    }

    log.info('[MCPClient] Initializing MCP session', {}, {
      endpoint: this.endpoint,
    });

    const body: JSONRPCRequest = {
      jsonrpc: JSONRPC_VERSION,
      id: ++this.requestId,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'arty',
          version: '1.0.0',
        },
      },
    };

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Initialize failed: ${res.status} ${res.statusText}`);
      }

      // Extract session ID from response headers
      const sessionId = res.headers.get('Mcp-Session-Id');
      if (sessionId) {
        this.sessionId = sessionId;
        log.info('[MCPClient] Session established for mcp server', {}, {
          endpoint: this.endpoint,
          sessionId: this.sessionId,
        });
      } else {
        log.warn('[MCPClient] No session ID returned by server', {}, {
          endpoint: this.endpoint,
        });
      }

      // Check if response is SSE format (text/event-stream)
      const contentType = res.headers.get('content-type') || '';
      const rawResponse =
        contentType.includes('text/event-stream')
          ? this.parseSSEResponse(await res.text())
          : await res.json();

      const parsedResponse = this.ensureJsonRpcObject(rawResponse);

      if ('error' in parsedResponse) {
        const errorResponse = parsedResponse as JSONRPCError;
        throw new Error(
          `Initialize error ${errorResponse.error.code}: ${errorResponse.error.message}`
        );
      }

      log.info('[MCPClient] MCP session initialized successfully', {}, {
        endpoint: this.endpoint,
        sessionId: this.sessionId,
      });
    } catch (error) {
      log.error('[MCPClient] Failed to initialize MCP session', {}, {
        endpoint: this.endpoint,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Ensure the client is initialized before making requests
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initialize();
    }
    await this.initializePromise;
  }

  /**
   * Parse Server-Sent Events (SSE) format response to extract JSON-RPC message
   * SSE format is:
   *   event: message
   *   data: {"jsonrpc":"2.0",...}
   *
   *   event: ping
   *   data: ping
   */
  private parseSSEResponse(sseText: string): any {
    const lines = sseText.trim().split('\n');
    let currentEvent = '';
    let currentData = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('event:')) {
        // If we had a previous event with data, process it first
        if (currentEvent === 'message' && currentData) {
          try {
            return JSON.parse(currentData);
          } catch (error) {
            log.error('[MCPClient] Failed to parse SSE message data as JSON', {}, {
              data: currentData,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        // Start new event
        currentEvent = line.substring(6).trim();
        currentData = '';
      } else if (line.startsWith('data:')) {
        currentData = line.substring(5).trim();

        // If this is a message event and we have data, try to parse it
        if (currentEvent === 'message' && currentData) {
          try {
            return JSON.parse(currentData);
          } catch (error) {
            log.error('[MCPClient] Failed to parse SSE message data as JSON', {}, {
              data: currentData,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else if (line === '') {
        // Empty line marks end of event, process if it's a message
        if (currentEvent === 'message' && currentData) {
          try {
            return JSON.parse(currentData);
          } catch (error) {
            log.error('[MCPClient] Failed to parse SSE message data as JSON', {}, {
              data: currentData,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        // Reset for next event
        currentEvent = '';
        currentData = '';
      }
    }

    // Process final event if it's a message
    if (currentEvent === 'message' && currentData) {
      try {
        return JSON.parse(currentData);
      } catch (error) {
        log.error('[MCPClient] Failed to parse final SSE message data', {}, {
          data: currentData,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.error('[MCPClient] No valid message event found in SSE response', {}, {
      sseText,
    });
    throw new Error('No valid JSON-RPC message in SSE response');
  }

  /**
   * Ensure parsed JSON payload is an object before usage.
   */
  private ensureJsonRpcObject(value: unknown): JSONRPCResponse | JSONRPCError {
    if (typeof value !== 'object' || value === null) {
      log.error('[MCPClient] Invalid MCP response payload', {}, {
        payload: value,
      });
      throw new Error('Invalid JSON-RPC response: expected an object payload');
    }

    return value as JSONRPCResponse | JSONRPCError;
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  private async request<TParams extends RequestParams | undefined, TResult>(
    req: { method: string; params?: TParams },
    resultSchema: ZodSchema<TResult>,
    options?: RequestOptions
  ): Promise<TResult> {
    // Ensure we're initialized before making any request
    await this.ensureInitialized();

    const body: JSONRPCRequest = {
      jsonrpc: JSONRPC_VERSION,
      id: ++this.requestId,
      method: req.method,
      params: req.params,
    };

    log.info('[MCPClient] Sending JSON-RPC request', {}, {
      endpoint: this.endpoint,
      method: req.method,
      requestId: body.id,
      sessionId: this.sessionId,
      requestPayload: body,
    });

    const controller = new AbortController();
    const timeoutId = options?.timeout
      ? setTimeout(function () {
          controller.abort();
        }, options.timeout)
      : undefined;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...(options?.headers || {}),
      };

      // Add session ID header if we have one
      if (this.sessionId) {
        headers['Mcp-Session-Id'] = this.sessionId;
      }

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        log.error('[MCPClient] Network error from MCP server', {}, {
          endpoint: this.endpoint,
          status: res.status,
          statusText: res.statusText,
        });
        throw new Error(`Network error: ${res.status} ${res.statusText}`);
      }

      // Check if response is SSE format (text/event-stream)
      const contentType = res.headers.get('content-type') || '';

      const rawResponse =
        contentType.includes('text/event-stream')
          ? this.parseSSEResponse(await res.text())
          : await res.json();

      const responsePayload = this.ensureJsonRpcObject(rawResponse);

      // Check if it's an error response
      if ('error' in responsePayload) {
        const errorResponse = responsePayload as JSONRPCError;
        log.error('[MCPClient] MCP server returned error', {}, {
          endpoint: this.endpoint,
          errorCode: errorResponse.error.code,
          errorMessage: errorResponse.error.message,
        });
        throw new Error(
          `RPC Error ${errorResponse.error.code}: ${errorResponse.error.message}`
        );
      }

      // Parse as success response
      const response = responsePayload as JSONRPCResponse;
      if (response.result === undefined) {
        log.error('[MCPClient] Response missing result field', {}, {
          endpoint: this.endpoint,
          responseId: response.id,
        });
        throw new Error(`RPC Response missing result for id ${response.id}`);
      }

      // Validate the result against the schema
      const parsed = resultSchema.safeParse(response.result);
      if (!parsed.success) {
        log.error('[MCPClient] Response validation failed', {}, {
          endpoint: this.endpoint,
          validationError: parsed.error.message,
        });
        throw new Error(
          `Invalid response format: ${parsed.error.message}`
        );
      }

      log.info('[MCPClient] JSON-RPC request successful', {}, {
        endpoint: this.endpoint,
        method: req.method,
        requestId: body.id,
      });

      return parsed.data;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (error instanceof Error && error.name === 'AbortError') {
        log.error('[MCPClient] Request timeout', {}, {
          endpoint: this.endpoint,
          timeout: options?.timeout,
        });
        throw new Error('Request timeout');
      }

      throw error;
    }
  }

  /**
   * List all tools available on the MCP server
   */
  async listTools(
    params?: ListToolsRequest['params'],
    options?: RequestOptions
  ): Promise<ListToolsResult> {
    log.info('[MCPClient] Listing tools from MCP server', {}, {
      endpoint: this.endpoint,
    });

    const result = await this.request<ListToolsRequest['params'], ListToolsResult>(
      { method: 'tools/list', params },
      ListToolsResultSchema,
      options
    );

    log.info('[MCPClient] Retrieved tools from MCP server', {}, {
      endpoint: this.endpoint,
      toolCount: result.tools?.length || 0,
    });

    return result;
  }

  /**
   * Validate arguments for specific endpoints that require non-empty values
   */
  private validateArgumentsForEndpoint(
    toolName: string,
    args: Record<string, unknown> | undefined
  ): void {
    // Special handling for deepwiki MCP server
    if (this.endpoint === 'https://mcp.deepwiki.com/mcp') {
      const repoName = args?.repoName;

      if (toolName === 'ask_question') {
        const question = args?.question;

        if (!repoName || (typeof repoName === 'string' && repoName.trim() === '')) {
          throw new Error('deepwiki ask_question requires non-empty repoName argument');
        }

        if (!question || (typeof question === 'string' && question.trim() === '')) {
          throw new Error('deepwiki ask_question requires non-empty question argument');
        }
      } else if (toolName === 'read_wiki_contents' || toolName === 'read_wiki_structure') {
        if (!repoName || (typeof repoName === 'string' && repoName.trim() === '')) {
          throw new Error(`deepwiki ${toolName} requires non-empty repoName argument`);
        }
      }
    }
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(
    params: CallToolRequest['params'],
    options?: RequestOptions,
    toolGroup?: string
  ): Promise<CallToolResult> {
    // Validate arguments for endpoints with special requirements
    try {
      this.validateArgumentsForEndpoint(params.name, params.arguments);
    } catch (error) {
      log.error('[MCPClient] Argument validation failed', {}, {
        endpoint: this.endpoint,
        toolName: params.name,
        arguments: params.arguments,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const logMessage = toolGroup
      ? `[MCPClient] Calling tool on MCP server (${toolGroup})`
      : '[MCPClient] Calling tool on MCP server';

    log.info(logMessage, {}, {
      endpoint: this.endpoint,
      toolGroup: toolGroup || 'unknown',
      toolName: params.name,
      arguments: params.arguments,
    });

    const result = await this.request<CallToolRequest['params'], any>(
      { method: 'tools/call', params },
      ResultSchema.passthrough() as any,
      options
    );

    // Truncate result content if it exceeds max length
    let resultLength = 0;
    if (result.content && Array.isArray(result.content)) {
      for (const contentItem of result.content) {
        if (contentItem.type === 'text' && typeof contentItem.text === 'string') {
          resultLength += contentItem.text.length;
        }
      }
    }

    if (resultLength > MAX_MCP_RESULT_LENGTH) {
      log.warn('[MCPClient] MCP result exceeds max length, truncating', {}, {
        endpoint: this.endpoint,
        toolGroup: toolGroup || 'unknown',
        toolName: params.name,
        originalLength: resultLength,
        maxLength: MAX_MCP_RESULT_LENGTH,
      });

      // Truncate the text content
      let remainingChars = MAX_MCP_RESULT_LENGTH;
      for (const contentItem of result.content) {
        if (contentItem.type === 'text' && typeof contentItem.text === 'string') {
          if (contentItem.text.length > remainingChars) {
            contentItem.text = contentItem.text.substring(0, remainingChars);
            remainingChars = 0;
          } else {
            remainingChars -= contentItem.text.length;
          }
        }
      }
    }

    const completionMessage = toolGroup
      ? `[MCPClient] Tool call completed on MCP server (${toolGroup})`
      : '[MCPClient] Tool call completed on MCP server';

    log.info(completionMessage, {}, {
      endpoint: this.endpoint,
      toolGroup: toolGroup || 'unknown',
      toolName: params.name,
      isError: result.isError,
      contentLength: result.content?.length || 0,
      resultLength: resultLength > MAX_MCP_RESULT_LENGTH ? MAX_MCP_RESULT_LENGTH : resultLength,
      result: result,
    });

    return result;
  }
}

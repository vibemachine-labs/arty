import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  ListToolsRequest,
  ListToolsResult,
  ListToolsResultSchema,
  JSONRPC_VERSION,
} from './types';
import { ZodSchema } from 'zod';
import { log } from '../../../../lib/logger';

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * MCP Client for communicating with remote MCP servers via SSE or other protocols
 */
export class MCPClient {
  private endpoint: string;
  private requestId = 0;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  private async request<TParams, TResult>(
    req: { method: string; params?: TParams },
    resultSchema: ZodSchema<TResult>,
    options?: RequestOptions
  ): Promise<TResult> {
    const body: JSONRPCRequest = {
      jsonrpc: JSONRPC_VERSION,
      id: ++this.requestId,
      method: req.method,
      params: req.params as any,
    };

    log.info('[MCPClient] Sending JSON-RPC request', {}, {
      endpoint: this.endpoint,
      method: req.method,
      requestId: body.id,
    });

    const controller = new AbortController();
    const timeoutId = options?.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : undefined;

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
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

      const json = await res.json();

      // Check if it's an error response
      if ('error' in json) {
        const errorResponse = json as JSONRPCError;
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
      const response = json as JSONRPCResponse;
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
}

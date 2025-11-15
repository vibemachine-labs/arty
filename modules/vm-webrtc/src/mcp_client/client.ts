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
        throw new Error(`Network error: ${res.status} ${res.statusText}`);
      }

      const json = await res.json();

      // Check if it's an error response
      if ('error' in json) {
        const errorResponse = json as JSONRPCError;
        throw new Error(
          `RPC Error ${errorResponse.error.code}: ${errorResponse.error.message}`
        );
      }

      // Parse as success response
      const response = json as JSONRPCResponse;
      if (response.result === undefined) {
        throw new Error(`RPC Response missing result for id ${response.id}`);
      }

      // Validate the result against the schema
      const parsed = resultSchema.safeParse(response.result);
      if (!parsed.success) {
        throw new Error(
          `Invalid response format: ${parsed.error.message}`
        );
      }

      return parsed.data;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (error instanceof Error && error.name === 'AbortError') {
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
    return this.request<ListToolsRequest['params'], ListToolsResult>(
      { method: 'tools/list', params },
      ListToolsResultSchema,
      options
    );
  }
}

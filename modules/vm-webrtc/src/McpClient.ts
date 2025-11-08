import { log } from '../../../lib/logger';
import type { ToolDefinition } from './VmWebrtc.types';

const MCP_JSONRPC_VERSION = '2.0';
const MCP_TOOLS_LIST_METHOD = 'tools/list';
const MCP_ACCEPT_HEADER = 'text/event-stream, application/json;q=0.9';

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type McpToolSchema = {
  type?: string;
  description?: string;
};

type McpToolDescriptor = {
  name?: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, McpToolSchema>;
    required?: string[];
  };
};

type ToolsListResult = {
  tools?: McpToolDescriptor[];
};

type ToolsListResponse = {
  jsonrpc?: string;
  id?: string;
  result?: ToolsListResult;
  error?: JsonRpcError;
};

type McpClientOptions = {
  requestTimeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

export class McpClient {
  private readonly serverName: string;
  private readonly serverUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(serverName: string, serverUrl: string, options?: McpClientOptions) {
    const trimmedName = serverName.trim();
    const trimmedUrl = serverUrl.trim();

    if (!trimmedName) {
      throw new Error('MCP client requires a non-empty server name.');
    }

    if (!trimmedUrl) {
      throw new Error('MCP client requires a non-empty server URL.');
    }

    try {
      // Validate URL and normalize it to the string returned by the URL constructor.
      this.serverUrl = new URL(trimmedUrl).toString();
    } catch (error) {
      throw new Error(`Invalid MCP server URL provided: ${trimmedUrl}`);
    }

    this.serverName = trimmedName;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    log.info('[McpClient] Created instance', {}, {
      serverName: this.serverName,
      serverUrl: this.serverUrl,
      requestTimeoutMs: this.requestTimeoutMs,
    });
  }

  async listTools(): Promise<ToolDefinition[]> {
    const requestId = this.buildRequestId();
    const payload = {
      jsonrpc: MCP_JSONRPC_VERSION,
      id: requestId,
      method: MCP_TOOLS_LIST_METHOD,
      params: {},
    };

    log.info('[McpClient] Requesting tools', {}, {
      serverName: this.serverName,
      requestId,
    });

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: MCP_ACCEPT_HEADER,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      let rawText = await response.text();
      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream')) {
        const extracted = this.extractJsonFromEventStream(rawText);
        if (extracted) {
          log.debug('[McpClient] Parsed SSE payload', {}, {
            serverName: this.serverName,
            payloadPreview: extracted.slice(0, 200),
          });
          rawText = extracted;
        } else {
          log.warn('[McpClient] SSE payload did not contain data lines', {}, {
            serverName: this.serverName,
          });
        }
      }
      log.debug('[McpClient] Received tools payload', {}, {
        serverName: this.serverName,
        status: response.status,
        ok: response.ok,
        responsePreview: rawText.slice(0, 200),
      });

      if (!response.ok) {
        throw new Error(`MCP server responded with HTTP ${response.status}`);
      }

      let parsed: ToolsListResponse;
      try {
        parsed = JSON.parse(rawText) as ToolsListResponse;
      } catch (parseError) {
        log.warn('[McpClient] Failed to parse MCP tools response', {}, {
          errorMessage: parseError instanceof Error ? parseError.message : String(parseError),
        });
        throw new Error('MCP server returned malformed JSON during tools/list.');
      }

      if (parsed.error) {
        throw new Error(`MCP server error ${parsed.error.code}: ${parsed.error.message}`);
      }

      if (!parsed.result || !Array.isArray(parsed.result.tools)) {
        throw new Error('MCP server did not include a valid tools array.');
      }

      const tools = parsed.result.tools
        .map((tool) => this.normalizeToolDescriptor(tool))
        .filter((tool): tool is ToolDefinition => Boolean(tool));

      log.info('[McpClient] tools/list successful', {}, {
        serverName: this.serverName,
        toolCount: tools.length,
      });

      return tools;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timed out fetching MCP tools from ${this.serverName}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private normalizeToolDescriptor(descriptor?: McpToolDescriptor): ToolDefinition | null {
    if (!descriptor?.name) {
      log.warn('[McpClient] Skipping tool without a valid name', {}, descriptor);
      return null;
    }

    const description = (descriptor.description ?? '').trim() || 'No description provided.';

    const properties = this.normalizeProperties(descriptor.inputSchema?.properties);
    const required = this.normalizeRequired(descriptor.inputSchema?.required, properties);

    return {
      type: 'function',
      name: descriptor.name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    };
  }

  private normalizeProperties(rawProperties?: Record<string, McpToolSchema>) {
    const normalized: ToolDefinition['parameters']['properties'] = {};
    if (!rawProperties || typeof rawProperties !== 'object') {
      return normalized;
    }

    Object.entries(rawProperties).forEach(([key, schema]) => {
      if (!schema || typeof schema !== 'object') {
        return;
      }
      const type = typeof schema.type === 'string' && schema.type.trim().length > 0 ? schema.type : 'string';
      const description =
        typeof schema.description === 'string' && schema.description.trim().length > 0
          ? schema.description
          : 'No description provided.';
      normalized[key] = { type, description };
    });

    return normalized;
  }

  private normalizeRequired(candidate: string[] | undefined, properties: ToolDefinition['parameters']['properties']) {
    if (!Array.isArray(candidate)) {
      return [];
    }
    return candidate
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0 && properties[entry] !== undefined)
      .map((entry) => entry.trim());
  }

  private buildRequestId(): string {
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    return `${this.serverName}-${Date.now()}-${randomSuffix}`;
  }

  private extractJsonFromEventStream(payload: string): string | null {
    const chunks = payload
      .split(/\r?\n\r?\n/)
      .map((chunk) => chunk.split(/\r?\n/).filter((line) => line.startsWith('data:')));

    for (const dataLines of chunks) {
      if (dataLines.length === 0) {
        continue;
      }
      const candidate = dataLines
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();

      if (!candidate) {
        continue;
      }

      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        continue;
      }
    }

    return null;
  }
}

export default McpClient;

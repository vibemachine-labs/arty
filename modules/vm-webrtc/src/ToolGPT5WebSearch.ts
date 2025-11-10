import { log } from '../../../lib/logger';
import { getApiKey } from '../../../lib/secure-storage';
import { type ToolNativeModule } from './ToolHelper';
import { type ToolDefinition } from './VmWebrtc.types';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export const gpt5WebSearchDefinition: ToolDefinition = {
  type: 'function',
  name: 'GPT5-web-search',
  description: 'Comprehensive and fast web search',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The user’s question or topic to research across the live web.',
      },
    },
    required: ['query'],
  },
};

export interface GPT5WebSearchParams {
  query: string;
}

export interface GPT5WebSearchNativeModule extends ToolNativeModule {
  gpt5WebSearchOperationFromSwift(query: string): Promise<string>;
  sendGPT5WebSearchResponse(requestId: string, result: string): void;
}

type OpenAIResponse = {
  output_text?: string;
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
    text?: string;
  }[];
};

const extractOutputText = (resp: OpenAIResponse): string => {
  if (resp.output_text && resp.output_text.length > 0) {
    return resp.output_text;
  }

  let combined = '';
  for (const outItem of resp.output ?? []) {
    if (Array.isArray(outItem.content)) {
      for (const segment of outItem.content) {
        if (segment && typeof segment.text === 'string') {
          combined += segment.text;
        }
      }
    }
    const directText = (outItem as any)?.text;
    if (typeof directText === 'string') {
      combined += directText;
    }
  }
  return combined;
};

const tryParseJson = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const sanitizeQuery = (query: string): string => query.trim();

export class ToolGPT5WebSearch {
  private readonly toolName = 'GPT5-web-search';
  private readonly requestEventName = 'onGPT5WebSearchRequest';
  private readonly module: GPT5WebSearchNativeModule | null;

  constructor(nativeModule: GPT5WebSearchNativeModule | null) {
    this.module = nativeModule;

    if (this.module) {
      log.info(`[${this.toolName}] Initializing; attaching listener for ${this.requestEventName}`, {});
      this.module.addListener(this.requestEventName, this.handleRequest.bind(this));
    } else {
      log.info(`[${this.toolName}] Native module unavailable; web search tool disabled.`, {});
    }
  }

  private async handleRequest(event: { requestId: string; query?: string }) {
    const { requestId } = event;
    const query = event.query ?? '';
    log.info(`[${this.toolName}] 📥 Received request from Swift: requestId=${requestId}, queryChars=${query.length}`, {});

    try {
      const result = await this.performOperation({ query });
      log.info(`[${this.toolName}] 📡 Delivering result to native bridge`, {}, {
        requestId,
        payloadLength: result.length,
      });
      this.module?.sendGPT5WebSearchResponse(requestId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.info(`[${this.toolName}] ❌ Operation failed: requestId=${requestId}`, {}, message);
      this.module?.sendGPT5WebSearchResponse(
        requestId,
        JSON.stringify({ error: message }),
      );
    }
  }

  private async performOperation(params: GPT5WebSearchParams): Promise<string> {
    const query = sanitizeQuery(params.query);
    log.info(`[${this.toolName}] 🔍 performOperation invoked`, {}, { queryPreview: query.slice(0, 80) });

    if (!query) {
      throw new Error('Web search requires a non-empty query.');
    }

    // Get API key from secure-storage (uses in-memory cache to avoid SecureStore access issues)
    const apiKey = await getApiKey({ forceSecureStore: true });
    if (!apiKey) {
      log.info(`[${this.toolName}] ⚠️ OpenAI API key not configured`, {});
      return JSON.stringify({
        query,
        error: 'OpenAI API key not configured',
      });
    }

    const payload = {
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: 'You are a focused research assistant. Use live web search to answer succinctly with citations when available.' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: query }],
        },
      ],
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto' as const,
    };

    log.info(`[${this.toolName}] 📤 Sending payload to OpenAI`, {}, {
      model: payload.model,
      toolCount: payload.tools.length,
      queryLength: query.length,
    });

    let response: Response;
    try {
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (networkError) {
      log.info(`[${this.toolName}] ❌ Network error calling OpenAI Responses API`, {}, networkError);
      throw new Error('Failed to reach OpenAI Responses API for web search.');
    }

    const rawText = await response.text();
    log.info(`[${this.toolName}] 📥 OpenAI response received`, {}, {
      status: response.status,
      ok: response.ok,
      textPreview: rawText.slice(0, 200),
    });

    if (!response.ok) {
      throw new Error(`OpenAI Responses API error ${response.status}: ${rawText.slice(0, 400)}`);
    }

    const parsed = tryParseJson<OpenAIResponse>(rawText);
    if (!parsed) {
      throw new Error('Failed to parse OpenAI response JSON');
    }

    const answer = extractOutputText(parsed).trim();
    if (!answer) {
      throw new Error('OpenAI response did not include any text output');
    }

    const payloadToReturn = JSON.stringify({
      query,
      answer,
    });

    log.info(`[${this.toolName}] 📦 Prepared JS payload for native`, {}, {
      payloadLength: payloadToReturn.length,
      answerPreview: answer.slice(0, 200),
    });

    log.info(`[${this.toolName}] ✅ Returning web search payload`, {}, {
      payloadLength: payloadToReturn.length,
      answerPreview: answer.slice(0, 200),
    });

    return payloadToReturn;
  }

  async execute(params: GPT5WebSearchParams): Promise<string> {
    return this.performOperation(params);
  }

  async executeFromSwift(query: string): Promise<string> {
    return this.performOperation({ query });
  }
}

export const createGPT5WebSearchTool = (
  nativeModule: GPT5WebSearchNativeModule | null
): ToolGPT5WebSearch | null => {
  if (!nativeModule) {
    log.info('[ToolGPT5WebSearch] Native module not available. Web search tool will not be initialized.', {});
    return null;
  }

  return new ToolGPT5WebSearch(nativeModule);
};

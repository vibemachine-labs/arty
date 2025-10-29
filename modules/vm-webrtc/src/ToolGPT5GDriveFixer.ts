import { log } from '../../../lib/logger';
import { getApiKey } from '../../../lib/secure-storage';
import { executeGDriveSnippet, type ExecuteGDriveSnippetOptions } from './ToolGDriveConnector';
import { type ToolNativeModule } from './ToolHelper';
import { type ToolDefinition } from './VmWebrtc.types';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export const gpt5GDriveFixerDefinition: ToolDefinition = {
  type: 'function',
  name: 'GPT5-gdrive-fixer',
  description: `when you generate code but it fails to run,call this tool to fix the code with
- [ ] description of what code is supposed to do
- [ ] broken code
- [ ] error message`,
  parameters: {
    type: 'object',
    properties: {
      task_description: {
        type: 'string',
        description: 'High level description of what the code is supposed to accomplish.',
      },
      broken_code: {
        type: 'string',
        description: 'The exact code that failed when executed.',
      },
      error_message: {
        type: 'string',
        description: 'The runtime error message or stack trace observed when the code failed.',
      },
    },
    required: ['task_description', 'broken_code', 'error_message'],
  },
};

export interface GPT5GDriveFixerParams {
  task_description: string;
  broken_code: string;
  error_message: string;
}

export interface GPT5GDriveFixerNativeModule extends ToolNativeModule {
  gpt5GDriveFixerOperationFromSwift(paramsJson: string): Promise<string>;
  sendGPT5GDriveFixerResponse(requestId: string, result: string): void;
}

type OpenAIResponse = {
  output_text?: string;
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
  }[];
};

const extractOutputText = (resp: OpenAIResponse): string => {
  if (resp.output_text && resp.output_text.length > 0) {
    return resp.output_text;
  }

  let combined = '';
  for (const outItem of resp.output ?? []) {
    if (outItem.type !== 'message') continue;
    for (const segment of outItem.content ?? []) {
      if (typeof segment.text === 'string') {
        combined += segment.text;
      }
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

const buildPrompt = (params: GPT5GDriveFixerParams, gdriveRequirements: string): { system: string; user: string } => {
  const system = `
You are an expert Expo React Native engineer and Google Drive API specialist.
You repair failing Google Drive connector snippets so they satisfy the exact same requirements as the gdrive_connector tool.
Always return a single self-invoking JavaScript expression that produces a JSON-serializable value and relies only on globals documented below.
Globals available at runtime: accessToken (string), fetch (may need Authorization header), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval.
Do not introduce imports, require(), named functions, or external dependencies.
Your response MUST be JSON with fields: fixed_code (string), notes (string).

Full gdrive connector requirements:
${gdriveRequirements}

Requirements:
- Return a JSON-serializable value (string, number, boolean, object, array, null)
- Must be synchronous - no async/await, Promises, or callbacks
- Include console.log statements for debugging purposes
- Do NOT declare or call named functions (no 'function foo()' or 'foo()')
- Do NOT reference external variables - inline all needed values as constants
- Use only standard JavaScript features available in most environments

The snippet must not import any other modules or libraries that are not included by default in react native, 
since it will be run in a restricted react native environment.

You should derive the snippet from the user's request, then call this tool
with that snippet.

Example code snippet 1:

// MUST be a single self-invoking expression that returns a Promise
// Note: accessToken will be available in scope when this snippet is executed
(() => {
  const params = new URLSearchParams({
    pageSize: "20",
    fields: "files(id,name,mimeType,modifiedTime)",
    orderBy: "modifiedTime desc",
    spaces: "drive",
  });

  return fetch("https://www.googleapis.com/drive/v3/files?" + params.toString(), {
    headers: {
      Authorization: "Bearer " + accessToken,
    },
  })
  .then(res => {
    if (!res.ok) {
      return res.text().then(txt => {
        throw new Error("Drive API error: " + res.status + " " + txt);
      });
    }
    return res.json();
  })
  .then(json => json.files.map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
  })));
})()
`.trim();

  const user = [
    'Task description:',
    params.task_description ?? '(none provided)',
    '',
    'Broken code:',
    params.broken_code ?? '(missing)',
    '',
    'Observed error:',
    params.error_message ?? '(missing)',
    '',
    'Return JSON: {"fixed_code": "<self-invoking snippet>", "notes": "<short summary>"}',
    'The code must follow every rule in the provided requirements.',
  ].join('\n');

  return { system, user };
};

const callOpenAI = async (apiKey: string, system: string, user: string): Promise<{ fixed_code: string; notes?: string }> => {
  log.info('[ToolGPT5GDriveFixer] 🛰️ callOpenAI invoked', {});
  const payload = {
    model: 'gpt-5',
    input: [
      { role: 'system', content: [{ type: 'input_text', text: system }] },
      { role: 'user', content: [{ type: 'input_text', text: user }] },
    ],
  };

  log.info('[ToolGPT5GDriveFixer] 📤 Sending payload to OpenAI Responses API', {}, {
    model: payload.model,
    systemLength: system.length,
    userLength: user.length,
  });

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    log.info('[ToolGPT5GDriveFixer] ❌ Network error calling OpenAI Responses API', {}, networkError);
    throw networkError;
  }

  const rawText = await response.text();
  log.info('[ToolGPT5GDriveFixer] 📥 OpenAI raw response received', {}, {
    status: response.status,
    ok: response.ok,
    textPreview: rawText.slice(0, 400),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses API error ${response.status}: ${rawText}`);
  }

  const parsed = tryParseJson<OpenAIResponse>(rawText);
  if (!parsed) throw new Error('Failed to parse OpenAI response JSON');

  const outputText = extractOutputText(parsed);
  if (!outputText) throw new Error('OpenAI response missing output text');

  const json = tryParseJson<{ fixed_code?: string; notes?: string }>(outputText);
  if (!json?.fixed_code) throw new Error('OpenAI response did not include fixed_code');

  log.info('[ToolGPT5GDriveFixer] ✅ Parsed OpenAI response', {}, {
    fixedCodeLength: json.fixed_code?.length ?? 0,
    notesLength: json.notes?.length ?? 0,
  });

  return { fixed_code: json.fixed_code, notes: json.notes };
};

/**
 * Manages GPT5 gdrive fixer tool calls between JavaScript and native Swift code.
 * Uses the OpenAI Responses API to repair failing snippets and re-evaluates them with the shared gdrive executor.
 */
export class ToolGPT5GDriveFixer {
  private readonly toolName = 'GPT5-gdrive-fixer';
  private readonly requestEventName = 'onGPT5GDriveFixerRequest';
  private readonly module: GPT5GDriveFixerNativeModule | null;
  private readonly gdriveRequirements: string;

  constructor(nativeModule: GPT5GDriveFixerNativeModule | null, gdriveRequirements: string) {
    this.module = nativeModule;
    this.gdriveRequirements = gdriveRequirements;
    log.info('[ToolGPT5GDriveFixer] ctor: nativeModule present =', {}, !!this.module);

    if (this.module) {
      log.info('[ToolGPT5GDriveFixer] Attaching listener for event:', {}, this.requestEventName);
      this.module.addListener(this.requestEventName, this.handleRequest.bind(this));
    } else {
      log.info('[ToolGPT5GDriveFixer] No native module available; event listener not attached', {});
    }
  }

  private async handleRequest(event: { requestId: string } & Partial<GPT5GDriveFixerParams>) {
    const { requestId } = event;
    log.info(`[${this.toolName}] 📥 Received request from Swift: requestId=${requestId}`, {});
    log.info(`[${this.toolName}] 📝 Event payload:`, {}, event);

    const params: GPT5GDriveFixerParams = {
      task_description: event.task_description ?? '',
      broken_code: event.broken_code ?? '',
      error_message: event.error_message ?? '',
    };

    try {
      const result = await this.performOperation(params);
      log.info(`[${this.toolName}] ✅ Operation completed: requestId=${requestId}`, {});
      this.module?.sendGPT5GDriveFixerResponse(requestId, result);
    } catch (error) {
      log.info(`[${this.toolName}] ❌ Operation failed: requestId=${requestId}`, {}, error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.module?.sendGPT5GDriveFixerResponse(requestId, JSON.stringify({ error: message }));
    }
  }

  private async performOperation(params: GPT5GDriveFixerParams): Promise<string> {
    log.info(`[${this.toolName}] 🔧 Starting performOperation`, {}, params);

    if (!params.task_description || !params.broken_code) {
      log.info(`[${this.toolName}] ⚠️ Missing required fields`, {}, {
        hasTaskDescription: Boolean(params.task_description),
        hasBrokenCode: Boolean(params.broken_code),
      });
      return JSON.stringify({ error: 'Missing task_description or broken_code' });
    }

    const apiKey = await getApiKey({ forceSecureStore: true });
    if (!apiKey) {
      log.info(`[${this.toolName}] ⚠️ OpenAI API key not configured`, {});
      return JSON.stringify({ error: 'OpenAI API key not configured' });
    }

    const { system, user } = buildPrompt(params, this.gdriveRequirements);
    log.info(`[${this.toolName}] 🧠 Generated system/user prompts`, {}, {
      systemLength: system.length,
      userLength: user.length,
    });

    let fixedCode: string;
    let notes: string | undefined;
    try {
      const result = await callOpenAI(apiKey, system, user);
      fixedCode = result.fixed_code;
      notes = result.notes;
    } catch (error) {
      log.info(`[${this.toolName}] ❌ callOpenAI failed`, {}, error);
      throw error;
    }

    log.info(`[${this.toolName}] 💡 Received fixed code from OpenAI`, {}, {
      fixedCodeLength: fixedCode.length,
      notesPreview: notes?.slice(0, 120) ?? null,
    });

    const evaluationOptions: ExecuteGDriveSnippetOptions = {
      snippet: fixedCode,
      toolName: this.toolName,
    };

    let executionResult: string;
    try {
      executionResult = await executeGDriveSnippet(evaluationOptions);
    } catch (executionError) {
      log.info(`[${this.toolName}] ❌ executeGDriveSnippet threw`, {}, executionError);
      throw executionError;
    }

    log.info(`[${this.toolName}] 🧪 executeGDriveSnippet completed`, {}, {
      serializedLength: executionResult.length,
      serializedPreview: executionResult.slice(0, 400),
    });

    const responsePayload = {
      fixed_code: fixedCode,
      evaluation_result: executionResult,
      notes: notes ?? null,
      original_error: params.error_message ?? null,
    };

    const serializedPayload = JSON.stringify(responsePayload);
    log.info(`[${this.toolName}] 📤 Returning payload to caller`, {}, {
      payloadLength: serializedPayload.length,
      payloadPreview: serializedPayload.slice(0, 400),
    });

    return serializedPayload;
  }

  async execute(params: GPT5GDriveFixerParams): Promise<string> {
    return this.performOperation(params);
  }

  async executeFromSwift(paramsJson: string): Promise<string> {
    let parsed: GPT5GDriveFixerParams | null = null;
    try {
      parsed = JSON.parse(paramsJson);
    } catch (error) {
      log.info(`[${this.toolName}] ⚠️ Failed to parse paramsJson from Swift`, {}, error);
      return JSON.stringify({ error: 'Invalid JSON payload supplied from Swift' });
    }

    return this.performOperation({
      task_description: parsed?.task_description ?? '',
      broken_code: parsed?.broken_code ?? '',
      error_message: parsed?.error_message ?? '',
    });
  }
}

export const createGPT5GDriveFixerTool = (
  nativeModule: GPT5GDriveFixerNativeModule | null,
  gdriveRequirements: string,
): ToolGPT5GDriveFixer | null => {
  if (!nativeModule) {
    log.info('[ToolGPT5GDriveFixer] Native module not available. GPT5 fixer tool will not be initialized.', {});
    return null;
  }
  return new ToolGPT5GDriveFixer(nativeModule, gdriveRequirements);
};

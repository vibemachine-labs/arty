import React, { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import EventSource from 'react-native-sse';
import { log } from '../lib/logger';
import { composeMainPrompt } from '../lib/mainPrompt';
import { getApiKey } from '../lib/secure-storage';
import toolManager from '../modules/vm-webrtc/src/ToolManager';
import { getToolkitDefinitions } from '../modules/vm-webrtc/src/ToolkitManager';
import type { ToolDefinition } from '../modules/vm-webrtc/src/VmWebrtc.types';

interface ToolCall {
  name: string;
  arguments: any;
}

interface ResponsesCreateRequest {
  model: string;
  input: string;
  instructions?: string;
  previous_response_id?: string;
  temperature?: number;
  max_output_tokens?: number;
  tools?: ToolDefinition[];
}

interface ResponsesCreateResponse {
  id: string;
  model: string;
  created: number;
  output: (| {
        id: string;
        type: "reasoning";
        summary: any[];
      }
    | {
        id: string;
        type: "function_call";
        status: string;
        arguments: string;
        call_id: string;
        name: string;
      }
    | {
        type: "message";
        content: {
          text?: string;
          [k: string]: any;
        }[];
      })[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ResponsesAPIResult {
  text: string;
  responseId: string | null;
}

interface Instrumentation {
  requestId: string;
  url: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: "ok" | "error";
  errorMessage?: string;
  responseId?: string;
  model?: string;
  requestPayload?: any;
  responsePayload?: any;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  responseText?: string;
  responseHeaders?: Record<string, string>;
}

const BASE_URL = "https://api.openai.com/v1/responses";

function genRequestId(): string {
  return `req_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function logInstrumentation(instr: Instrumentation) {
  log.info('[OpenAI Responses] instrumentation:', {}, {
    requestId: instr.requestId,
    url: instr.url,
    status: instr.status,
    durationMs: instr.durationMs,
    model: instr.model,
    responseId: instr.responseId,
    error: instr.errorMessage,
    usage: instr.usage,
    requestPayload: JSON.stringify(instr.requestPayload).slice(0, 500),
    responsePayloadSnippet:
      instr.responsePayload && typeof instr.responsePayload === "object"
        ? JSON.stringify(instr.responsePayload).slice(0, 500)
        : instr.responsePayload,
  });
}

const summarizeDescription = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length <= 60) {
    return trimmed;
  }
  const head = trimmed.slice(0, 25);
  const tail = trimmed.slice(-25);
  return `${head}…${tail}`;
};

const summarizeToolCallArguments = (args: Record<string, unknown> | null | undefined) => {
  const entries = Object.entries(args ?? {});
  const previews = entries.reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      acc[key] = {
        type: 'string',
        length: trimmed.length,
        preview: summarizeDescription(trimmed),
      };
      return acc;
    }
    if (Array.isArray(value)) {
      acc[key] = {
        type: 'array',
        length: value.length,
      };
      return acc;
    }
    if (value && typeof value === 'object') {
      acc[key] = {
        type: 'object',
        keys: Object.keys(value).slice(0, 5),
      };
      return acc;
    }
    acc[key] = {
      type: value === null ? 'null' : typeof value,
      value,
    };
    return acc;
  }, {});

  return {
    argCount: entries.length,
    argKeys: entries.map(([key]) => key),
    previews,
  };
};

// Lightweight helpers for 2-turn tool flow
type NormalizedToolCall = { id: string; name: string; argsJson: string };

function extractOutputText(resp: ResponsesCreateResponse): string {
  // Prefer output_text if present (some Responses API variants return this)
  const outputText = (resp as any).output_text;
  if (typeof outputText === 'string' && outputText.length) return outputText;

  // Fallback to flattening "message" content with text
  let combinedText = "";
  for (const outItem of resp.output ?? []) {
    if (outItem.type === 'message') {
      const segments = Array.isArray(outItem?.content) ? outItem.content : [];
      for (const c of segments) {
        if (typeof (c as any)?.text === 'string') {
          combinedText += (c as any).text;
        }
      }
    }
  }
  return combinedText;
}

function extractFirstToolCall(resp: ResponsesCreateResponse): NormalizedToolCall | null {
  // 1) Newer style: function_call item at top level
  for (const outItem of resp.output ?? []) {
    if ((outItem as any).type === 'function_call') {
      const fc = outItem as any;
      return {
        id: fc.call_id ?? fc.id ?? 'tool_call_0',
        name: fc.name,
        argsJson: typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments ?? {}),
      };
    }
  }

  // 2) Older style: tool_call inside assistant message content
  for (const outItem of resp.output ?? []) {
    if ((outItem as any).type === 'message') {
      const content = (outItem as any).content ?? [];
      const toolCall = content.find?.((c: any) => c?.type === 'tool_call');
      if (toolCall) {
        return {
          id: toolCall.id ?? 'tool_call_0',
          name: toolCall.name,
          argsJson: typeof toolCall.args === 'string' ? toolCall.args : JSON.stringify(toolCall.args ?? {}),
        };
      }
    }
  }

  return null;
}

// Streaming event types
interface StreamEvent {
  type: string;
  delta?: string;
  [key: string]: any;
}

async function callOpenAIResponsesStreaming(
  apiKey: string,
  payload: any,
  label: string,
  onChunk: (text: string) => void
): Promise<ResponsesCreateResponse> {
  const instr: Instrumentation = {
    requestId: genRequestId(),
    url: BASE_URL,
    startTime: Date.now(),
    status: "ok",
    requestPayload: { ...payload, stream: true },
  };

  return new Promise((resolve, reject) => {
    let fullResponse: any = null;
    let accumulatedText = '';
    let eventCount = 0;

    log.info('[Streaming] Starting EventSource connection', {}, { url: BASE_URL });

    const es = new EventSource(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...payload, stream: true }),
      pollingInterval: 0, // Disable polling, use true SSE
    });

    es.addEventListener('open', () => {
      log.info('[Streaming] EventSource connection opened', {}, {});
    });

    es.addEventListener('message', (event: any) => {
      eventCount++;

      try {
        if (event.data === '[DONE]') {
          log.info('[Streaming] Received [DONE] marker', {}, { eventCount });
          es.close();

          instr.endTime = Date.now();
          instr.durationMs = instr.endTime - instr.startTime;

          const finalResponse: ResponsesCreateResponse = fullResponse || {
            id: 'unknown',
            model: payload.model,
            created: Date.now(),
            output: [{
              type: 'message',
              content: [{ text: accumulatedText }]
            }]
          };

          instr.responsePayload = finalResponse;
          instr.responseId = finalResponse.id;
          instr.model = finalResponse.model;
          instr.responseText = accumulatedText;
          logInstrumentation(instr);

          resolve(finalResponse);
          return;
        }

        const parsedEvent: StreamEvent = JSON.parse(event.data);

        log.debug('[Streaming] Parsed event', {}, {
          type: parsedEvent.type,
          eventNumber: eventCount,
          hasDelta: !!parsedEvent.delta
        });

        // Handle text deltas - try multiple possible delta field names
        const delta = parsedEvent.delta || parsedEvent.text || (parsedEvent as any).output_text_delta;
        if (delta && typeof delta === 'string') {
          accumulatedText += delta;
          onChunk(delta);
          log.debug('[Streaming] Sent chunk', {}, { chunkLength: delta.length, totalLength: accumulatedText.length });
        }

        // Store the final response object
        if (parsedEvent.type === 'response.done' || parsedEvent.type === 'done') {
          fullResponse = parsedEvent.response || parsedEvent;
          log.info('[Streaming] Received response.done event', {}, { hasResponse: !!fullResponse });
        }
      } catch (parseErr) {
        log.warn('[Streaming] Failed to parse SSE event', {}, {
          data: event.data?.slice(0, 100),
          error: String(parseErr)
        });
      }
    });

    es.addEventListener('error', (error: any) => {
      log.error('[Streaming] EventSource error', {}, {
        error: String(error),
        type: error?.type,
        message: error?.message,
        eventCount,
        accumulatedTextLength: accumulatedText.length,
      });

      es.close();

      instr.endTime = Date.now();
      instr.durationMs = instr.endTime - instr.startTime;
      instr.status = "error";
      instr.errorMessage = String(error);
      logInstrumentation(instr);

      reject(new Error(`Streaming error: ${String(error)}`));
    });

    es.addEventListener('close', () => {
      log.info('[Streaming] EventSource closed', {}, {
        eventCount,
        accumulatedTextLength: accumulatedText.length
      });
    });
  });
}

async function callOpenAIResponses(apiKey: string, payload: any, label: string): Promise<ResponsesCreateResponse> {
  const instr: Instrumentation = {
    requestId: genRequestId(),
    url: BASE_URL,
    startTime: Date.now(),
    status: "ok",
    requestPayload: payload,
  };

  try {
    const resp = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    instr.endTime = Date.now();
    instr.durationMs = instr.endTime - instr.startTime;

    const headerMap: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headerMap[k] = v; });
    instr.responseHeaders = headerMap;

    const text = await resp.text();
    let json: ResponsesCreateResponse;
    try {
      json = JSON.parse(text);
    } catch (parseErr: any) {
      instr.status = "error";
      instr.errorMessage = `Failed to parse JSON (${label}): ${parseErr.message}`;
      instr.responsePayload = text;
      logInstrumentation(instr);
      throw new Error(instr.errorMessage);
    }

    instr.responsePayload = json;
    instr.responseId = (json as any).id;
    instr.model = (json as any).model;
    if ((json as any).usage) instr.usage = (json as any).usage;
    instr.responseText = extractOutputText(json);

    if (!resp.ok) {
      instr.status = "error";
      instr.errorMessage = `HTTP ${resp.status} ${resp.statusText}`;
      logInstrumentation(instr);
      throw new Error(`OpenAI Responses API error ${resp.status}: ${text}`);
    }

    logInstrumentation(instr);
    return json;
  } catch (err: any) {
    if (!instr.endTime) {
      instr.endTime = Date.now();
      instr.durationMs = instr.endTime - instr.startTime;
    }
    instr.status = "error";
    instr.errorMessage = err?.message ?? String(err);
    logInstrumentation(instr);
    throw err;
  }
}

// ADD: build second-turn input as function_call_output only (no roles)
function buildSecondTurnInput(callId: string, toolResult: unknown) {
  return [
    {
      type: "function_call_output",
      call_id: callId,
      output: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
    },
  ];
}

async function executeToolCall(toolCall: ToolCall): Promise<string> {
  const argSummary = summarizeToolCallArguments(toolCall.arguments);

  // Get all known tools for logging (includes static and dynamic MCP tools)
  const knownTools = await getToolkitDefinitions();
  const knownToolNames = toolManager.getToolNames(knownTools);

  log.info('[TextChat] Dispatching tool call to ToolManager', {}, {
    toolName: toolCall.name,
    ...argSummary,
    knownToolCount: knownTools.length,
    knownToolNames: knownToolNames,
    knownTools: knownTools,
  });

  const start = Date.now();

  try {
    const result = await toolManager.executeToolCall(toolCall.name, toolCall.arguments);
    log.info('[TextChat] Tool call completed', {}, {
      toolName: toolCall.name,
      durationMs: Date.now() - start,
      resultLength: typeof result === 'string' ? result.length : undefined,
      result: result,
      checkedToolCount: knownTools.length,
      checkedToolNames: knownToolNames,
      checkedTools: knownTools,
    });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('[TextChat] Tool call execution failed', {}, {
      toolName: toolCall.name,
      durationMs: Date.now() - start,
      errorMessage,
    });
    return `Error executing ${toolCall.name}: ${errorMessage}`;
  }
}

async function callResponsesAPIStreaming(
  apiKey: string,
  req: ResponsesCreateRequest,
  onChunk: (text: string) => void
): Promise<ResponsesAPIResult> {
  let currentPayload: any = {
    ...req,
    tool_choice: "auto",
  };

  log.info('[callResponsesAPIStreaming] Starting conversation loop', {}, {
    model: req.model,
    initialPayload: currentPayload,
    hasTools: !!req.tools,
    toolCount: req.tools?.length ?? 0,
  });

  let responseJson: any = null;
  let previousResponseId: string | null = null;
  let safetyCounter = 0;
  const MAX_TURNS = 8;

  while (safetyCounter++ < MAX_TURNS) {
    log.info(`[callResponsesAPIStreaming] Sending request to LLM (turn ${safetyCounter})`, {}, {
      turnNumber: safetyCounter,
      payload: currentPayload,
      previousResponseId: previousResponseId,
    });

    responseJson = await callOpenAIResponsesStreaming(apiKey, currentPayload, `turn_${safetyCounter}`, onChunk);

    log.info(`[callResponsesAPIStreaming] Received response from LLM (turn ${safetyCounter})`, {}, {
      turnNumber: safetyCounter,
      responseId: responseJson.id,
      responseJson: responseJson,
      outputText: extractOutputText(responseJson),
    });

    const toolCall = extractFirstToolCall(responseJson);

    // If model gives direct text output (no tool call), we're done
    if (!toolCall) {
      log.info('[callResponsesAPIStreaming] LLM returned final response (no tool call)', {}, {
        turnNumber: safetyCounter,
        outputText: extractOutputText(responseJson),
        responseId: responseJson.id,
      });
      return {
        text: extractOutputText(responseJson),
        responseId: responseJson.id ?? null,
      };
    }

    log.info('[callResponsesAPIStreaming] LLM requested tool call', {}, {
      turnNumber: safetyCounter,
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      toolArgsJson: toolCall.argsJson,
    });

    // Parse tool args
    let argsObj: any;
    try {
      argsObj = JSON.parse(toolCall.argsJson || "{}");
      log.info('[callResponsesAPIStreaming] Parsed tool arguments', {}, {
        toolName: toolCall.name,
        parsedArgs: argsObj,
      });
    } catch (err: any) {
      const errorText = `Error parsing tool call: ${err.message}`;
      log.error('[callResponsesAPIStreaming] Failed to parse tool arguments', {}, {
        toolName: toolCall.name,
        argsJson: toolCall.argsJson,
        error: err.message,
      });
      return {
        text: errorText,
        responseId: responseJson.id ?? null,
      };
    }

    // Execute tool
    const toolResult = await executeToolCall({
      name: toolCall.name,
      arguments: argsObj,
    });

    log.info('[callResponsesAPIStreaming] Tool execution completed', {}, {
      toolName: toolCall.name,
      toolResult: toolResult,
      toolResultLength: typeof toolResult === 'string' ? toolResult.length : undefined,
    });

    // Prepare next turn with function_call_output
    const nextInput = buildSecondTurnInput(toolCall.id, toolResult);
    currentPayload = {
      model: req.model,
      previous_response_id: responseJson.id,
      input: nextInput,
      instructions: req.instructions
    };

    log.info('[callResponsesAPIStreaming] Prepared next turn payload', {}, {
      turnNumber: safetyCounter + 1,
      nextPayload: currentPayload,
      toolCallId: toolCall.id,
    });

    previousResponseId = responseJson.id;
  }

  // If we exit due to too many turns, stop gracefully
  log.warn('[callResponsesAPIStreaming] Reached MAX_TURNS limit — possible infinite loop', {}, {
    maxTurns: MAX_TURNS,
    finalResponseId: responseJson?.id,
    finalOutputText: extractOutputText(responseJson),
  });
  return {
    text: extractOutputText(responseJson) || '[Loop terminated: too many tool calls]',
    responseId: responseJson?.id ?? null,
  };
}

async function callResponsesAPI(
  apiKey: string,
  req: ResponsesCreateRequest
): Promise<ResponsesAPIResult> {
  let currentPayload: any = {
    ...req,
    tool_choice: "auto",
  };

  log.info('[callResponsesAPI] Starting conversation loop', {}, {
    model: req.model,
    initialPayload: currentPayload,
    hasTools: !!req.tools,
    toolCount: req.tools?.length ?? 0,
  });

  let responseJson: any = null;
  let previousResponseId: string | null = null;
  let safetyCounter = 0; // prevent infinite loops
  const MAX_TURNS = 8;

  while (safetyCounter++ < MAX_TURNS) {
    // Send request to OpenAI
    log.info(`[callResponsesAPI] Sending request to LLM (turn ${safetyCounter})`, {}, {
      turnNumber: safetyCounter,
      payload: currentPayload,
      previousResponseId: previousResponseId,
    });

    responseJson = await callOpenAIResponses(apiKey, currentPayload, `turn_${safetyCounter}`);

    log.info(`[callResponsesAPI] Received response from LLM (turn ${safetyCounter})`, {}, {
      turnNumber: safetyCounter,
      responseId: responseJson.id,
      responseJson: responseJson,
      outputText: extractOutputText(responseJson),
    });

    const toolCall = extractFirstToolCall(responseJson);

    // If model gives direct text output (no tool call), we're done
    if (!toolCall) {
      log.info('[callResponsesAPI] LLM returned final response (no tool call)', {}, {
        turnNumber: safetyCounter,
        outputText: extractOutputText(responseJson),
        responseId: responseJson.id,
      });
      return {
        text: extractOutputText(responseJson),
        responseId: responseJson.id ?? null,
      };
    }

    log.info('[callResponsesAPI] LLM requested tool call', {}, {
      turnNumber: safetyCounter,
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      toolArgsJson: toolCall.argsJson,
    });

    // Parse tool args
    let argsObj: any;
    try {
      argsObj = JSON.parse(toolCall.argsJson || "{}");
      log.info('[callResponsesAPI] Parsed tool arguments', {}, {
        toolName: toolCall.name,
        parsedArgs: argsObj,
      });
    } catch (err: any) {
      const errorText = `Error parsing tool call: ${err.message}`;
      log.error('[callResponsesAPI] Failed to parse tool arguments', {}, {
        toolName: toolCall.name,
        argsJson: toolCall.argsJson,
        error: err.message,
      });
      return {
        text: errorText,
        responseId: responseJson.id ?? null,
      };
    }

    // Execute tool
    const toolResult = await executeToolCall({
      name: toolCall.name,
      arguments: argsObj,
    });

    log.info('[callResponsesAPI] Tool execution completed', {}, {
      toolName: toolCall.name,
      toolResult: toolResult,
      toolResultLength: typeof toolResult === 'string' ? toolResult.length : undefined,
    });

    // Prepare next turn with function_call_output
    // No need to resend tools, since we are using responses api and sending previous response id
    const nextInput = buildSecondTurnInput(toolCall.id, toolResult);
    currentPayload = {
      model: req.model,
      previous_response_id: responseJson.id,
      input: nextInput,
      instructions: req.instructions
    };

    log.info('[callResponsesAPI] Prepared next turn payload', {}, {
      turnNumber: safetyCounter + 1,
      nextPayload: currentPayload,
      toolCallId: toolCall.id,
    });

    previousResponseId = responseJson.id;
  }

  // If we exit due to too many turns, stop gracefully
  log.warn('[callResponsesAPI] Reached MAX_TURNS limit — possible infinite loop', {}, {
    maxTurns: MAX_TURNS,
    finalResponseId: responseJson?.id,
    finalOutputText: extractOutputText(responseJson),
  });
  return {
    text: extractOutputText(responseJson) || '[Loop terminated: too many tool calls]',
    responseId: responseJson?.id ?? null,
  };
}

const MessageBubble: React.FC<{ role: 'user' | 'assistant'; content: string }> = ({
  role,
  content,
}) => {
  const isUser = role === 'user';

  return (
    <View style={[styles.bubbleContainer, isUser ? styles.userAlign : styles.assistantAlign]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text
          style={[styles.bubbleText, isUser ? styles.userText : styles.assistantText]}
          selectable={true}
        >
          {content}
        </Text>
      </View>
    </View>
  );
};

const ChatInputBar: React.FC<{
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  isSending: boolean;
}> = ({ value, onChangeText, onSend, isSending }) => (
  <View style={styles.inputBar}>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="Ask anything"
      placeholderTextColor="#8E8E93"
      style={styles.textInput}
      multiline
      editable={true}
      autoCorrect={false}
    />
    <TouchableOpacity
      style={[styles.sendButton, isSending && styles.disabledSendButton]}
      onPress={onSend}
      activeOpacity={0.7}
      disabled={isSending || !value.trim()}
    >
      <Text style={styles.sendButtonLabel}>{isSending ? 'Sending…' : 'Send'}</Text>
    </TouchableOpacity>
  </View>
);

type TextChatProps = {
  mainPromptAddition: string;
};

export default function TextChat({ mainPromptAddition }: TextChatProps) {

  const [messages, setMessages] = useState<
    { id: string; role: 'user' | 'assistant'; content: string }[]
  >([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [lastResponseId, setLastResponseId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const appendMessage = (message: { role: 'user' | 'assistant'; content: string }) => {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, ...message }]);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };

  const updateLastMessage = (contentDelta: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg.role === 'assistant') {
        updated[updated.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + contentDelta,
        };
      }
      return updated;
    });
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
  };

  const handleSend = async () => {
    const userMessage = draft.trim();
    if (!userMessage || isSending) return;

    const apiKey = await getApiKey({ forceSecureStore: true });
    if (!apiKey) {
      Alert.alert('Missing API Key', 'Add your OpenAI API key in Settings to send messages.');
      return;
    }

    appendMessage({ role: 'user', content: userMessage });
    setDraft('');
    setIsSending(true);

    // Create an empty assistant message that we'll update as chunks arrive
    appendMessage({ role: 'assistant', content: '' });

    try {
      // Get Gen2 toolkit definitions already converted to ToolDefinition format with qualified names
      // This now includes dynamic MCP tools fetched from remote servers
      const toolDefinitionsFromToolkits = await getToolkitDefinitions(); // gen2
      log.info('[TextChat] Toolkit definitions resolved', {}, {
        definitions: toolDefinitionsFromToolkits,
      });

      const tools = toolDefinitionsFromToolkits;

      const toolNames = toolManager.getToolNames(tools);
      log.info('[TextChat] tools included', {}, {
        toolCount: tools.length,
        toolNames: toolNames,
        toolDefinitions: tools,
      });

      const resolvedInstructions = composeMainPrompt(mainPromptAddition);
      log.info('[TextChat] instructions composed', {}, {
        length: resolvedInstructions.length,
        additionLength: mainPromptAddition.trim().length,
        preview: summarizeDescription(resolvedInstructions),
      });

      log.info('[TextChat] Sent input to LLM, waiting for streaming reply', {}, {
        userMessage: userMessage,
        userMessageLength: userMessage.length,
      });

      const requestPayload: ResponsesCreateRequest = {
        model: 'gpt-5-mini',
        input: userMessage,
        instructions: resolvedInstructions,
        tools,
        previous_response_id: lastResponseId ?? undefined,
      };

      let responseText: string;
      let responseId: string | null;

      try {
        // Try streaming first
        log.info('[TextChat] Attempting streaming response', {}, {});
        const result = await callResponsesAPIStreaming(
          apiKey,
          requestPayload,
          (chunk) => {
            // Update the last message with each chunk
            updateLastMessage(chunk);
          }
        );
        responseText = result.text;
        responseId = result.responseId;
        log.info('[TextChat] Streaming completed successfully', {}, {
          textLength: responseText.length,
        });
      } catch (streamError) {
        log.warn('[TextChat] Streaming failed, falling back to non-streaming', {}, {
          errorMessage: streamError instanceof Error ? streamError.message : String(streamError),
          errorName: streamError instanceof Error ? streamError.name : undefined,
        });

        // Remove the empty assistant message we created for streaming
        setMessages((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && prev[prev.length - 1].content === '') {
            return prev.slice(0, -1);
          }
          return prev;
        });

        // Fallback to non-streaming
        const result = await callResponsesAPI(apiKey, requestPayload);
        responseText = result.text;
        responseId = result.responseId;

        // Add the complete message since we removed the placeholder
        appendMessage({ role: 'assistant', content: responseText });
        setLastResponseId(responseId ?? null);
        setIsSending(false);
        return; // Exit early since we've already added the message
      }

      // Final update to ensure completeness
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg.role === 'assistant') {
          updated[updated.length - 1] = {
            ...lastMsg,
            content: responseText,
          };
        }
        return updated;
      });

      setLastResponseId(responseId ?? null);
    } catch (error) {
      log.error('[TextChat] send failed', {}, {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
        error: error,
      });
      Alert.alert('Error', 'Unable to reach OpenAI. Please try again.');

      // Update the last (empty) assistant message with error
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg.role === 'assistant') {
          updated[updated.length - 1] = {
            ...lastMsg,
            content: 'I\'m having trouble replying right now. Could you try again in a moment?',
          };
        }
        return updated;
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flexContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messagesContainer}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((message) => (
            <MessageBubble key={message.id} role={message.role} content={message.content} />
          ))}
        </ScrollView>
        <ChatInputBar value={draft} onChangeText={setDraft} onSend={handleSend} isSending={isSending} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  flexContainer: { flex: 1 },
  messagesContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  bubbleContainer: {
    marginBottom: 12,
    flexDirection: 'row',
  },
  assistantAlign: {
    justifyContent: 'flex-start',
  },
  userAlign: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  assistantBubble: {
    backgroundColor: '#F2F2F7',
  },
  userBubble: {
    backgroundColor: '#007AFF',
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  assistantText: {
    color: '#1C1C1E',
  },
  userText: {
    color: '#FFFFFF',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C7C7CC',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F2F2F7',
    borderRadius: 20,
    fontSize: 16,
    lineHeight: 22,
    color: '#1C1C1E',
  },
  sendButton: {
    backgroundColor: '#007AFF',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledSendButton: {
    backgroundColor: '#8E8E93',
  },
  sendButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

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
import { log } from '../lib/logger';
import { composeMainPrompt } from '../lib/mainPrompt';
import { getApiKey } from '../lib/secure-storage';
import toolManager from '../modules/vm-webrtc/src/ToolManager';
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
  log.info('[TextChat] Dispatching tool call to ToolManager', {}, {
    toolName: toolCall.name,
    ...argSummary,
  });

  const start = Date.now();

  try {
    const result = await toolManager.executeToolCall(toolCall.name, toolCall.arguments);
    log.info('[TextChat] Tool call completed', {}, {
      toolName: toolCall.name,
      durationMs: Date.now() - start,
      resultLength: typeof result === 'string' ? result.length : undefined,
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

async function callResponsesAPI(
  apiKey: string,
  req: ResponsesCreateRequest
): Promise<ResponsesAPIResult> {
  // First turn: send prompt + tools, allow auto tool selection
  const firstPayload: any = {
    ...req,
    tool_choice: "auto",
  };

  const firstJson = await callOpenAIResponses(apiKey, firstPayload, "first");
  log.info('Received response from LLM');

  // If no tool call, return the model’s direct answer
  const toolCall = extractFirstToolCall(firstJson);
  if (!toolCall) {
    log.info('LLM does not need tool call');
    return {
      text: extractOutputText(firstJson),
      responseId: firstJson.id ?? null,
    };
  }
  log.info('LLM wants to call tool');

  // Tool call present: parse args, run the tool
  let argsObj: any;
  try {
    argsObj = JSON.parse(toolCall.argsJson || "{}");
  } catch (err: any) {
    const errorText = `Error parsing tool call: ${err.message}`;
    return {
      text: errorText,
      responseId: firstJson.id ?? null,
    };
  }

  const toolResult = await executeToolCall({
    name: toolCall.name,
    arguments: argsObj,
  });

  // Second turn: send only function_call_output with previous_response_id
  const secondInput = buildSecondTurnInput(toolCall.id, toolResult);
  const secondPayload: any = {
    model: req.model,
    previous_response_id: firstJson.id,
    input: secondInput,
    instructions: req.instructions,
  };

  const secondJson = await callOpenAIResponses(apiKey, secondPayload, "second");
  log.info('Received response from LLM');
  return {
    text: extractOutputText(secondJson),
    responseId: secondJson.id ?? null,
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
        <Text style={[styles.bubbleText, isUser ? styles.userText : styles.assistantText]}>
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
  disabled: boolean;
}> = ({ value, onChangeText, onSend, disabled }) => (
  <View style={styles.inputBar}>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="Ask anything"
      placeholderTextColor="#8E8E93"
      style={styles.textInput}
      multiline
      editable={!disabled}
      autoCorrect={false}
    />
    <TouchableOpacity
      style={[styles.sendButton, disabled && styles.disabledSendButton]}
      onPress={onSend}
      activeOpacity={0.7}
      disabled={disabled || !value.trim()}
    >
      <Text style={styles.sendButtonLabel}>{disabled ? 'Sending…' : 'Send'}</Text>
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

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || isSending) return;

    const apiKey = await getApiKey({ forceSecureStore: true });
    if (!apiKey) {
      Alert.alert('Missing API Key', 'Add your OpenAI API key in Settings to send messages.');
      return;
    }

    appendMessage({ role: 'user', content: trimmed });
    setDraft('');
    setIsSending(true);

    try {
      const tools = await toolManager.getAugmentedToolDefinitions();
      const toolNames = toolManager.getToolNames(tools);
      log.info('[TextChat] tools included:', {}, toolNames);

      const resolvedInstructions = composeMainPrompt(mainPromptAddition);
      log.info('[TextChat] instructions composed', {}, {
        length: resolvedInstructions.length,
        additionLength: mainPromptAddition.trim().length,
        preview: summarizeDescription(resolvedInstructions),
      });

      log.info(`Sent input to LLM: ${trimmed}, waiting for reply`);
      const requestPayload: ResponsesCreateRequest = {
        model: 'gpt-5-mini',
        input: trimmed,
        instructions: resolvedInstructions,
        tools,
        previous_response_id: lastResponseId ?? undefined,
        // tool_choice is added inside callResponsesAPI for first call
      };

      const { text: responseText, responseId } = await callResponsesAPI(apiKey, requestPayload);
      appendMessage({ role: 'assistant', content: responseText });
      setLastResponseId(responseId ?? null);
    } catch (error) {
      log.error('[TextChat] send failed', {}, error);
      Alert.alert('Error', 'Unable to reach OpenAI. Please try again.');
      appendMessage({
        role: 'assistant',
        content: 'I\'m having trouble replying right now. Could you try again in a moment?',
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
        <ChatInputBar value={draft} onChangeText={setDraft} onSend={handleSend} disabled={isSending} />
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

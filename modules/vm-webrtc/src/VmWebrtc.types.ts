import type { StyleProp, ViewStyle } from "react-native";
import { loadToolPromptAddition } from "../../../lib/toolPrompts";
import type { VadMode } from "../../../lib/vadPreference";

export type OnLoadEventPayload = {
  url: string;
};

export type ChangeEventPayload = {
  value: string;
};

export type VmWebrtcViewProps = {
  url: string;
  onLoad: (event: { nativeEvent: OnLoadEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};

export type BaseOpenAIConnectionOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  audioOutput?: "handset" | "speakerphone";
  voice?: string;
};

// Function tool definition (local/native tools)
export type FunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
      }
    >;
    required: string[];
  };
};

// MCP tool definition (remote MCP server tools)
// NOTE: This type is kept for reference but is no longer used in the codebase.
// Remote MCP server tools are now exported as FunctionToolDefinition to maintain
// compatibility with LLM tool calling. The actual dispatch logic checks the
// toolkit registry to determine if a tool is a remote MCP tool.
export type McpToolDefinition = {
  type: "mcp";
  server_label: string;
  server_description: string;
  server_url: string;
  headers: Record<string, string>;
  require_approval: "never" | "always" | "auto";
};

// Union type for all tool definitions
// NOTE: Currently only FunctionToolDefinition is used since remote MCP tools
// are also exported as 'function' type for LLM compatibility.
export type ToolDefinition = FunctionToolDefinition;

type ToolkitParameters = {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description: string;
    }
  >;
  required: string[];
};

export type ToolkitDefinitionBase = {
  name: string;
  group: string;
  description: string;
  supported_auth: "no_auth_required" | "api_key" | "oauth2";
  parameters: ToolkitParameters;
};

export type FunctionToolkitDefinition = ToolkitDefinitionBase & {
  type: "function";
  tool_source_file?: string;
  extra: Record<string, string>;
};

export type RemoteMcpToolkitDefinition = ToolkitDefinitionBase & {
  type: "remote_mcp_server";
  remote_mcp_server: {
    url: string;
    protocol: "sse" | "stdio" | "websocket" | "http";
    requires_auth_header?: boolean;
  };
  extra?: Record<string, string>;
  function_call_wrapper?: string;
};

export type LegacyConnectorToolkitDefinition = ToolkitDefinitionBase & {
  type: "legacy_connector";
  extra?: Record<string, string>;
};

export type ToolkitDefinition =
  | FunctionToolkitDefinition
  | RemoteMcpToolkitDefinition
  | LegacyConnectorToolkitDefinition;

export type ToolkitGroup = {
  name: string;
  description?: string;
  toolkits: ToolkitDefinition[];
};

export type ToolkitGroups = {
  byName: Record<string, ToolkitGroup>;
  list: ToolkitGroup[];
};

/**
 * Converts a ToolkitDefinition to a ToolDefinition by stripping out
 * extra fields (group, supported_auth, tool_source_file, extra).
 * This creates the format needed for LLM tool calls.
 *
 * Also appends any user-configured prompt additions to the description.
 *
 * @param toolkit - The toolkit definition to convert
 * @param includeGroupInName - If true, prepends group name to tool name (e.g., "hacker_news__showTopStories")
 */
const isFunctionToolkitDefinition = (
  toolkit: ToolkitDefinition,
): toolkit is FunctionToolkitDefinition => toolkit.type === "function";

export async function exportToolDefinition(
  toolkit: ToolkitDefinition,
  includeGroupInName = true,
  groupDescription?: string,
): Promise<ToolDefinition> {
  if (!isFunctionToolkitDefinition(toolkit)) {
    throw new Error(
      `Cannot export remote MCP toolkit "${toolkit.name}" as a function tool definition`,
    );
  }

  const toolName =
    includeGroupInName && toolkit.group
      ? `${toolkit.group}__${toolkit.name}`
      : toolkit.name;

  // Start with group description if provided
  let description = groupDescription
    ? `${groupDescription} ${toolkit.description}`
    : toolkit.description;

  // Load user-configured prompt addition
  const promptAdditionKey = `${toolkit.group}.${toolkit.name}`;

  try {
    const promptAddition = await loadToolPromptAddition(promptAdditionKey);
    if (promptAddition && promptAddition.trim().length > 0) {
      // Append the prompt addition at the end so users can "correct" the base prompt
      description = `${description}\n\n${promptAddition.trim()}`;
    }
  } catch (error) {
    // If loading fails, just use the base description
    console.warn(
      `Failed to load prompt addition for ${promptAdditionKey}:`,
      error,
    );
  }

  return {
    type: "function",
    name: toolName,
    description,
    parameters: toolkit.parameters,
  };
}

/**
 * Converts all ToolkitDefinitions in a ToolkitGroup to an array of ToolDefinitions.
 * This creates the format needed for LLM tool calls.
 *
 * @param group - The toolkit group to convert
 * @param includeGroupInName - If true, prepends group name to tool names (default: true)
 */
export async function exportToolDefinitions(
  group: ToolkitGroup,
  includeGroupInName = true,
): Promise<ToolDefinition[]> {
  const functionToolkits = group.toolkits.filter(isFunctionToolkitDefinition);
  const toolDefinitions = await Promise.all(
    functionToolkits.map((toolkit) =>
      exportToolDefinition(toolkit, includeGroupInName),
    ),
  );
  return toolDefinitions;
}

export type OpenAIConnectionOptions = BaseOpenAIConnectionOptions & {
  instructions: string;
  toolDefinitions?: ToolDefinition[];
  vadMode?: VadMode;
  audioSpeed?: number;
  maxConversationTurns?: number; // Drop entire older messages (turn-cap)
  retentionRatio?: number; // 0.0-1.0, e.g. 0.8 = keep 80% most recent
  transcriptionEnabled?: boolean; // Enable input audio transcription with Whisper
};

export type OpenAIConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed"
  | "completed"
  | "unknown";

export type IdleTimeoutEventPayload = {
  reason: "idleTimeout";
  timeoutSeconds: number;
  previousState?: OpenAIConnectionState;
  timestampMs: number;
};

export type TokenUsageEventPayload = {
  inputText?: number;
  inputAudio?: number;
  outputText?: number;
  outputAudio?: number;
  cachedInput?: number;
  responseId?: string;
  timestampMs: number;
};

export type RealtimeErrorEventPayload = {
  type?: string;
  event_id?: string | null;
  error?: {
    type?: string;
    code?: string;
    message?: string;
    param?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

export type AudioMetricsEventPayload = Record<string, unknown>;

export type TranscriptEventPayload = {
  type: "audio_transcript" | "text";
  transcript?: string;
  delta?: string;
  responseId?: string;
  itemId?: string;
  outputIndex?: number;
  contentIndex?: number;
  isDone: boolean;
  timestampMs: number;
};

export type OutboundAudioStatsEventPayload = {
  localSpeaking: boolean;
  audioLevel?: string;
  totalAudioEnergy?: string;
  energyDelta?: string;
  totalSamplesSent?: string;
  samplesDelta?: string;
  trackIdentifier?: string;
  statsId: string;
  timestampUs: string;
};

export type VoiceSessionStatusEventPayload = {
  status_update: string;
};

export type VmWebrtcModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
  onIdleTimeout: (params: IdleTimeoutEventPayload) => void;
  onTokenUsage: (params: TokenUsageEventPayload) => void;
  onRealtimeError: (params: RealtimeErrorEventPayload) => void;
  onAudioMetrics: (params: AudioMetricsEventPayload) => void;
  onTranscript: (params: TranscriptEventPayload) => void;
  onOutboundAudioStats: (params: OutboundAudioStatsEventPayload) => void;
  onVoiceSessionStatus: (params: VoiceSessionStatusEventPayload) => void;
};

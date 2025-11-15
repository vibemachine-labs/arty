import type { StyleProp, ViewStyle } from 'react-native';
import type { VadMode } from '../../../lib/vadPreference';

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
  audioOutput?: 'handset' | 'speakerphone';
  voice?: string;
};

// Function tool definition (local/native tools)
export type FunctionToolDefinition = {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
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
export type McpToolDefinition = {
  type: 'mcp';
  server_label: string;
  server_description: string;
  server_url: string;
  headers: Record<string, string>;
  require_approval: 'never' | 'always' | 'auto';
};

// Union type for all tool definitions
export type ToolDefinition = FunctionToolDefinition | McpToolDefinition;

// This is a tool definition for the new Gen2 toolkit format
export type ToolkitDefinition = {
  type: 'function' | 'remote_mcp_server';
  name: string;
  group: string
  description: string;
  supported_auth: 'no_auth_required' | 'api_key' | 'oauth2';
  tool_source_file?: string;
  // Arbitrary extra parameters passed along to the tool implementation.
  extra: Record<string, string>;
  // Remote MCP server configuration (only used when type is 'remote_mcp_server')
  remote_mcp_server?: {
    url: string;
    protocol: 'sse' | 'stdio' | 'websocket';
  };
  // These are the params that the LLM should call this tool with
  parameters: {
    type: 'object';
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

export type ToolkitGroup = {
  name: string;
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
 * @param toolkit - The toolkit definition to convert
 * @param includeGroupInName - If true, prepends group name to tool name (e.g., "hacker_news__showTopStories")
 */
export function exportToolDefinition(toolkit: ToolkitDefinition, includeGroupInName = true): ToolDefinition {
  // Handle remote MCP server toolkits
  if (toolkit.type === 'remote_mcp_server') {
    if (!toolkit.remote_mcp_server?.url) {
      throw new Error(`Remote MCP server toolkit "${toolkit.name}" is missing URL configuration`);
    }

    const serverLabel = includeGroupInName && toolkit.group
      ? `${toolkit.group}__${toolkit.name}`
      : toolkit.name;

    return {
      type: 'mcp',
      server_label: serverLabel,
      server_description: toolkit.description,
      server_url: toolkit.remote_mcp_server.url,
      headers: {}, // Empty headers for now as requested
      require_approval: 'never',
    };
  }

  // Handle function toolkits
  const toolName = includeGroupInName && toolkit.group
    ? `${toolkit.group}__${toolkit.name}`
    : toolkit.name;

  return {
    type: 'function',
    name: toolName,
    description: toolkit.description,
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
export function exportToolDefinitions(group: ToolkitGroup, includeGroupInName = true): ToolDefinition[] {
  return group.toolkits.map(toolkit => exportToolDefinition(toolkit, includeGroupInName));
}



export type OpenAIConnectionOptions = BaseOpenAIConnectionOptions & {
  instructions: string;
  toolDefinitions?: ToolDefinition[];
  vadMode?: VadMode;
  audioSpeed?: number;
  enableRecording?: boolean;
  maxConversationTurns?: number;  // Drop entire older messages (turn-cap)
  retentionRatio?: number;         // 0.0-1.0, e.g. 0.8 = keep 80% most recent
};

export type OpenAIConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed'
  | 'completed'
  | 'unknown';

export type IdleTimeoutEventPayload = {
  reason: 'idleTimeout';
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
  type: 'audio_transcript' | 'text';
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

export type VmWebrtcModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
  onIdleTimeout: (params: IdleTimeoutEventPayload) => void;
  onTokenUsage: (params: TokenUsageEventPayload) => void;
  onRealtimeError: (params: RealtimeErrorEventPayload) => void;
  onAudioMetrics: (params: AudioMetricsEventPayload) => void;
  onTranscript: (params: TranscriptEventPayload) => void;
  onOutboundAudioStats: (params: OutboundAudioStatsEventPayload) => void;
};

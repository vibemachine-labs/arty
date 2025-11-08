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

export type ToolDefinition = {
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

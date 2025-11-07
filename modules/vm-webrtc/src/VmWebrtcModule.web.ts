import { NativeModule, registerWebModule } from 'expo';

import type {
  ChangeEventPayload,
  IdleTimeoutEventPayload,
  OpenAIConnectionOptions,
  OpenAIConnectionState,
  RealtimeErrorEventPayload,
  TokenUsageEventPayload,
} from './VmWebrtc.types';
export { githubConnectorDefinition } from './ToolGithubConnector';
export { gdriveConnectorDefinition } from './ToolGDriveConnector';
export { gpt5GDriveFixerDefinition } from './ToolGPT5GDriveFixer';
export { gpt5WebSearchDefinition } from './ToolGPT5WebSearch';
export { hackerNewsToolDefinitions } from './ToolHackerNews';

type VmWebrtcModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
  onIdleTimeout: (params: IdleTimeoutEventPayload) => void;
  onTokenUsage: (params: TokenUsageEventPayload) => void;
  onRealtimeError: (params: RealtimeErrorEventPayload) => void;
};

class VmWebrtcModule extends NativeModule<VmWebrtcModuleEvents> {
  PI = Math.PI;

  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }

  hello() {
    return 'Hello world! 👋';
  }

  helloFromExpoModule() {
    return 'Hello world from module';
  }

  async openOpenAIConnectionAsync(_options: OpenAIConnectionOptions): Promise<never> {
    throw new Error('OpenAI WebRTC is only available on iOS.');
  }

  async closeOpenAIConnectionAsync(): Promise<OpenAIConnectionState> {
    return 'closed';
  }
}

const module = registerWebModule(VmWebrtcModule, 'VmWebrtcModule') as unknown as VmWebrtcModule;

export const helloFromExpoModule = () => module.helloFromExpoModule();

export const openOpenAIConnectionAsync = (options: OpenAIConnectionOptions) =>
  module.openOpenAIConnectionAsync(options);

export const closeOpenAIConnectionAsync = () => module.closeOpenAIConnectionAsync();

export default module;

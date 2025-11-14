import { NativeModule, requireOptionalNativeModule } from 'expo';

import { log } from '../../../lib/logger';
import {
  createGithubConnectorTool,
  type GithubConnectorNativeModule,
} from './ToolGithubConnector';
import { gdriveConnectorDefinition } from './ToolGDriveConnector';
import {
  createGPT5GDriveFixerTool,
  type GPT5GDriveFixerNativeModule,
} from './ToolGPT5GDriveFixer';
import {
  createGPT5WebSearchTool,
  type GPT5WebSearchNativeModule,
} from './ToolGPT5WebSearch';
import {
  createToolkitHelper,
  type ToolkitHelperNativeModule,
} from './ToolkitHelper';
import type { VadMode } from '../../../lib/vadPreference';
import toolManager from './ToolManager';
import {
    OpenAIConnectionOptions,
    OpenAIConnectionState,
    VmWebrtcModuleEvents,
} from './VmWebrtc.types';
import { getToolkitDefinitions } from './ToolkitManager';

const MODULE_NAME = 'VmWebrtc';

const makeUnavailableError = () =>
  new Error(`Native module ${MODULE_NAME} is unavailable. Rebuild the iOS app to load native code.`);

const loadModule = () => requireOptionalNativeModule<VmWebrtcModule>(MODULE_NAME);

declare class VmWebrtcModule extends NativeModule<VmWebrtcModuleEvents> {
  PI: number;
  hello(): string;
  helloFromExpoModule(): string;
  setValueAsync(value: string): Promise<void>;
  openOpenAIConnectionAsync(options: OpenAIConnectionOptions): Promise<OpenAIConnectionState>;
  closeOpenAIConnectionAsync(): Promise<OpenAIConnectionState>;
  githubOperationFromSwift(query: string): Promise<string>;
  sendGithubConnectorResponse(requestId: string, result: string): void;
  gpt5GDriveFixerOperationFromSwift(paramsJson: string): Promise<string>;
  sendGPT5GDriveFixerResponse(requestId: string, result: string): void;
  gpt5WebSearchOperationFromSwift(query: string): Promise<string>;
  sendGPT5WebSearchResponse(requestId: string, result: string): void;
  sendToolkitResponse(requestId: string, result: string): void;
  muteUnmuteOutgoingAudio(shouldMute: boolean): void;
  initializeLogfireTracing(serviceName: string, apiKey: string): Promise<void>;
  logfireEvent(tracerName: string, spanName: string, attributes?: Record<string, unknown>): void;
}

const module = loadModule();

if (!module) {
  log.warn(`[${MODULE_NAME}] Native module not found. Did you rebuild the iOS app?`);
}

// Initialize github connector tool
const githubConnectorTool = createGithubConnectorTool(module as unknown as GithubConnectorNativeModule | null);
const gpt5GDriveFixerTool = createGPT5GDriveFixerTool(
  module as unknown as GPT5GDriveFixerNativeModule | null,
  gdriveConnectorDefinition.description,
);
const gpt5WebSearchTool = createGPT5WebSearchTool(
  module as unknown as GPT5WebSearchNativeModule | null,
);

// Initialize Gen2 toolkit helper
const toolkitHelper = createToolkitHelper(module as unknown as ToolkitHelperNativeModule | null);

export const helloFromExpoModule = () => {
  if (!module) {
    throw makeUnavailableError();
  }

  return module.helloFromExpoModule();
};

export const openOpenAIConnectionAsync = async (
  options: OpenAIConnectionOptions
) => {
  if (!module) {
    throw makeUnavailableError();
  }

  const trimmedVoice = options.voice?.trim();
  const resolvedVoice = trimmedVoice && trimmedVoice.length > 0 ? trimmedVoice : 'cedar';
  const trimmedInstructions = options.instructions.trim();
  if (trimmedInstructions.length === 0) {
    throw new Error(`[${MODULE_NAME}] instructions must be a non-empty string.`);
  }
  // const toolDefinitionsWithPrompts = await toolManager.getAugmentedToolDefinitions(
  //   options.toolDefinitions,
  // );

  // log.info(`[${MODULE_NAME}] Tool definitions resolved`, {}, {
  //   definitions: toolDefinitionsWithPrompts,
  // });

  // Get Gen2 toolkit definitions already converted to ToolDefinition format with qualified names
  const toolDefinitionsFromToolkits = getToolkitDefinitions(); // gen2
  log.info(`[${MODULE_NAME}] Toolkit definitions resolved`, {}, {
    definitions: toolDefinitionsFromToolkits,
  });

  // Merge Gen1 and Gen2 tool definitions
  // const mergedToolDefinitions = [
  //   ...(toolDefinitionsWithPrompts || []),
  //   ...toolDefinitionsFromToolkits,
  // ];

  const mergedToolDefinitions = toolDefinitionsFromToolkits;

  log.info(`[${MODULE_NAME}] Merged tool definitions`, {}, {
    definitions: mergedToolDefinitions,
  });

  const resolvedVadMode: VadMode = options.vadMode === 'semantic' ? 'semantic' : 'server';

  const resolvedAudioSpeed =
    typeof options.audioSpeed === 'number'
      ? Math.min(Math.max(options.audioSpeed, 0.25), 4)
      : undefined;

  const sanitizedOptions: OpenAIConnectionOptions = {
    ...options,
    voice: resolvedVoice,
    instructions: trimmedInstructions,
    toolDefinitions: mergedToolDefinitions,
    vadMode: resolvedVadMode,
    audioSpeed: resolvedAudioSpeed,
  };

  log.debug(`[${MODULE_NAME}] openOpenAIConnectionAsync invoked`, {}, {
    hasBaseUrl: Boolean(options.baseUrl),
    hasModel: Boolean(options.model),
    audioOutput: options.audioOutput ?? 'handset',
    audioSpeed: resolvedAudioSpeed ?? 'default',
    hasInstructions: trimmedInstructions.length > 0,
    voice: resolvedVoice,
    vadMode: resolvedVadMode,
  });

  return module.openOpenAIConnectionAsync(sanitizedOptions);
};

export const closeOpenAIConnectionAsync = () => {
  if (!module) {
    throw makeUnavailableError();
  }

  log.debug(`[${MODULE_NAME}] closeOpenAIConnectionAsync invoked`);

  return module.closeOpenAIConnectionAsync();
};

export const muteUnmuteOutgoingAudio = (shouldMute: boolean) => {
  if (!module) {
    throw makeUnavailableError();
  }

  log.debug(`[${MODULE_NAME}] muteUnmuteOutgoingAudio invoked`, {}, { shouldMute });
  module.muteUnmuteOutgoingAudio(shouldMute);
};

// Github Connector function that can be called from Swift
// Uses the Github API
export const githubConnector = async (params: { self_contained_javascript_octokit_code_snippet: string }): Promise<string> => {
  if (!githubConnectorTool) {
    throw makeUnavailableError();
  }

  return githubConnectorTool.execute(params);
};

// Github Connector bridge function - calls JS github connector from Swift
export const githubOperationFromSwift = async (codeSnippet: string): Promise<string> => {
  if (!githubConnectorTool) {
    throw makeUnavailableError();
  }

  return githubConnectorTool.executeFromSwift(codeSnippet);
};

// Export tool instances for direct access if needed
export { githubConnectorTool, gpt5GDriveFixerTool, gpt5WebSearchTool };

// This call loads the native module object from the JSI.
export default (module ?? ({} as VmWebrtcModule));

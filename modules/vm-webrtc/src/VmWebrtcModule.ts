import { NativeModule, requireOptionalNativeModule } from 'expo';

import { log } from '../../../lib/logger';
import { composePrompt } from '../../../lib/promptStorage';
import { loadToolPromptAddition } from '../../../lib/toolPrompts';
import {
  createGithubConnectorTool,
  githubConnectorDefinition,
  type GithubConnectorNativeModule,
} from './ToolGithubConnector';
import { gdriveConnectorDefinition } from './ToolGDriveConnector';
import {
  createGPT5GDriveFixerTool,
  gpt5GDriveFixerDefinition,
  type GPT5GDriveFixerNativeModule,
} from './ToolGPT5GDriveFixer';
import {
  createGPT5WebSearchTool,
  gpt5WebSearchDefinition,
  type GPT5WebSearchNativeModule,
} from './ToolGPT5WebSearch';
import type { VadMode } from '../../../lib/vadPreference';

import {
    OpenAIConnectionOptions,
    OpenAIConnectionState,
    ToolDefinition,
    VmWebrtcModuleEvents,
} from './VmWebrtc.types';

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
  muteUnmuteOutgoingAudio(shouldMute: boolean): void;
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

const defaultToolDefinitions: ToolDefinition[] = [
  githubConnectorDefinition,
  gdriveConnectorDefinition,
  gpt5GDriveFixerDefinition,
  gpt5WebSearchDefinition,
];

const summarizeDescription = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length <= 60) {
    return trimmed;
  }
  const head = trimmed.slice(0, 25);
  const tail = trimmed.slice(-25);
  return `${head}…${tail}`;
};

const applyToolPromptAdditions = async (
  definitions: ToolDefinition[]
): Promise<ToolDefinition[]> => {
  return Promise.all(
    definitions.map(async (definition) => {
      const addition = await loadToolPromptAddition(definition.name);
      const trimmedAddition = addition.trim();
      const beforeLength = definition.description.length;

      if (trimmedAddition.length === 0) {
        log.debug(`[${MODULE_NAME}] Tool definition unchanged`, {}, {
          toolName: definition.name,
          descriptionLength: beforeLength,
          description: definition.description,
          descriptionPreview: summarizeDescription(definition.description),
        });
        return { ...definition };
      }

      const composedDescription = composePrompt(
        definition.description,
        trimmedAddition
      );

      log.info(`[${MODULE_NAME}] Tool definition augmented`, {}, {
        toolName: definition.name,
        beforeLength,
        afterLength: composedDescription.length,
        beforeDescription: definition.description,
        afterDescription: composedDescription,
        addition: trimmedAddition,
        beforePreview: summarizeDescription(definition.description),
        additionLength: trimmedAddition.length,
        additionPreview: summarizeDescription(trimmedAddition),
        afterPreview: summarizeDescription(composedDescription),
      });

      return {
        ...definition,
        description: composedDescription,
      };
    })
  );
};

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
  const providedToolDefinitions = options.toolDefinitions ?? [];
  const mergedToolDefinitions = [
    ...providedToolDefinitions,
    ...defaultToolDefinitions.filter(
      (defaultDef) => !providedToolDefinitions.some((providedDef) => providedDef.name === defaultDef.name),
    ),
  ];

  const toolDefinitionsWithPrompts = await applyToolPromptAdditions(
    mergedToolDefinitions
  );

  log.info(`[${MODULE_NAME}] Tool definitions resolved`, {}, {
    definitionsCount: toolDefinitionsWithPrompts.length,
    definitions: toolDefinitionsWithPrompts,
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
    toolDefinitions: toolDefinitionsWithPrompts,
    vadMode: resolvedVadMode,
    audioSpeed: resolvedAudioSpeed,
  };

  // Log API key with first 4 and last 4 characters visible
  const apiKeyPreview = options.apiKey && options.apiKey.length >= 8
    ? `${options.apiKey.slice(0, 4)}...${options.apiKey.slice(-4)}`
    : '(too short to preview)';

  log.debug(`[${MODULE_NAME}] openOpenAIConnectionAsync invoked`, {}, {
    apiKeyPreview,
    hasApiKey: Boolean(options.apiKey),
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

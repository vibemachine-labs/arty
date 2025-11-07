import { requireOptionalNativeModule } from 'expo-modules-core';

import { log } from '../../../lib/logger';
import { composePrompt } from '../../../lib/promptStorage';
import { loadToolPromptAddition } from '../../../lib/toolPrompts';
import {
  ToolGDriveConnector,
  gdriveConnectorDefinition,
  type GDriveConnectorNativeModule,
  type GDriveConnectorParams,
} from './ToolGDriveConnector';
import {
  ToolGithubConnector,
  githubConnectorDefinition,
  type GithubConnectorNativeModule,
  type GithubConnectorParams,
} from './ToolGithubConnector';
import { gpt5GDriveFixerDefinition } from './ToolGPT5GDriveFixer';
import { gpt5WebSearchDefinition } from './ToolGPT5WebSearch';
import type { ToolDefinition } from './VmWebrtc.types';

type ToolCallArguments = Record<string, any>;

const MODULE_NAME = 'VmWebrtc';

const summarizeDescription = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length <= 60) {
    return trimmed;
  }
  const head = trimmed.slice(0, 25);
  const tail = trimmed.slice(-25);
  return `${head}…${tail}`;
};

const cloneDefinition = (definition: ToolDefinition): ToolDefinition => ({
  ...definition,
  parameters: {
    ...definition.parameters,
    properties: { ...definition.parameters.properties },
    required: [...definition.parameters.required],
  },
});

class ToolManager {
  private readonly defaultDefinitions: ToolDefinition[] = [
    githubConnectorDefinition,
    gdriveConnectorDefinition,
    gpt5GDriveFixerDefinition,
    gpt5WebSearchDefinition,
  ];

  private githubConnectorTool: ToolGithubConnector | null | undefined;
  private gdriveConnectorTool: ToolGDriveConnector | null | undefined;
  private readonly nativeModule = requireOptionalNativeModule(MODULE_NAME);

  private getGithubConnectorTool(): ToolGithubConnector | null {
    if (this.githubConnectorTool !== undefined) {
      return this.githubConnectorTool;
    }
    this.githubConnectorTool = this.nativeModule
      ? new ToolGithubConnector(this.nativeModule as GithubConnectorNativeModule)
      : null;
    return this.githubConnectorTool;
  }

  private getGDriveConnectorTool(): ToolGDriveConnector | null {
    if (this.gdriveConnectorTool !== undefined) {
      return this.gdriveConnectorTool;
    }
    this.gdriveConnectorTool = this.nativeModule
      ? new ToolGDriveConnector(this.nativeModule as GDriveConnectorNativeModule)
      : null;
    return this.gdriveConnectorTool;
  }

  getCanonicalToolDefinitions(overrides?: ToolDefinition[]): ToolDefinition[] {
    const provided = overrides ? overrides.map(cloneDefinition) : [];
    const merged = [
      ...provided,
      ...this.defaultDefinitions
        .map(cloneDefinition)
        .filter((def) => !provided.some((p) => p.name === def.name)),
    ];
    return merged;
  }

  async getAugmentedToolDefinitions(overrides?: ToolDefinition[]): Promise<ToolDefinition[]> {
    const canonical = this.getCanonicalToolDefinitions(overrides);
    return Promise.all(canonical.map((definition) => this.applyPromptAddition(definition)));
  }

  getToolNames(definitions: ToolDefinition[]): string[] {
    return definitions
      .map((definition) => definition?.name)
      .filter((name): name is string => Boolean(name));
  }

  async executeToolCall(toolName: string, args: ToolCallArguments): Promise<string> {
    log.info('[ToolManager] Tool call requested', {}, { toolName });

    if (toolName === 'github_connector') {
      const connector = this.getGithubConnectorTool();
      if (!connector) {
        return 'GitHub connector tool is not available';
      }

      const params: GithubConnectorParams = {
        self_contained_javascript_octokit_code_snippet:
          args.self_contained_javascript_octokit_code_snippet,
      };

      try {
        return await connector.execute(params);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[ToolManager] GitHub connector execution failed', {}, errorMessage);
        return `Error executing GitHub connector: ${errorMessage}`;
      }
    }

    if (toolName === 'gdrive_connector') {
      const connector = this.getGDriveConnectorTool();
      if (!connector) {
        return 'Google Drive connector tool is not available';
      }

      const params: GDriveConnectorParams = {
        self_contained_javascript_gdrive_code_snippet:
          args.self_contained_javascript_gdrive_code_snippet,
      };

      try {
        return await connector.execute(params);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[ToolManager] Google Drive connector execution failed', {}, errorMessage);
        return `Error executing Google Drive connector: ${errorMessage}`;
      }
    }

    return `Unknown tool: ${toolName}`;
  }

  private async applyPromptAddition(definition: ToolDefinition): Promise<ToolDefinition> {
    const addition = await loadToolPromptAddition(definition.name);
    const trimmedAddition = addition.trim();
    const beforeLength = definition.description.length;

    if (trimmedAddition.length === 0) {
      log.info('[ToolManager] Tool definition unchanged', {}, {
        toolName: definition.name,
        descriptionLength: beforeLength,
        description: definition.description,
        descriptionPreview: summarizeDescription(definition.description),
      });
      return { ...definition };
    }

    const composedDescription = composePrompt(definition.description, trimmedAddition);

    log.info('[ToolManager] Tool definition augmented', {}, {
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
  }
}

const sharedToolManager = new ToolManager();

export default sharedToolManager;
export { ToolManager };

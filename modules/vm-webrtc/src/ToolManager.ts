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
import { toolkitRegistry } from './toolkit_functions/index';
import type { ToolDefinition } from './VmWebrtc.types';
import { getRawToolkitDefinitions } from './ToolkitManager';
import { MCPClient } from './mcp_client/client';

type ToolCallArguments = Record<string, any>;

const MODULE_NAME = 'VmWebrtc';

// Feature flag to enable/disable legacy gdrive connector
// Set to false since we now have gen2 google_drive toolkit
const ENABLE_LEGACY_GDRIVE = false;

const summarizeDescription = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length <= 60) {
    return trimmed;
  }
  const head = trimmed.slice(0, 25);
  const tail = trimmed.slice(-25);
  return `${head}…${tail}`;
};

const summarizeSnippetArgument = (value: unknown) => {
  if (typeof value !== 'string') {
    return {
      snippetProvided: Boolean(value),
      snippetType: value === null ? 'null' : typeof value,
    };
  }
  const trimmed = value.trim();
  return {
    snippetProvided: trimmed.length > 0,
    snippetLength: trimmed.length,
    snippetPreview: summarizeDescription(trimmed),
  };
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
    ...(ENABLE_LEGACY_GDRIVE ? [gdriveConnectorDefinition] : []),
    gpt5GDriveFixerDefinition,
    gpt5WebSearchDefinition,
  ];

  private githubConnectorTool: ToolGithubConnector | null | undefined;
  private gdriveConnectorTool: ToolGDriveConnector | null | undefined;
  private readonly nativeModule = requireOptionalNativeModule(MODULE_NAME);

  constructor() {
    if (!this.nativeModule) {
      log.warn('[ToolManager] Native module unavailable during initialization; tool listeners inactive until module loads');
      return;
    }

    log.info('[ToolManager] Native module detected, prewarming tool listeners');
    this.prewarmNativeToolListeners();
  }

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

  private prewarmNativeToolListeners() {
    try {
      const github = this.getGithubConnectorTool();
      const gdrive = ENABLE_LEGACY_GDRIVE ? this.getGDriveConnectorTool() : null;
      log.info('[ToolManager] Tool listener prewarm complete', {}, {
        githubListenerActive: Boolean(github),
        gdriveListenerActive: Boolean(gdrive),
        legacyGDriveEnabled: ENABLE_LEGACY_GDRIVE,
      });
    } catch (error) {
      log.error('[ToolManager] Failed to prewarm native tool listeners', {}, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
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
      .map((definition) => {
        if (!definition) return undefined;
        // All tools are now exported as 'function' type
        return definition.name;
      })
      .filter((name): name is string => Boolean(name));
  }

  private isRemoteMcpTool(groupName: string, toolName: string): boolean {
    try {
      const rawToolkits = getRawToolkitDefinitions();
      const toolkit = rawToolkits.find(
        (t) => t.group === groupName && t.name === toolName
      );
      return toolkit?.type === 'remote_mcp_server';
    } catch (error) {
      log.error('[ToolManager] Error checking if tool is remote MCP', {}, {
        groupName,
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async executeRemoteMcpToolCall(
    groupName: string,
    toolName: string,
    args: ToolCallArguments
  ): Promise<string> {
    log.info('[ToolManager] Executing remote MCP tool', {}, {
      groupName,
      toolName,
      args,
    });

    // Get the toolkit definition to find the remote MCP server URL
    const rawToolkits = getRawToolkitDefinitions();
    const toolkit = rawToolkits.find(
      (t) => t.group === groupName && t.name === toolName
    );

    if (!toolkit || toolkit.type !== 'remote_mcp_server') {
      const errorMsg = `Remote MCP toolkit not found: ${groupName}__${toolName}`;
      log.error('[ToolManager] Remote MCP toolkit not found', {}, {
        groupName,
        toolName,
      });
      return errorMsg;
    }

    if (!toolkit.remote_mcp_server?.url) {
      const errorMsg = `Remote MCP server URL not configured for ${groupName}__${toolName}`;
      log.error('[ToolManager] Remote MCP server URL missing', {}, {
        groupName,
        toolName,
      });
      return errorMsg;
    }

    try {
      const mcpClient = new MCPClient(toolkit.remote_mcp_server.url);
      const result = await mcpClient.callTool({
        name: toolName,
        arguments: args,
      });

      log.info('[ToolManager] Remote MCP tool execution succeeded', {}, {
        groupName,
        toolName,
        serverUrl: toolkit.remote_mcp_server.url,
        isError: result.isError,
        result: result,
      });

      // Return the entire result as JSON string
      return JSON.stringify(result, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('[ToolManager] Remote MCP tool execution failed', {}, {
        groupName,
        toolName,
        serverUrl: toolkit.remote_mcp_server?.url,
        errorMessage,
      });
      return `Error executing remote MCP tool ${groupName}__${toolName}: ${errorMessage}`;
    }
  }

  private async executeGen2ToolCall(
    groupName: string,
    toolName: string,
    args: ToolCallArguments
  ): Promise<string> {
    log.info('[ToolManager] Executing gen2 tool', {}, {
      groupName,
      toolName,
      args,
    });

    const group = toolkitRegistry[groupName];
    if (!group) {
      return `Unknown gen2 tool group: ${groupName}`;
    }

    const toolFunction = group[toolName];
    if (!toolFunction) {
      return `Unknown gen2 tool: ${groupName}__${toolName}`;
    }

    try {
      const result = await toolFunction(args);
      log.info('[ToolManager] Gen2 tool execution succeeded', {}, {
        groupName,
        toolName,
        resultLength: result.length,
        result: result,
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('[ToolManager] Gen2 tool execution failed', {}, {
        groupName,
        toolName,
        errorMessage,
      });
      return `Error executing gen2 tool ${groupName}__${toolName}: ${errorMessage}`;
    }
  }

  async executeToolCall(toolName: string, args: ToolCallArguments): Promise<string> {
    log.info('[ToolManager] Tool call requested', {}, {
      toolName,
      args,
    });

    // Check if this is a gen2 tool (format: groupName__toolName)
    if (toolName.includes('__')) {
      const [groupName, toolFunctionName] = toolName.split('__');

      // Check if this is a remote MCP server tool
      if (this.isRemoteMcpTool(groupName, toolFunctionName)) {
        return this.executeRemoteMcpToolCall(groupName, toolFunctionName, args);
      }

      // Execute local gen2 tools
      if (toolkitRegistry[groupName]?.[toolFunctionName]) {
        return this.executeGen2ToolCall(groupName, toolFunctionName, args);
      }
    }

    if (toolName === 'github_connector') {
      const connector = this.getGithubConnectorTool();
      if (!connector) {
        log.warn('[ToolManager] GitHub connector unavailable', {}, {
          nativeModuleLoaded: Boolean(this.nativeModule),
        });
        return 'GitHub connector tool is not available';
      }

      const params: GithubConnectorParams = {
        self_contained_javascript_octokit_code_snippet:
          args.self_contained_javascript_octokit_code_snippet,
      };
      log.debug('[ToolManager] Routing GitHub connector request', {}, summarizeSnippetArgument(
        args.self_contained_javascript_octokit_code_snippet
      ));

      try {
        const result = await connector.execute(params);
        log.info('[ToolManager] GitHub connector execution succeeded', {}, {
          resultLength: typeof result === 'string' ? result.length : 0,
          result: result,
        });
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[ToolManager] GitHub connector execution failed', {}, errorMessage);
        return `Error executing GitHub connector: ${errorMessage}`;
      }
    }

    if (toolName === 'gdrive_connector') {
      const connector = this.getGDriveConnectorTool();
      if (!connector) {
        log.warn('[ToolManager] Google Drive connector unavailable', {}, {
          nativeModuleLoaded: Boolean(this.nativeModule),
        });
        return 'Google Drive connector tool is not available';
      }

      const params: GDriveConnectorParams = {
        self_contained_javascript_gdrive_code_snippet:
          args.self_contained_javascript_gdrive_code_snippet,
      };
      log.debug('[ToolManager] Routing Google Drive connector request', {}, summarizeSnippetArgument(
        args.self_contained_javascript_gdrive_code_snippet
      ));

      try {
        const result = await connector.execute(params);
        log.info('[ToolManager] Google Drive connector execution succeeded', {}, {
          resultLength: typeof result === 'string' ? result.length : 0,
          result: result,
        });
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[ToolManager] Google Drive connector execution failed', {}, errorMessage);
        return `Error executing Google Drive connector: ${errorMessage}`;
      }
    }

    return `Unknown tool: ${toolName}`;
  }

  private async applyPromptAddition(definition: ToolDefinition): Promise<ToolDefinition> {
    // All tools are now exported as 'function' type, including remote MCP tools
    // Apply prompt additions to all function tools
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

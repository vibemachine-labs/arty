import { requireOptionalNativeModule } from 'expo-modules-core';

import { log } from '../../../lib/logger';
import { composePrompt } from '../../../lib/promptStorage';
import { loadToolPromptAddition } from '../../../lib/toolPrompts';
import {
  ToolGDriveConnector,
  type GDriveConnectorNativeModule,
  type GDriveConnectorParams,
} from './ToolGDriveConnector';
import {
  ToolGithubConnector,
  type GithubConnectorNativeModule,
  type GithubConnectorParams,
} from './ToolGithubConnector';
import { defaultToolDefinitions } from './ToolGroups';
import type { ToolDefinition } from './VmWebrtc.types';

type ToolCallArguments = Record<string, any>;

const MODULE_NAME = 'VmWebrtc';

const GITHUB_LIST_ORGANIZATIONS_SNIPPET = `(() => {
  console.log('Listing organizations for', authenticated_github_user);
  return octokit
    .paginate(octokit.rest.orgs.listForAuthenticatedUser, { per_page: 50 })
    .then((orgs) => orgs.map((org) => ({
      id: org.id,
      login: org.login,
      description: org.description,
      url: org.html_url,
    })));
})()`;

const GDRIVE_LIST_FOLDERS_SNIPPET = `(() => {
  console.log('Listing top-level folders in Drive');
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.folder' and 'root' in parents",
    fields: "files(id,name,modifiedTime,ownedByMe)",
    orderBy: "name",
    pageSize: "25",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });

  return fetch("https://www.googleapis.com/drive/v3/files?" + params.toString(), {
    headers: { Authorization: "Bearer " + accessToken },
  })
    .then((res) => {
      if (!res.ok) {
        return res.text().then((txt) => {
          throw new Error('Drive API error: ' + res.status + ' ' + txt);
        });
      }
      return res.json();
    })
    .then((json) => (json.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      modifiedTime: file.modifiedTime,
      ownedByMe: file.ownedByMe,
    })));
})()`;

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
      const gdrive = this.getGDriveConnectorTool();
      log.info('[ToolManager] Tool listener prewarm complete', {}, {
        githubListenerActive: Boolean(github),
        gdriveListenerActive: Boolean(gdrive),
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
      ...defaultToolDefinitions
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
    const argKeys = Object.keys(args ?? {});
    log.info('[ToolManager] Tool call requested', {}, {
      toolName,
      argCount: argKeys.length,
      argKeys,
    });

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
        });
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[ToolManager] GitHub connector execution failed', {}, errorMessage);
        return `Error executing GitHub connector: ${errorMessage}`;
      }
    }

    if (toolName === 'github_list_organizations') {
      const connector = this.getGithubConnectorTool();
      if (!connector) {
        log.warn('[ToolManager] GitHub list organizations unavailable', {}, {
          nativeModuleLoaded: Boolean(this.nativeModule),
        });
        return 'GitHub list organizations tool is not available';
      }

      const params: GithubConnectorParams = {
        self_contained_javascript_octokit_code_snippet: GITHUB_LIST_ORGANIZATIONS_SNIPPET,
      };
      log.debug('[ToolManager] Executing GitHub organization inventory helper', {}, summarizeSnippetArgument(
        GITHUB_LIST_ORGANIZATIONS_SNIPPET
      ));

      try {
        const result = await connector.execute(params);
        log.info('[ToolManager] GitHub organization inventory completed', {}, {
          resultLength: typeof result === 'string' ? result.length : 0,
        });
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[ToolManager] GitHub organization inventory failed', {}, errorMessage);
        return `Error executing GitHub organization inventory: ${errorMessage}`;
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
        });
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[ToolManager] Google Drive connector execution failed', {}, errorMessage);
        return `Error executing Google Drive connector: ${errorMessage}`;
      }
    }

    if (toolName === 'gdrive_list_folders') {
      const connector = this.getGDriveConnectorTool();
      if (!connector) {
        log.warn('[ToolManager] Google Drive list folders unavailable', {}, {
          nativeModuleLoaded: Boolean(this.nativeModule),
        });
        return 'Google Drive list folders tool is not available';
      }

      const params: GDriveConnectorParams = {
        self_contained_javascript_gdrive_code_snippet: GDRIVE_LIST_FOLDERS_SNIPPET,
      };
      log.debug('[ToolManager] Executing Google Drive folder inventory helper', {}, summarizeSnippetArgument(
        GDRIVE_LIST_FOLDERS_SNIPPET
      ));

      try {
        const result = await connector.execute(params);
        log.info('[ToolManager] Google Drive folder inventory completed', {}, {
          resultLength: typeof result === 'string' ? result.length : 0,
        });
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[ToolManager] Google Drive folder inventory failed', {}, errorMessage);
        return `Error executing Google Drive folder inventory: ${errorMessage}`;
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

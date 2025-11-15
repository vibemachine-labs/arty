import toolkitGroupsData from '../toolkits/toolkitGroups.json';

import type {
  ToolDefinition,
  ToolkitDefinition,
  ToolkitGroup,
  ToolkitGroups,
  RemoteMcpToolkitDefinition,
} from './VmWebrtc.types';
import { exportToolDefinition } from './VmWebrtc.types';
import { MCPClient } from './mcp_client/client';
import { log } from '../../../lib/logger';
import type { Tool } from './mcp_client/types';
import { registerMcpTool } from './toolkit_functions/index';

const buildToolkitGroups = (): ToolkitGroups => {
  const data = toolkitGroupsData as unknown as ToolkitGroups;
  const byName = data.byName ?? {};
  const list = Array.isArray(data.list) ? data.list : Object.values(byName);

  return {
    byName,
    list,
  };
};

const toolkitGroups = buildToolkitGroups();

export const getToolkitGroups = (): ToolkitGroups => toolkitGroups;

// Cache for toolkit definitions to avoid repeated MCP server calls
let toolkitDefinitionsCache: ToolDefinition[] | null = null;
let toolkitDefinitionsPromise: Promise<ToolDefinition[]> | null = null;

/**
 * Convert MCP Tool to ToolDefinition format
 */
function mcpToolToToolDefinition(tool: Tool, groupName: string): ToolDefinition {
  // Convert MCP input schema properties to our format
  const properties: Record<string, { type: string; description: string }> = {};
  const mcpProperties = tool.inputSchema?.properties || {};

  for (const [key, value] of Object.entries(mcpProperties)) {
    properties[key] = {
      type: (value as any)?.type || 'string',
      description: (value as any)?.description || '',
    };
  }

  return {
    type: 'function',
    name: `${groupName}__${tool.name}`,
    description: tool.description || '',
    parameters: {
      type: 'object',
      properties,
      required: tool.inputSchema?.required || [],
    },
  };
}

/**
 * Gets all toolkit definitions and converts them to tool definitions with
 * fully qualified names (group:name format, e.g., "hacker_news:showTopStories").
 *
 * For remote MCP servers, this fetches the actual tools dynamically from the server
 * on the first call, then caches them for subsequent calls.
 */
export const getToolkitDefinitions = async (): Promise<ToolDefinition[]> => {
  // Return cached result if available
  if (toolkitDefinitionsCache) {
    log.info('[ToolkitManager] Returning cached toolkit definitions', {}, {
      count: toolkitDefinitionsCache.length,
    });
    return toolkitDefinitionsCache;
  }

  // If a fetch is already in progress, return that promise
  if (toolkitDefinitionsPromise) {
    log.info('[ToolkitManager] Toolkit definitions fetch already in progress, awaiting...', {}, {});
    return toolkitDefinitionsPromise;
  }

  // Start fetching and cache the promise
  toolkitDefinitionsPromise = fetchToolkitDefinitions();

  try {
    const result = await toolkitDefinitionsPromise;
    toolkitDefinitionsCache = result;
    return result;
  } catch (error) {
    // Reset promise on error so next call can retry
    toolkitDefinitionsPromise = null;
    throw error;
  }
};

/**
 * Internal function that actually fetches toolkit definitions.
 */
async function fetchToolkitDefinitions(): Promise<ToolDefinition[]> {
  const staticTools: ToolDefinition[] = [];
  const remoteMcpToolkits = getRawToolkitDefinitions().filter(
    (toolkit): toolkit is RemoteMcpToolkitDefinition => toolkit.type === 'remote_mcp_server'
  );

  // Export static (non-MCP) toolkits
  for (const group of toolkitGroups.list) {
    for (const toolkit of group.toolkits) {
      if (toolkit.type !== 'remote_mcp_server') {
        staticTools.push(exportToolDefinition(toolkit, true));
      }
    }
  }

  // Fetch dynamic tools from remote MCP servers
  const dynamicTools: ToolDefinition[] = [];
  for (const toolkit of remoteMcpToolkits) {
    if (!toolkit.remote_mcp_server?.url) {
      log.warn('[ToolkitManager] Skipping remote MCP toolkit without URL', {}, {
        name: toolkit.name,
        group: toolkit.group,
      });
      continue;
    }

    const serverUrl = toolkit.remote_mcp_server.url;

    try {
      log.info('[ToolkitManager] Fetching tools from remote MCP server for toolkit definitions', {}, {
        name: toolkit.name,
        group: toolkit.group,
        url: serverUrl,
      });

      const client = new MCPClient(serverUrl);
      const result = await client.listTools();

      if (result.tools && result.tools.length > 0) {
        const convertedTools = result.tools.map((tool) =>
          mcpToolToToolDefinition(tool, toolkit.group)
        );
        dynamicTools.push(...convertedTools);

        // Register each MCP tool in the toolkit registry for caching
        for (const tool of result.tools) {
          const mcpClient = new MCPClient(serverUrl);
          const toolFunction = async (args: any) => {
            log.info('[ToolkitManager] Executing cached MCP tool', {}, {
              group: toolkit.group,
              toolName: tool.name,
              serverUrl,
            });

            const result = await mcpClient.callTool({
              name: tool.name,
              arguments: args,
            });

            // Return the result as JSON string
            return JSON.stringify(result, null, 2);
          };

          registerMcpTool(toolkit.group, tool.name, toolFunction);
        }

        log.info('[ToolkitManager] Successfully loaded and cached MCP tools', {}, {
          group: toolkit.group,
          toolCount: convertedTools.length,
          tools: convertedTools.map((t) => t.name),
        });
      }
    } catch (error) {
      log.error('[ToolkitManager] Failed to fetch tools from MCP server for toolkit definitions', {}, {
        name: toolkit.name,
        group: toolkit.group,
        url: serverUrl,
        error: error instanceof Error ? error.message : String(error),
      }, error);
      // Continue with other servers even if one fails
    }
  }

  const allTools = [...staticTools, ...dynamicTools];
  log.info('[ToolkitManager] Total toolkit definitions loaded', {}, {
    staticCount: staticTools.length,
    dynamicCount: dynamicTools.length,
    totalCount: allTools.length,
  });

  return allTools;
};

/**
 * Gets raw toolkit definitions without conversion (for internal use).
 */
export const getRawToolkitDefinitions = (): ToolkitDefinition[] => {
  return toolkitGroups.list.flatMap((group) => group.toolkits);
};

/**
 * Clears the toolkit definitions cache, forcing a fresh fetch on next call.
 * Useful for testing or when MCP servers are updated.
 */
export const clearToolkitDefinitionsCache = (): void => {
  log.info('[ToolkitManager] Clearing toolkit definitions cache', {}, {});
  toolkitDefinitionsCache = null;
  toolkitDefinitionsPromise = null;
};

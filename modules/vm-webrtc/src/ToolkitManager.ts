import toolkitGroupsData from '../toolkits/toolkitGroups.json';

import type { ToolDefinition, ToolkitDefinition, ToolkitGroup, ToolkitGroups } from './VmWebrtc.types';
import { exportToolDefinition } from './VmWebrtc.types';
import { MCPClient } from './mcp_client/client';
import { log } from '../../../lib/logger';
import type { Tool } from './mcp_client/types';

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

/**
 * Gets all toolkit definitions and converts them to tool definitions with
 * fully qualified names (group:name format, e.g., "hacker_news:showTopStories").
 */
export const getToolkitDefinitions = (): ToolDefinition[] => {
  return toolkitGroups.list.flatMap((group) =>
    group.toolkits.map((toolkit) => exportToolDefinition(toolkit, true))
  );
};

/**
 * Gets raw toolkit definitions without conversion (for internal use).
 */
export const getRawToolkitDefinitions = (): ToolkitDefinition[] => {
  return toolkitGroups.list.flatMap((group) => group.toolkits);
};

/**
 * Gets tools from remote MCP servers by finding all ToolkitDefinitions
 * with type 'remote_mcp_server' and fetching their tool lists.
 */
export const getRemoteMcpServerTools = async (): Promise<Tool[]> => {
  log.info('[ToolkitManager] Starting remote MCP server tool discovery', {}, {});

  // Find all remote MCP server toolkit definitions
  const remoteMcpToolkits = getRawToolkitDefinitions().filter(
    (toolkit) => toolkit.type === 'remote_mcp_server'
  );

  log.info('[ToolkitManager] Found remote MCP servers', {}, {
    count: remoteMcpToolkits.length,
    servers: remoteMcpToolkits.map((t) => ({
      name: t.name,
      group: t.group,
      url: t.remote_mcp_server?.url,
    })),
  });

  if (remoteMcpToolkits.length === 0) {
    log.info('[ToolkitManager] No remote MCP servers configured', {}, {});
    return [];
  }

  // Fetch tools from each remote MCP server
  const allTools: Tool[] = [];

  for (const toolkit of remoteMcpToolkits) {
    if (!toolkit.remote_mcp_server?.url) {
      log.warn('[ToolkitManager] Remote MCP toolkit missing URL', {}, {
        name: toolkit.name,
        group: toolkit.group,
      });
      continue;
    }

    try {
      log.info('[ToolkitManager] Fetching tools from remote MCP server', {}, {
        name: toolkit.name,
        group: toolkit.group,
        url: toolkit.remote_mcp_server.url,
        protocol: toolkit.remote_mcp_server.protocol,
      });

      const client = new MCPClient(toolkit.remote_mcp_server.url);
      const result = await client.listTools();

      log.info('[ToolkitManager] Successfully retrieved tools from MCP server', {}, {
        name: toolkit.name,
        group: toolkit.group,
        url: toolkit.remote_mcp_server.url,
        toolCount: result.tools?.length || 0,
      });

      if (result.tools && result.tools.length > 0) {
        allTools.push(...result.tools);
      }
    } catch (error) {
      log.error('[ToolkitManager] Failed to fetch tools from MCP server', {}, {
        name: toolkit.name,
        group: toolkit.group,
        url: toolkit.remote_mcp_server?.url,
        error: error instanceof Error ? error.message : String(error),
      }, error);
      // Continue with other servers even if one fails
    }
  }

  log.info('[ToolkitManager] Completed remote MCP server tool discovery', {}, {
    totalServers: remoteMcpToolkits.length,
    totalTools: allTools.length,
  });

  return allTools;
};

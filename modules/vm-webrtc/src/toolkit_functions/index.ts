// MARK: - Toolkit Functions Registry

import { log } from '../../../../lib/logger';
import * as dailyPapers from './daily_papers';
import * as googleDrive from './google_drive';
import * as hackerNews from './hacker_news';
import * as web from './web';

// MARK: - Types

export type ToolkitFunction = (params: any, context_params?: any) => Promise<string>;

export interface ToolkitRegistry {
  [groupName: string]: {
    [toolName: string]: ToolkitFunction;
  };
}

// MARK: - Registry

/**
 * Map of toolkit group names to their module exports.
 * Convention over configuration: All exported functions from each module
 * are automatically registered as tools for that group.
 */
const toolkitModules = {
  hacker_news: hackerNews,
  daily_papers: dailyPapers,
  web: web,
  google_drive: googleDrive,
};

/**
 * Registry of all toolkit functions organized by group and tool name.
 * This registry is mutable and can be extended at runtime with MCP tools.
 * Automatically populated from toolkit modules using convention over configuration.
 */
export const toolkitRegistry: ToolkitRegistry = Object.entries(toolkitModules).reduce(
  (registry, [groupName, module]) => {
    registry[groupName] = Object.entries(module)
      .filter(([_key, value]) => typeof value === 'function')
      .reduce((tools, [toolName, toolFunction]) => {
        tools[toolName] = toolFunction as ToolkitFunction;
        return tools;
      }, {} as { [toolName: string]: ToolkitFunction });
    return registry;
  },
  {} as ToolkitRegistry
);

/**
 * Register a runtime MCP tool function in the toolkit registry.
 * This allows MCP tools to be treated the same as local tools.
 */
export function registerMcpTool(groupName: string, toolName: string, toolFunction: ToolkitFunction): void {
  if (!toolkitRegistry[groupName]) {
    toolkitRegistry[groupName] = {};
  }
  toolkitRegistry[groupName][toolName] = toolFunction;

  log.info('[ToolkitRegistry] Registered MCP tool', {}, {
    groupName,
    toolName,
  });
}

// MARK: - Executor

/**
 * Execute a toolkit function by group name and tool name.
 * @param groupName - The toolkit group (e.g., "hacker_news")
 * @param toolName - The tool name (e.g., "showTopStories")
 * @param params - Parameters to pass to the tool function
 * @param context_params - Optional context parameters for toolkit functions
 * @returns Promise resolving to the JSON string result
 */
export async function executeToolkitFunction(
  groupName: string,
  toolName: string,
  params: any,
  context_params?: any
): Promise<string> {
  log.info('[ToolkitRegistry] Executing toolkit function', {}, {
    groupName,
    toolName,
    params,
  });

  // Check if group exists
  const group = toolkitRegistry[groupName];
  if (!group) {
    const error = `Unknown toolkit group: ${groupName}`;
    log.error('[ToolkitRegistry] Group not found', {}, { groupName, availableGroups: Object.keys(toolkitRegistry) });
    throw new Error(error);
  }

  // Check if tool exists in group
  const toolFunction = group[toolName];
  if (!toolFunction) {
    const error = `Unknown tool '${toolName}' in group '${groupName}'`;
    log.error('[ToolkitRegistry] Tool not found', {}, {
      groupName,
      toolName,
      availableTools: Object.keys(group),
    });
    throw new Error(error);
  }

  // Execute the tool function
  try {
    const result = await toolFunction(params, context_params);
    log.info('[ToolkitRegistry] Tool execution successful', {}, {
      groupName,
      toolName,
      resultLength: result.length,
      result: result,
    });
    return result;
  } catch (error) {
    log.error('[ToolkitRegistry] Tool execution failed', {}, {
      groupName,
      toolName,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    }, error);
    throw error;
  }
}

// MARK: - Exports

export { dailyPapers, googleDrive, hackerNews, web };


// MARK: - Toolkit Functions Registry

import * as hackerNews from './hacker_news';
import * as dailyPapers from './daily_papers';
import * as web from './web';
import * as googleDrive from './google_drive';
import { log } from '../../../../lib/logger';

// MARK: - Types

export type ToolkitFunction = (params: any, context_params?: any) => Promise<string>;

export interface ToolkitRegistry {
  [groupName: string]: {
    [toolName: string]: ToolkitFunction;
  };
}

// MARK: - Registry

/**
 * Registry of all toolkit functions organized by group and tool name.
 * This registry is mutable and can be extended at runtime with MCP tools.
 */
export const toolkitRegistry: ToolkitRegistry = {
  hacker_news: {
    showTopStories: hackerNews.showTopStories,
    searchStories: hackerNews.searchStories,
    getStoryInfo: hackerNews.getStoryInfo,
    getUserInfo: hackerNews.getUserInfo,
  },
  daily_papers: {
    showDailyPapers: dailyPapers.showDailyPapers,
    getPaperDetails: dailyPapers.getPaperDetails,
  },
  web: {
    getContentsFromUrl: web.getContentsFromUrl,
    web_search: web.web_search,
  },
  google_drive: {
    keyword_search: googleDrive.keyword_search,
    search_documents: googleDrive.search_documents,
    list_drive_folder_children: googleDrive.list_drive_folder_children,
    get_gdrive_file_content: googleDrive.get_gdrive_file_content,
  }
};

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

export { hackerNews, dailyPapers, web, googleDrive };

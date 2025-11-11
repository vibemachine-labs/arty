// MARK: - Toolkit Functions Registry

import * as hackerNews from './hacker_news';
import * as dailyPapers from './daily_papers';
import * as web from './web';
import { log } from '../../../../lib/logger';

// MARK: - Types

export type ToolkitFunction = (params: any) => Promise<string>;

export interface ToolkitRegistry {
  [groupName: string]: {
    [toolName: string]: ToolkitFunction;
  };
}

// MARK: - Registry

/**
 * Registry of all toolkit functions organized by group and tool name.
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
    showCommentsForPaper: dailyPapers.showCommentsForPaper,
  },
  web: {
    getContentsFromUrl: web.getContentsFromUrl,
  },
};

// MARK: - Executor

/**
 * Execute a toolkit function by group name and tool name.
 * @param groupName - The toolkit group (e.g., "hacker_news")
 * @param toolName - The tool name (e.g., "showTopStories")
 * @param params - Parameters to pass to the tool function
 * @returns Promise resolving to the JSON string result
 */
export async function executeToolkitFunction(
  groupName: string,
  toolName: string,
  params: any
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
    const result = await toolFunction(params);
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

export { hackerNews, dailyPapers, web };

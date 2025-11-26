// MARK: - Toolkit Function Wrapper Interface

import type { ToolkitFunction } from '../toolkit_functions';
import { DeepWikiWrapper } from './deepwiki_wrapper';

/**
 * Interface for toolkit function wrappers.
 * Wrappers can intercept and modify tool calls before and after execution.
 */
export interface ToolkitFunctionWrapper {
  /**
   * Wrap a toolkit function with custom logic.
   *
   * @param groupName - The toolkit group name (e.g., "deepwiki")
   * @param toolName - The tool name (e.g., "read_wiki_structure")
   * @param originalFunction - The original toolkit function to wrap
   * @returns A wrapped toolkit function with the same signature
   */
  wrap(
    groupName: string,
    toolName: string,
    originalFunction: ToolkitFunction
  ): ToolkitFunction;
}

/**
 * Get the wrapper for a specific toolkit group, if one exists.
 *
 * @param groupName - The toolkit group name
 * @returns The wrapper instance if configured, otherwise null
 */
export function getWrapperForGroup(groupName: string): ToolkitFunctionWrapper | null {
  // Registry of wrappers by group name
  const wrappers: Record<string, ToolkitFunctionWrapper> = {
    deepwiki: new DeepWikiWrapper(),
  };

  return wrappers[groupName] || null;
}

// MARK: - Toolkit Function Wrapper Interface

import type { ToolkitFunction, ToolkitResult } from '../toolkit_functions';
import type { ToolSessionContext } from '../types';

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
  // Dynamically import wrappers based on group name
  const wrappers: Record<string, ToolkitFunctionWrapper> = {
    deepwiki: new DeepWikiWrapper(),
  };

  return wrappers[groupName] || null;
}

/**
 * DeepWiki wrapper - logs all tool calls for debugging and future enhancements.
 */
class DeepWikiWrapper implements ToolkitFunctionWrapper {
  wrap(
    groupName: string,
    toolName: string,
    originalFunction: ToolkitFunction
  ): ToolkitFunction {
    // Return a wrapped function with the same signature
    return async (
      params: any,
      context_params?: any,
      toolSessionContext?: ToolSessionContext
    ): Promise<ToolkitResult> => {
      const { log } = await import('../../../../../lib/logger');

      // Log the tool call
      log.info('[DeepWikiWrapper] Tool called', {}, {
        groupName,
        toolName,
        params,
        context_params,
        sessionContextKeys: toolSessionContext ? Object.keys(toolSessionContext) : [],
      });

      try {
        // Execute the original function
        const result = await originalFunction(params, context_params, toolSessionContext);

        // Log successful execution
        log.info('[DeepWikiWrapper] Tool execution successful', {}, {
          groupName,
          toolName,
          resultLength: result.result.length,
          sessionContextKeys: Object.keys(result.updatedToolSessionContext),
        });

        return result;
      } catch (error) {
        // Log errors
        log.error('[DeepWikiWrapper] Tool execution failed', {}, {
          groupName,
          toolName,
          errorMessage: error instanceof Error ? error.message : String(error),
        }, error instanceof Error ? error : new Error(String(error)));

        // Re-throw the error
        throw error;
      }
    };
  }
}

// MARK: - DeepWiki Wrapper

import type { ToolkitFunction, ToolkitResult } from '../toolkit_functions';
import type { ToolSessionContext } from '../types';
import type { ToolkitFunctionWrapper } from './ToolkitFunctionWrapper';

/**
 * DeepWiki wrapper - logs all tool calls for debugging and future enhancements.
 */
export class DeepWikiWrapper implements ToolkitFunctionWrapper {
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

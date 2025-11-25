// MARK: - DeepWiki Wrapper

import type { ToolkitFunction, ToolkitResult } from '../toolkit_functions';
import type { ToolSessionContext } from '../types';
import type { ToolkitFunctionWrapper } from './ToolkitFunctionWrapper';
import { lookupGithubRepo } from '../github_helper';

/**
 * Validate and resolve a repository name parameter.
 *
 * @param params - The tool parameters object
 * @returns Updated params with validated repoName
 * @throws Error if repoName is missing or cannot be validated
 */
async function validateRepoName(params: any): Promise<any> {
  // Check if repoName parameter exists
  if (!params.repoName) {
    throw new Error('Missing required parameter: repoName');
  }

  const { log } = await import('../../../../../lib/logger');
  const originalRepoName = params.repoName;

  log.info('[DeepWikiWrapper] Validating repository name', {}, {
    originalRepoName,
  });

  try {
    // Lookup and validate the repo using GitHub helper
    const validatedRepoName = await lookupGithubRepo({
      repoIdentifier: originalRepoName,
    });

    log.info('[DeepWikiWrapper] Repository name validated', {}, {
      originalRepoName,
      validatedRepoName,
    });

    // Return updated params with validated repo name
    return {
      ...params,
      repoName: validatedRepoName,
    };
  } catch (error) {
    log.error('[DeepWikiWrapper] Repository validation failed', {}, {
      originalRepoName,
      error: error instanceof Error ? error.message : String(error),
    });
    // Return user-friendly error message
    throw new Error(
      `No repository could be located for "${originalRepoName}". Can you specify the org name or double check the spelling?`
    );
  }
}

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
        // Validate and resolve repository name
        const validatedParams = await validateRepoName(params);

        // Execute the original function with validated params
        const result = await originalFunction(validatedParams, context_params, toolSessionContext);

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

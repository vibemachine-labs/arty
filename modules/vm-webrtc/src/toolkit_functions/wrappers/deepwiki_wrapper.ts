// MARK: - DeepWiki Wrapper

import type { ToolkitFunction, ToolkitResult } from "../toolkit_functions";
import type { ToolSessionContext } from "../types";
import type { ToolkitFunctionWrapper } from "./ToolkitFunctionWrapper";
import { lookupGithubRepo } from "../github_helper";
import { summarizeContent, MAX_CONTENT_LENGTH } from "./summarizer";

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
    throw new Error("Missing required parameter: repoName");
  }

  const { log } = await import("../../../../../lib/logger");
  const originalRepoName = params.repoName;

  log.info(
    "[DeepWikiWrapper] Validating repository name",
    {},
    {
      originalRepoName,
    },
  );

  try {
    // Lookup and validate the repo using GitHub helper
    const validatedRepoName = await lookupGithubRepo({
      repoIdentifier: originalRepoName,
    });

    log.info(
      "[DeepWikiWrapper] Repository name validated",
      {},
      {
        originalRepoName,
        validatedRepoName,
      },
    );

    // Return updated params with validated repo name
    return {
      ...params,
      repoName: validatedRepoName,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.debug(
      "[DeepWikiWrapper] Could not uniquely identify repository",
      {},
      {
        originalRepoName,
        error: errorMessage,
      },
    );
    // Pass through the detailed error message from lookupGithubRepo
    throw new Error(
      `Could not find unique repository for "${originalRepoName}". ${errorMessage}`,
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
    originalFunction: ToolkitFunction,
  ): ToolkitFunction {
    // Return a wrapped function with the same signature
    return async (
      params: any,
      context_params?: any,
      toolSessionContext?: ToolSessionContext,
    ): Promise<ToolkitResult> => {
      const { log } = await import("../../../../../lib/logger");

      // Log the tool call
      log.info(
        "[DeepWikiWrapper] Tool called",
        {},
        {
          groupName,
          toolName,
          params,
          context_params,
          sessionContextKeys: toolSessionContext
            ? Object.keys(toolSessionContext)
            : [],
        },
      );

      // Validate and resolve repository name
      let validatedParams: any;
      try {
        validatedParams = await validateRepoName(params);
      } catch (error) {
        // Log validation error
        log.warn(
          "[DeepWikiWrapper] Invalid params for tool, skipping tool call",
          {},
          {
            groupName,
            toolName,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
          error instanceof Error ? error : new Error(String(error)),
        );

        // Return a ToolkitResult with the error message
        const repoName = params.repoName || "unknown";
        const errorMessage =
          error instanceof Error
            ? error.message
            : `Could not locate repository for "${repoName}". Can you specify the org name or double check the spelling?`;

        return {
          result: errorMessage,
          updatedToolSessionContext: {},
        };
      }

      try {
        // Execute the original function with validated params
        const result = await originalFunction(
          validatedParams,
          context_params,
          toolSessionContext,
        );

        // Log successful execution
        log.info(
          "[DeepWikiWrapper] Tool execution successful",
          {},
          {
            groupName,
            toolName,
            resultLength: result.result.length,
            sessionContextKeys: Object.keys(result.updatedToolSessionContext),
          },
        );

        // Check if result exceeds max length and needs summarization
        if (
          typeof result.result === "string" &&
          result.result.length > MAX_CONTENT_LENGTH
        ) {
          log.info(
            "[DeepWikiWrapper] Result exceeds max length, initiating summarization",
            {},
            {
              groupName,
              toolName,
              originalLength: result.result.length,
              maxLength: MAX_CONTENT_LENGTH,
            },
          );

          // Summarize the result using OpenAI
          const summarizedResult = await summarizeContent(result.result);

          log.info(
            "[DeepWikiWrapper] Summarization complete",
            {},
            {
              groupName,
              toolName,
              originalLength: result.result.length,
              summarizedLength: summarizedResult.length,
              reductionPercent: Math.round(
                (1 - summarizedResult.length / result.result.length) * 100,
              ),
            },
          );

          return {
            result: summarizedResult,
            updatedToolSessionContext: result.updatedToolSessionContext,
          };
        } else {
          log.info(
            "[DeepWikiWrapper] Result within max length",
            {},
            {
              groupName,
              toolName,
              resultLength:
                typeof result.result === "string"
                  ? result.result.length
                  : "N/A",
              maxLength: MAX_CONTENT_LENGTH,
            },
          );
        }

        return result;
      } catch (error) {
        // Log errors
        log.error(
          "[DeepWikiWrapper] Tool execution failed",
          {},
          {
            groupName,
            toolName,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
          error instanceof Error ? error : new Error(String(error)),
        );

        // Re-throw the error
        throw error;
      }
    };
  }
}

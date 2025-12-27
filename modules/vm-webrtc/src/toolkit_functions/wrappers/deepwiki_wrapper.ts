// MARK: - DeepWiki Wrapper

import type { ToolkitFunction, ToolkitResult } from "../toolkit_functions";
import type { ToolSessionContext } from "../types";
import type { ToolkitFunctionWrapper } from "./ToolkitFunctionWrapper";
import { lookupGithubRepo } from "../github_helper";
import { summarizeContent, MAX_CONTENT_LENGTH } from "./summarizer";

/**
 * Validated parameters with guaranteed string repoName.
 */
interface ValidatedDeepWikiParams {
  repoName: string;
  [key: string]: unknown;
}

/**
 * Type guard to check if a value is a ToolkitResult object.
 * This helps catch bugs where we accidentally pass an object instead of a string.
 */
function isToolkitResult(value: unknown): value is ToolkitResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    "updatedToolSessionContext" in value
  );
}

/**
 * Type guard to ensure repoName is a valid non-empty string.
 * Catches cases where an object is accidentally passed instead of a string.
 */
function isValidRepoName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate and resolve a repository name parameter.
 *
 * @param params - The tool parameters object
 * @returns Updated params with validated repoName (guaranteed to be a string)
 * @throws Error if repoName is missing, invalid, or cannot be validated
 */
async function validateRepoName(
  params: Record<string, unknown>,
): Promise<ValidatedDeepWikiParams> {
  const { log } = await import("../../../../../lib/logger");

  // Check if repoName parameter exists
  if (!("repoName" in params) || params.repoName === undefined) {
    log.error(
      "[DeepWikiWrapper] Missing repoName parameter",
      {},
      {
        receivedParams: JSON.stringify(params),
        paramKeys: Object.keys(params),
      },
    );
    throw new Error("Missing required parameter: repoName");
  }

  const rawRepoName = params.repoName;

  // DEFENSIVE: Check if repoName is accidentally a ToolkitResult object
  // This catches bugs where we forget to extract .result from lookupGithubRepo
  if (isToolkitResult(rawRepoName)) {
    log.error(
      "[DeepWikiWrapper] ❌ BUG DETECTED: repoName is a ToolkitResult object instead of a string!",
      {},
      {
        receivedType: typeof rawRepoName,
        receivedValue: JSON.stringify(rawRepoName),
        expectedType: "string",
        hint: "Someone passed the full ToolkitResult object instead of extracting .result",
      },
    );
    throw new Error(
      `BUG: repoName is a ToolkitResult object instead of a string. Received: ${JSON.stringify(rawRepoName)}. Expected a string like "owner/repo".`,
    );
  }

  // DEFENSIVE: Ensure repoName is a valid string
  if (!isValidRepoName(rawRepoName)) {
    log.error(
      "[DeepWikiWrapper] ❌ Invalid repoName type or empty value",
      {},
      {
        receivedType: typeof rawRepoName,
        receivedValue: JSON.stringify(rawRepoName),
        expectedType: "non-empty string",
      },
    );
    throw new Error(
      `Invalid repoName: expected non-empty string, got ${typeof rawRepoName}: ${JSON.stringify(rawRepoName)}`,
    );
  }

  const originalRepoName: string = rawRepoName;

  log.info(
    "[DeepWikiWrapper] Validating repository name",
    {},
    {
      originalRepoName,
      originalRepoNameType: typeof originalRepoName,
    },
  );

  try {
    // Lookup and validate the repo using GitHub helper
    // lookupGithubRepo returns ToolkitResult, NOT a plain string
    const lookupResult: ToolkitResult = await lookupGithubRepo({
      repoIdentifier: originalRepoName,
    });

    log.debug(
      "[DeepWikiWrapper] lookupGithubRepo returned",
      {},
      {
        lookupResultType: typeof lookupResult,
        lookupResultKeys:
          typeof lookupResult === "object" && lookupResult !== null
            ? Object.keys(lookupResult)
            : "N/A",
        lookupResultFull: JSON.stringify(lookupResult),
      },
    );

    // DEFENSIVE: Verify we got a ToolkitResult
    if (!isToolkitResult(lookupResult)) {
      log.error(
        "[DeepWikiWrapper] ❌ lookupGithubRepo did not return a ToolkitResult",
        {},
        {
          receivedType: typeof lookupResult,
          receivedValue: JSON.stringify(lookupResult),
        },
      );
      throw new Error(
        `lookupGithubRepo returned unexpected type: ${typeof lookupResult}`,
      );
    }

    // Extract the result string from the ToolkitResult
    const validatedRepoName: string = lookupResult.result;

    // DEFENSIVE: Ensure the extracted result is a valid string
    if (!isValidRepoName(validatedRepoName)) {
      log.error(
        "[DeepWikiWrapper] ❌ lookupGithubRepo.result is not a valid string",
        {},
        {
          extractedResultType: typeof validatedRepoName,
          extractedResultValue: JSON.stringify(validatedRepoName),
          fullLookupResult: JSON.stringify(lookupResult),
        },
      );
      throw new Error(
        `lookupGithubRepo.result is not a valid string: ${JSON.stringify(validatedRepoName)}`,
      );
    }

    log.info(
      "[DeepWikiWrapper] ✅ Repository name validated successfully",
      {},
      {
        originalRepoName,
        validatedRepoName,
        validatedRepoNameType: typeof validatedRepoName,
      },
    );

    // Return updated params with validated repo name (guaranteed string)
    const validatedParams: ValidatedDeepWikiParams = {
      ...params,
      repoName: validatedRepoName,
    };

    // Final sanity check before returning
    if (!isValidRepoName(validatedParams.repoName)) {
      log.error(
        "[DeepWikiWrapper] ❌ Final validation failed - repoName is not a string",
        {},
        {
          finalRepoNameType: typeof validatedParams.repoName,
          finalRepoNameValue: JSON.stringify(validatedParams.repoName),
        },
      );
      throw new Error("Internal error: validated repoName is not a string");
    }

    return validatedParams;
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
      `Could not find unique repository for "${originalRepoName}". ${errorMessage}. Try spelling it out loud in case it differed from my spelling: ${originalRepoName}`,
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
      params: Record<string, unknown>,
      context_params?: Record<string, unknown>,
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
          params: JSON.stringify(params),
          paramsRepoNameType: typeof params.repoName,
          context_params: context_params
            ? JSON.stringify(context_params)
            : undefined,
          sessionContextKeys: toolSessionContext
            ? Object.keys(toolSessionContext)
            : [],
        },
      );

      // Validate and resolve repository name
      let validatedParams: ValidatedDeepWikiParams;
      try {
        validatedParams = await validateRepoName(params);

        // Log the validated params for debugging
        log.debug(
          "[DeepWikiWrapper] Params after validation",
          {},
          {
            validatedParams: JSON.stringify(validatedParams),
            validatedRepoNameType: typeof validatedParams.repoName,
            validatedRepoNameValue: validatedParams.repoName,
          },
        );
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
            originalRepoName: params.repoName,
            originalRepoNameType: typeof params.repoName,
            originalRepoNameValue: JSON.stringify(params.repoName),
          },
          error instanceof Error ? error : new Error(String(error)),
        );

        // Return a ToolkitResult with the error message
        const repoName =
          typeof params.repoName === "string" ? params.repoName : "unknown";
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
            fullResult: result.result,
            sessionContextKeys: Object.keys(result.updatedToolSessionContext),
          },
        );

        // Check if DeepWiki returned an error fetching the wiki
        if (
          typeof result.result === "string" &&
          result.result.includes("Error fetching wiki")
        ) {
          const repoName = validatedParams.repoName;
          const truncatedResponse = result.result.substring(0, 1000);
          const spelledOutName = repoName.split("").join(" ");
          const errorMessage = `DeepWiki could not fetch documentation for this repository. Response: ${truncatedResponse}... I searched for "${repoName}". Let me spell that out letter by letter so you can double check the spelling: ${spelledOutName}`;

          log.warn(
            "[DeepWikiWrapper] Error fetching wiki detected in response",
            {},
            {
              groupName,
              toolName,
              repoName,
              truncatedResponse,
            },
          );

          return {
            result: errorMessage,
            updatedToolSessionContext: {},
          };
        }

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

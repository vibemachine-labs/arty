import { fetch } from "expo/fetch";
import { log } from "../../../../../lib/logger";
import { getApiKey } from "../../../../../lib/secure-storage";

/**
 * Maximum length for content that doesn't need summarization
 */
export const MAX_CONTENT_LENGTH = 25000;

/**
 * OpenAI API endpoint for chat completions
 */
const OPENAI_CHAT_COMPLETIONS_URL =
  "https://api.openai.com/v1/chat/completions";

/**
 * Summarize large text content using OpenAI's API
 * Uses a fast, cost-effective model to reduce content size while preserving key information
 *
 * @param content - The text content to summarize
 * @param maxLength - Maximum length threshold (default: 25000 characters)
 * @returns Summarized content or original if summarization fails
 */
export async function summarizeContent(
  content: string,
  maxLength: number = MAX_CONTENT_LENGTH,
): Promise<string> {
  // If content is already below max length, return as-is
  if (content.length <= maxLength) {
    log.debug(
      "[Summarizer] Content below max length, no summarization needed",
      {},
      {
        contentLength: content.length,
        maxLength,
      },
    );
    return content;
  }

  log.info(
    "[Summarizer] Content exceeds max length, initiating summarization",
    {},
    {
      originalLength: content.length,
      maxLength,
    },
  );

  try {
    // Get OpenAI API key
    const apiKey = await getApiKey({ forceSecureStore: true });
    if (!apiKey) {
      log.warn(
        "[Summarizer] OpenAI API key not configured, returning truncated content",
        {},
        {
          originalLength: content.length,
          truncatedLength: maxLength,
        },
      );
      return (
        content.substring(0, maxLength) +
        "\n\n[Content truncated due to length - OpenAI API key not configured for summarization]"
      );
    }

    // Prepare summarization request
    const payload = {
      model: "gpt-4o-mini", // Fast, cost-effective model for summarization
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that creates concise, accurate summaries of technical documentation and code repository information. Preserve key details, code examples, file paths, and important technical information while reducing overall length. Maintain the structure and readability of the content.",
        },
        {
          role: "user",
          content: `Please provide a comprehensive summary of the following content, preserving all critical information, code examples, and technical details while reducing the overall length:\n\n${content}`,
        },
      ],
      temperature: 0.3, // Lower temperature for more focused, deterministic summaries
      max_tokens: 4000, // Limit output to reasonable size
    };

    log.info(
      "[Summarizer] Sending summarization request to OpenAI",
      {},
      {
        model: payload.model,
        originalLength: content.length,
      },
    );

    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(
        "[Summarizer] OpenAI API error",
        {},
        {
          status: response.status,
          statusText: response.statusText,
          errorText,
        },
      );

      // Fallback to truncation on API error
      return (
        content.substring(0, maxLength) +
        "\n\n[Content truncated due to length - summarization failed]"
      );
    }

    const responseData = await response.json();
    const summary = responseData.choices?.[0]?.message?.content;

    if (!summary) {
      log.error(
        "[Summarizer] No summary in OpenAI response",
        {},
        {
          responseData,
        },
      );

      // Fallback to truncation
      return (
        content.substring(0, maxLength) +
        "\n\n[Content truncated due to length - summarization failed]"
      );
    }

    log.info(
      "[Summarizer] Summarization successful",
      {},
      {
        originalLength: content.length,
        summarizedLength: summary.length,
        reductionPercent: Math.round(
          (1 - summary.length / content.length) * 100,
        ),
      },
    );

    return summary;
  } catch (error) {
    log.error(
      "[Summarizer] Error during summarization",
      {},
      {
        error: error instanceof Error ? error.message : String(error),
        originalLength: content.length,
      },
    );

    // Fallback to truncation on any error
    return (
      content.substring(0, maxLength) +
      "\n\n[Content truncated due to length - summarization error]"
    );
  }
}

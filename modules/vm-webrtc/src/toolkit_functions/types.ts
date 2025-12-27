// MARK: - Toolkit Function Types

/**
 * Session context for maintaining state between tool calls.
 * Allows tools to preserve context like pagination state, search filters, etc.
 */
export type ToolSessionContext = Record<string, string>;

/**
 * Result returned by toolkit functions.
 * Includes both the result string and updated session context for round-tripping.
 */
export interface ToolkitResult {
  result: string;
  updatedToolSessionContext: ToolSessionContext;
}

// MARK: - Helper Functions

/**
 * Check if a ToolSessionContext is empty.
 * @param context - The session context to check
 * @returns true if the context is empty or has no keys
 */
export function isToolSessionContextEmpty(
  context: ToolSessionContext,
): boolean {
  return !context || Object.keys(context).length === 0;
}

/**
 * Summarize a ToolSessionContext as a string of key=value pairs.
 * @param context - The session context to summarize
 * @returns A formatted string like "key=value, key2=value2" or empty string if empty
 */
export function summarizeToolSessionContext(
  context: ToolSessionContext,
): string {
  if (isToolSessionContextEmpty(context)) {
    return "";
  }

  return Object.entries(context)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

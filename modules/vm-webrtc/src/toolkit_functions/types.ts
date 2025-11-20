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

import { log } from "../../../../lib/logger";
import type { ToolSessionContext, ToolkitResult } from "./types";

export interface GetNextLanguageExerciseParams {
  previous_exercise_id?: string | null;
  user_score?: number | null;
  performance_notes?: string | null;
}

/**
 * Stub implementation for the language lesson exercise flow.
 * Accepts optional score/update data from the previous exercise and
 * returns a placeholder response until persistence and drill logic are implemented.
 */
export async function get_next_language_exercise(
  params: GetNextLanguageExerciseParams = {},
  _context_params?: any,
  toolSessionContext: ToolSessionContext = {},
): Promise<ToolkitResult> {
  const {
    previous_exercise_id = null,
    user_score = null,
    performance_notes = null,
  } = params;

  log.info(
    "[language_lesson] get_next_language_exercise called",
    {},
    {
      previous_exercise_id,
      user_score,
      performance_notes,
      toolSessionContext,
    },
  );

  return {
    result: JSON.stringify(
      {
        status: "not_implemented",
        message:
          "Language lesson flow is not implemented yet. This is a stub tool response.",
        input: {
          previous_exercise_id,
          user_score,
          performance_notes,
        },
      },
      null,
      2,
    ),
    updatedToolSessionContext: toolSessionContext,
  };
}

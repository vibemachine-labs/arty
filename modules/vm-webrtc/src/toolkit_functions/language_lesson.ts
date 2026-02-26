import { log } from "../../../../lib/logger";
import { loadParsedLanguageLessonConfig } from "../../../../lib/languageLessonConfig";
import type { ToolSessionContext, ToolkitResult } from "./types";

export interface GetNextLanguageExerciseParams {
  previous_exercise_id?: string | null;
  user_score?: number | null;
  performance_notes?: string | null;
}

/**
 * Stub implementation for the language lesson exercise flow.
 * Step 1 implementation:
 * - First call (no previous exercise result): return first exercise in config.
 * - Follow-up calls with previous results: not implemented yet.
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

  const isInitialCall =
    (!previous_exercise_id || previous_exercise_id.trim().length === 0) &&
    user_score === null;

  if (!isInitialCall) {
    return {
      result: JSON.stringify(
        {
          status: "not_implemented",
          mode: "follow_up",
          message:
            "Step 2 is not implemented yet. Only initial exercise fetch is implemented.",
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

  const parsedConfigResult = await loadParsedLanguageLessonConfig();

  if (
    parsedConfigResult.validationErrors.length > 0 ||
    !parsedConfigResult.parsedConfig
  ) {
    return {
      result: JSON.stringify(
        {
          status: "config_invalid",
          mode: "initial",
          message:
            "Language lesson config is invalid or missing. Update the JSON in Configure Tools.",
          config_hash: parsedConfigResult.hash,
          summary: parsedConfigResult.summary,
          validationErrors: parsedConfigResult.validationErrors,
        },
        null,
        2,
      ),
      updatedToolSessionContext: toolSessionContext,
    };
  }

  const languageIssues = parsedConfigResult.parsedConfig.language_issues;
  const firstIssue = languageIssues[0];

  if (!firstIssue || firstIssue.exercises.length === 0) {
    return {
      result: JSON.stringify(
        {
          status: "no_exercises_available",
          mode: "initial",
          message: "No exercises were found in the language lesson config.",
          config_hash: parsedConfigResult.hash,
          summary: parsedConfigResult.summary,
        },
        null,
        2,
      ),
      updatedToolSessionContext: toolSessionContext,
    };
  }

  const firstExercise = firstIssue.exercises[0];

  const updatedToolSessionContext: ToolSessionContext = {
    ...toolSessionContext,
    current_issue_error_id: firstIssue.errorId,
    current_exercise_id: firstExercise.exercise_id,
    current_issue_index: "0",
    current_exercise_index: "0",
  };

  if (parsedConfigResult.hash) {
    updatedToolSessionContext.language_lesson_config_hash =
      parsedConfigResult.hash;
  }

  return {
    result: JSON.stringify(
      {
        status: "exercise_ready",
        mode: "initial",
        config_hash: parsedConfigResult.hash,
        overview: {
          issueIndex: 0,
          exerciseIndex: 0,
          issueCount: parsedConfigResult.summary.issueCount,
          totalExerciseCount: parsedConfigResult.summary.exerciseCount,
          exerciseCountInIssue: firstIssue.exercises.length,
        },
        issue: {
          errorId: firstIssue.errorId,
          title: firstIssue.title,
          area: firstIssue.area,
          impact: firstIssue.impact,
          description: firstIssue.description,
          theory: firstIssue.theory,
          categoryCode: firstIssue.categoryCode,
          subcategoryCode: firstIssue.subcategoryCode,
          subcategoryName: firstIssue.subcategoryName,
        },
        exercise: firstExercise,
      },
      null,
      2,
    ),
    updatedToolSessionContext,
  };
}

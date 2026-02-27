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
 * - Follow-up calls: log previous result only (no progression/storage yet).
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

  const normalizedPreviousExerciseId = (previous_exercise_id || "").trim();
  const hasPreviousExerciseId = normalizedPreviousExerciseId.length > 0;
  const hasUserScore = user_score !== null && user_score !== undefined;

  const isInitialCall = !hasPreviousExerciseId && !hasUserScore;

  log.info(
    "[language_lesson] Determined invocation mode",
    {},
    {
      isInitialCall,
      hasPreviousExerciseId,
      hasUserScore,
      normalizedPreviousExerciseId,
      previous_exercise_id,
      user_score,
      performance_notes,
      toolSessionContext,
    },
  );

  if (!isInitialCall) {
    const hasValidUserScore =
      typeof user_score === "number" && Number.isFinite(user_score);

    if (!hasPreviousExerciseId || !hasValidUserScore) {
      const returnPayload = {
        status: "invalid_follow_up_input",
        mode: "follow_up",
        message:
          "Follow-up calls require both previous_exercise_id and numeric user_score.",
        input: {
          previous_exercise_id,
          user_score,
          performance_notes,
        },
      };

      log.warn(
        "[language_lesson] Returning invalid follow-up input",
        {},
        {
          hasPreviousExerciseId,
          hasUserScore,
          hasValidUserScore,
          normalizedPreviousExerciseId,
          previous_exercise_id,
          user_score,
          performance_notes,
          toolSessionContext,
          returnPayload,
        },
      );

      return {
        result: JSON.stringify(returnPayload, null, 2),
        updatedToolSessionContext: toolSessionContext,
      };
    }
  }

  const parsedConfigResult = await loadParsedLanguageLessonConfig();

  log.info(
    "[language_lesson] Loaded parsed language lesson config",
    {},
    {
      isInitialCall,
      parsedConfigResult,
      toolSessionContext,
    },
  );

  if (
    parsedConfigResult.validationErrors.length > 0 ||
    !parsedConfigResult.parsedConfig
  ) {
    const returnPayload = {
      status: "config_invalid",
      mode: isInitialCall ? "initial" : "follow_up",
      message:
        "Language lesson config is invalid or missing. Update the JSON in Configure Tools.",
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
      validationErrors: parsedConfigResult.validationErrors,
    };

    log.warn(
      "[language_lesson] Returning config_invalid",
      {},
      {
        isInitialCall,
        parsedConfigResult,
        returnPayload,
        toolSessionContext,
      },
    );

    return {
      result: JSON.stringify(returnPayload, null, 2),
      updatedToolSessionContext: toolSessionContext,
    };
  }

  if (!isInitialCall) {
    const languageIssues = parsedConfigResult.parsedConfig.language_issues;

    log.info(
      "[language_lesson] Resolving follow-up previous_exercise_id",
      {},
      {
        normalizedPreviousExerciseId,
        previous_exercise_id,
        user_score,
        performance_notes,
        issueCount: languageIssues.length,
        searchableExercises: languageIssues.map((issue, issueIndex) => ({
          issueIndex,
          errorId: issue.errorId,
          title: issue.title,
          exerciseIds: issue.exercises.map((exercise) => exercise.exercise_id),
        })),
        toolSessionContext,
      },
    );

    let matchedIssueIndex = -1;
    let matchedExerciseIndex = -1;
    let matchedIssue:
      | (typeof parsedConfigResult.parsedConfig.language_issues)[number]
      | null = null;
    let matchedExercise:
      | (typeof parsedConfigResult.parsedConfig.language_issues)[number]["exercises"][number]
      | null = null;

    for (let issueIndex = 0; issueIndex < languageIssues.length; issueIndex++) {
      const issue = languageIssues[issueIndex];
      const exerciseIndex = issue.exercises.findIndex(
        (exercise) => exercise.exercise_id === normalizedPreviousExerciseId,
      );

      if (exerciseIndex >= 0) {
        matchedIssueIndex = issueIndex;
        matchedExerciseIndex = exerciseIndex;
        matchedIssue = issue;
        matchedExercise = issue.exercises[exerciseIndex];
        break;
      }
    }

    if (!matchedIssue || !matchedExercise) {
      const returnPayload = {
        status: "previous_exercise_not_found",
        mode: "follow_up",
        message:
          "Could not find previous_exercise_id in current language lesson config.",
        config_hash: parsedConfigResult.hash,
        summary: parsedConfigResult.summary,
        input: {
          previous_exercise_id: normalizedPreviousExerciseId,
          user_score,
          performance_notes,
        },
      };

      log.warn(
        "[language_lesson] Returning previous_exercise_not_found",
        {},
        {
          normalizedPreviousExerciseId,
          previous_exercise_id,
          user_score,
          performance_notes,
          availableExerciseIds: languageIssues.flatMap((issue) =>
            issue.exercises.map((exercise) => exercise.exercise_id),
          ),
          returnPayload,
          toolSessionContext,
        },
      );

      return {
        result: JSON.stringify(returnPayload, null, 2),
        updatedToolSessionContext: toolSessionContext,
      };
    }

    const followUpLogPayload = {
      previous_exercise_id: normalizedPreviousExerciseId,
      user_score,
      performance_notes,
      config_hash: parsedConfigResult.hash,
      matched_issue_index: matchedIssueIndex,
      matched_exercise_index: matchedExerciseIndex,
      matched_issue: {
        errorId: matchedIssue.errorId,
        title: matchedIssue.title,
        area: matchedIssue.area,
        impact: matchedIssue.impact,
        description: matchedIssue.description,
        theory: matchedIssue.theory,
        categoryCode: matchedIssue.categoryCode,
        subcategoryCode: matchedIssue.subcategoryCode,
        subcategoryName: matchedIssue.subcategoryName,
      },
      matched_exercise: matchedExercise,
      toolSessionContext,
    };

    log.info(
      "[language_lesson] Logged previous exercise result (no progression yet)",
      {},
      followUpLogPayload,
    );

    const returnPayload = {
      status: "previous_result_logged",
      mode: "follow_up",
      message:
        "Previous exercise result logged. Progression/selection is not enabled yet.",
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
      logged_result: {
        previous_exercise_id: normalizedPreviousExerciseId,
        user_score,
        performance_notes,
        issue_index: matchedIssueIndex,
        exercise_index: matchedExerciseIndex,
        issue_error_id: matchedIssue.errorId,
        issue_title: matchedIssue.title,
        exercise_type: matchedExercise.type,
        logged_at: new Date().toISOString(),
      },
      next_exercise: null,
    };

    log.info(
      "[language_lesson] Returning follow-up result (log-only mode)",
      {},
      {
        returnPayload,
        toolSessionContext,
      },
    );

    return {
      result: JSON.stringify(returnPayload, null, 2),
      updatedToolSessionContext: toolSessionContext,
    };
  }

  const languageIssues = parsedConfigResult.parsedConfig.language_issues;
  const firstIssue = languageIssues[0];

  log.info(
    "[language_lesson] Selecting first exercise for initial call",
    {},
    {
      issueCount: languageIssues.length,
      firstIssue,
      firstIssueExerciseIds: firstIssue?.exercises?.map(
        (exercise) => exercise.exercise_id,
      ),
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
      toolSessionContext,
    },
  );

  if (!firstIssue || firstIssue.exercises.length === 0) {
    const returnPayload = {
      status: "no_exercises_available",
      mode: "initial",
      message: "No exercises were found in the language lesson config.",
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
    };

    log.warn(
      "[language_lesson] Returning no_exercises_available",
      {},
      {
        firstIssue,
        languageIssues,
        returnPayload,
        toolSessionContext,
      },
    );

    return {
      result: JSON.stringify(returnPayload, null, 2),
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

  const returnPayload = {
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
  };

  log.info(
    "[language_lesson] Returning initial exercise",
    {},
    {
      returnPayload,
      updatedToolSessionContext,
      toolSessionContext,
    },
  );

  return {
    result: JSON.stringify(returnPayload, null, 2),
    updatedToolSessionContext,
  };
}

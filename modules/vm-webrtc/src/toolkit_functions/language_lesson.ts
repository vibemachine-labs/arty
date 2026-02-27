import { log } from "../../../../lib/logger";
import {
  loadParsedLanguageLessonConfig,
  saveParsedLanguageLessonConfig,
} from "../../../../lib/languageLessonConfig";
import type { NormalizedLanguageLessonConfig } from "./language_lesson_schema";
import type { ToolSessionContext, ToolkitResult } from "./types";

export interface GetNextLanguageExerciseParams {
  previous_exercise_id?: string | null;
  user_score?: number | null;
  performance_notes?: string | null;
}

type LanguageIssue = NormalizedLanguageLessonConfig["language_issues"][number];
type LanguageExercise = LanguageIssue["exercises"][number];

interface ExerciseLocator {
  issueIndex: number;
  exerciseIndex: number;
  issue: LanguageIssue;
  exercise: LanguageExercise;
}

interface ProgressSummary {
  issueCount: number;
  totalExerciseCount: number;
  finishedExerciseCount: number;
  pendingExerciseCount: number;
}

function isExerciseFinished(exercise: LanguageExercise): boolean {
  return exercise.status === "finished";
}

function findExerciseById(
  config: NormalizedLanguageLessonConfig,
  exerciseId: string,
): ExerciseLocator | null {
  for (
    let issueIndex = 0;
    issueIndex < config.language_issues.length;
    issueIndex += 1
  ) {
    const issue = config.language_issues[issueIndex];
    const exerciseIndex = issue.exercises.findIndex(
      (exercise) => exercise.exercise_id === exerciseId,
    );

    if (exerciseIndex >= 0) {
      return {
        issueIndex,
        exerciseIndex,
        issue,
        exercise: issue.exercises[exerciseIndex],
      };
    }
  }

  return null;
}

function findFirstUnfinishedExercise(
  config: NormalizedLanguageLessonConfig,
): ExerciseLocator | null {
  for (
    let issueIndex = 0;
    issueIndex < config.language_issues.length;
    issueIndex += 1
  ) {
    const issue = config.language_issues[issueIndex];
    for (
      let exerciseIndex = 0;
      exerciseIndex < issue.exercises.length;
      exerciseIndex += 1
    ) {
      const exercise = issue.exercises[exerciseIndex];
      if (!isExerciseFinished(exercise)) {
        return {
          issueIndex,
          exerciseIndex,
          issue,
          exercise,
        };
      }
    }
  }

  return null;
}

function summarizeProgress(config: NormalizedLanguageLessonConfig): ProgressSummary {
  const issueCount = config.language_issues.length;
  const totalExerciseCount = config.language_issues.reduce(
    (count, issue) => count + issue.exercises.length,
    0,
  );
  const finishedExerciseCount = config.language_issues.reduce(
    (count, issue) =>
      count + issue.exercises.filter((exercise) => isExerciseFinished(exercise)).length,
    0,
  );

  return {
    issueCount,
    totalExerciseCount,
    finishedExerciseCount,
    pendingExerciseCount: totalExerciseCount - finishedExerciseCount,
  };
}

function buildIssuePayload(issue: LanguageIssue) {
  return {
    errorId: issue.errorId,
    title: issue.title,
    area: issue.area,
    impact: issue.impact,
    description: issue.description,
    theory: issue.theory,
    theory_voice: issue.theory_voice,
    categoryCode: issue.categoryCode,
    subcategoryCode: issue.subcategoryCode,
    subcategoryName: issue.subcategoryName,
  };
}

function buildUpdatedToolSessionContext(
  base: ToolSessionContext,
  currentLocator: ExerciseLocator | null,
  configHash: string | null,
  fallbackIssueErrorId?: string,
): ToolSessionContext {
  const updated: ToolSessionContext = {
    ...base,
  };

  if (currentLocator) {
    updated.current_issue_error_id = currentLocator.issue.errorId;
    updated.current_exercise_id = currentLocator.exercise.exercise_id;
    updated.current_issue_index = String(currentLocator.issueIndex);
    updated.current_exercise_index = String(currentLocator.exerciseIndex);
  } else {
    updated.current_issue_error_id =
      fallbackIssueErrorId || updated.current_issue_error_id || "";
    updated.current_exercise_id = "";
    updated.current_issue_index = updated.current_issue_index || "0";
    updated.current_exercise_index = "-1";
  }

  if (configHash) {
    updated.language_lesson_config_hash = configHash;
  }

  return updated;
}

/**
 * POC implementation:
 * - Initial call: return first unfinished exercise.
 * - Follow-up call: mark previous exercise finished in persisted JSON, save,
 *   then return next unfinished exercise.
 *
 * This intentionally mutates user lesson JSON in storage for rapid prototyping.
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

  const mutableConfig = parsedConfigResult.parsedConfig;
  const progressBefore = summarizeProgress(mutableConfig);

  log.info(
    "[language_lesson] Current progress before operation",
    {},
    {
      progressBefore,
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
      toolSessionContext,
    },
  );

  if (!isInitialCall) {
    const numericScore = user_score as number;
    const normalizedPerformanceNotes =
      performance_notes && performance_notes.trim().length > 0
        ? performance_notes
        : null;

    const previousExerciseLocator = findExerciseById(
      mutableConfig,
      normalizedPreviousExerciseId,
    );

    if (!previousExerciseLocator) {
      const returnPayload = {
        status: "previous_exercise_not_found",
        mode: "follow_up",
        message:
          "Could not find previous_exercise_id in current language lesson config.",
        config_hash: parsedConfigResult.hash,
        summary: parsedConfigResult.summary,
        input: {
          previous_exercise_id: normalizedPreviousExerciseId,
          user_score: numericScore,
          performance_notes: normalizedPerformanceNotes,
        },
      };

      log.warn(
        "[language_lesson] Returning previous_exercise_not_found",
        {},
        {
          normalizedPreviousExerciseId,
          previous_exercise_id,
          user_score: numericScore,
          performance_notes: normalizedPerformanceNotes,
          availableExerciseIds: mutableConfig.language_issues.flatMap((issue) =>
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

    const previousExerciseBeforeUpdate = { ...previousExerciseLocator.exercise };
    const existingAttempts =
      typeof previousExerciseLocator.exercise.attempts === "number"
        ? previousExerciseLocator.exercise.attempts
        : 0;

    previousExerciseLocator.exercise.attempts = existingAttempts + 1;
    previousExerciseLocator.exercise.last_score = numericScore;
    previousExerciseLocator.exercise.last_notes = normalizedPerformanceNotes;
    previousExerciseLocator.exercise.status = "finished";
    previousExerciseLocator.exercise.finished_at = new Date().toISOString();

    log.info(
      "[language_lesson] Updated previous exercise state before persistence",
      {},
      {
        previous_exercise_id: normalizedPreviousExerciseId,
        previousExerciseBeforeUpdate,
        previousExerciseAfterUpdate: previousExerciseLocator.exercise,
        issueIndex: previousExerciseLocator.issueIndex,
        exerciseIndex: previousExerciseLocator.exerciseIndex,
        config_hash_before_save: parsedConfigResult.hash,
        progressBefore,
        toolSessionContext,
      },
    );

    try {
      await saveParsedLanguageLessonConfig(mutableConfig);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const returnPayload = {
        status: "persist_failed",
        mode: "follow_up",
        message: "Failed to persist updated language lesson progress.",
        error: errorMessage,
        config_hash: parsedConfigResult.hash,
      };

      log.error(
        "[language_lesson] Failed to persist updated lesson progress",
        {},
        {
          errorMessage,
          returnPayload,
          mutableConfig,
          toolSessionContext,
        },
        error instanceof Error ? error : new Error(String(error)),
      );

      return {
        result: JSON.stringify(returnPayload, null, 2),
        updatedToolSessionContext: toolSessionContext,
      };
    }

    log.info(
      "[language_lesson] Persisted updated lesson progress",
      {},
      {
        previous_exercise_id: normalizedPreviousExerciseId,
        config_hash_before_save: parsedConfigResult.hash,
        mutableConfig,
        toolSessionContext,
      },
    );

    const reloadedConfigResult = await loadParsedLanguageLessonConfig();

    log.info(
      "[language_lesson] Reloaded config after persistence",
      {},
      {
        reloadedConfigResult,
        toolSessionContext,
      },
    );

    if (
      reloadedConfigResult.validationErrors.length > 0 ||
      !reloadedConfigResult.parsedConfig
    ) {
      const returnPayload = {
        status: "persist_reload_invalid",
        mode: "follow_up",
        message:
          "Progress was saved but reloading the updated config failed validation.",
        config_hash: reloadedConfigResult.hash,
        summary: reloadedConfigResult.summary,
        validationErrors: reloadedConfigResult.validationErrors,
      };

      log.error(
        "[language_lesson] Persisted config failed reload validation",
        {},
        {
          returnPayload,
          reloadedConfigResult,
          toolSessionContext,
        },
      );

      return {
        result: JSON.stringify(returnPayload, null, 2),
        updatedToolSessionContext: toolSessionContext,
      };
    }

    const nextLocator = findFirstUnfinishedExercise(
      reloadedConfigResult.parsedConfig,
    );
    const progressAfter = summarizeProgress(reloadedConfigResult.parsedConfig);

    log.info(
      "[language_lesson] Selected next unfinished exercise after save",
      {},
      {
        nextLocator,
        progressAfter,
        config_hash_after_save: reloadedConfigResult.hash,
        toolSessionContext,
      },
    );

    if (!nextLocator) {
      const updatedToolSessionContext = buildUpdatedToolSessionContext(
        toolSessionContext,
        null,
        reloadedConfigResult.hash,
        previousExerciseLocator.issue.errorId,
      );

      const returnPayload = {
        status: "all_exercises_finished",
        mode: "follow_up",
        message: "All exercises are finished.",
        config_hash: reloadedConfigResult.hash,
        summary: reloadedConfigResult.summary,
        progress: progressAfter,
        completed_exercise: {
          exercise_id: previousExerciseLocator.exercise.exercise_id,
          issue_error_id: previousExerciseLocator.issue.errorId,
          issue_title: previousExerciseLocator.issue.title,
          score: numericScore,
          notes: normalizedPerformanceNotes,
          finished_at: previousExerciseLocator.exercise.finished_at,
        },
      };

      log.info(
        "[language_lesson] Returning all_exercises_finished",
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

    const updatedToolSessionContext = buildUpdatedToolSessionContext(
      toolSessionContext,
      nextLocator,
      reloadedConfigResult.hash,
    );

    const returnPayload = {
      status: "exercise_ready",
      mode: "follow_up",
      message:
        "Previous exercise was marked finished and persisted. Returning next unfinished exercise.",
      config_hash: reloadedConfigResult.hash,
      summary: reloadedConfigResult.summary,
      progress: progressAfter,
      completed_exercise: {
        exercise_id: previousExerciseLocator.exercise.exercise_id,
        issue_error_id: previousExerciseLocator.issue.errorId,
        issue_title: previousExerciseLocator.issue.title,
        score: numericScore,
        notes: normalizedPerformanceNotes,
        finished_at: previousExerciseLocator.exercise.finished_at,
      },
      overview: {
        issueIndex: nextLocator.issueIndex,
        exerciseIndex: nextLocator.exerciseIndex,
        issueCount: reloadedConfigResult.summary.issueCount,
        totalExerciseCount: reloadedConfigResult.summary.exerciseCount,
        exerciseCountInIssue: nextLocator.issue.exercises.length,
      },
      issue: buildIssuePayload(nextLocator.issue),
      exercise: nextLocator.exercise,
    };

    log.info(
      "[language_lesson] Returning next unfinished exercise after follow-up",
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

  const initialLocator = findFirstUnfinishedExercise(mutableConfig);

  log.info(
    "[language_lesson] Selecting first unfinished exercise for initial call",
    {},
    {
      initialLocator,
      progressBefore,
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
      toolSessionContext,
    },
  );

  if (!initialLocator) {
    const returnPayload =
      progressBefore.totalExerciseCount === 0
        ? {
            status: "no_exercises_available",
            mode: "initial",
            message: "No exercises were found in the language lesson config.",
            config_hash: parsedConfigResult.hash,
            summary: parsedConfigResult.summary,
            progress: progressBefore,
          }
        : {
            status: "all_exercises_finished",
            mode: "initial",
            message: "All exercises are already finished.",
            config_hash: parsedConfigResult.hash,
            summary: parsedConfigResult.summary,
            progress: progressBefore,
          };

    log.warn(
      "[language_lesson] No initial unfinished exercise available",
      {},
      {
        returnPayload,
        progressBefore,
        config_hash: parsedConfigResult.hash,
        toolSessionContext,
      },
    );

    return {
      result: JSON.stringify(returnPayload, null, 2),
      updatedToolSessionContext: toolSessionContext,
    };
  }

  const updatedToolSessionContext = buildUpdatedToolSessionContext(
    toolSessionContext,
    initialLocator,
    parsedConfigResult.hash,
  );

  const returnPayload = {
    status: "exercise_ready",
    mode: "initial",
    config_hash: parsedConfigResult.hash,
    summary: parsedConfigResult.summary,
    progress: progressBefore,
    overview: {
      issueIndex: initialLocator.issueIndex,
      exerciseIndex: initialLocator.exerciseIndex,
      issueCount: parsedConfigResult.summary.issueCount,
      totalExerciseCount: parsedConfigResult.summary.exerciseCount,
      exerciseCountInIssue: initialLocator.issue.exercises.length,
    },
    issue: buildIssuePayload(initialLocator.issue),
    exercise: initialLocator.exercise,
  };

  log.info(
    "[language_lesson] Returning initial unfinished exercise",
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

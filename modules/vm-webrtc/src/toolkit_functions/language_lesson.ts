import { log } from "../../../../lib/logger";
import {
  loadParsedLanguageLessonConfig,
  saveParsedLanguageLessonConfig,
  type LoadParsedLanguageLessonConfigResult,
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

interface InvocationState {
  previous_exercise_id: string | null;
  user_score: number | null;
  performance_notes: string | null;
  normalizedPreviousExerciseId: string;
  hasPreviousExerciseId: boolean;
  hasUserScore: boolean;
  isInitialCall: boolean;
}

interface LoadedConfigState {
  parsedConfigResult: LoadParsedLanguageLessonConfigResult;
  mutableConfig: NormalizedLanguageLessonConfig;
  progressBefore: ProgressSummary;
}

type LanguageExerciseToolMode = "initial" | "follow_up";

type LanguageExerciseToolStatus =
  | "next_exercise_ready"
  | "all_exercises_finished"
  | "no_exercises_available"
  | "invalid_follow_up_input"
  | "config_invalid"
  | "persist_failed"
  | "persist_reload_invalid"
  | "previous_exercise_not_found";

interface ExerciseOverview {
  issueIndex: number;
  exerciseIndex: number;
  issueCount: number;
  totalExerciseCount: number;
  exerciseCountInIssue: number;
}

interface CompletedExercisePayload {
  exercise_id: string;
  issue_error_id: string;
  issue_title: string;
  score: number;
  notes: string | null;
  finished_at: string | null;
}

interface FollowUpInputPayload {
  previous_exercise_id: string | null;
  user_score: number | null;
  performance_notes: string | null;
}

interface LanguageIssuePayload {
  errorId: string;
  title: string;
  area?: string | null;
  impact?: string | null;
  description?: string | null;
  theory?: string | null;
  theory_voice?: LanguageIssue["theory_voice"];
  categoryCode?: string | null;
  subcategoryCode?: string | null;
  subcategoryName?: string | null;
}

interface LanguageExerciseToolResponse {
  type: "language_exercise_tool_response";
  version: "1.0";
  status: LanguageExerciseToolStatus;
  mode: LanguageExerciseToolMode;
  message: string;
  next_action_suggestion: string;
  config_hash: string | null;
  summary: LoadParsedLanguageLessonConfigResult["summary"] | null;
  progress: ProgressSummary | null;
  overview: ExerciseOverview | null;
  issue: LanguageIssuePayload | null;
  exercise: LanguageExercise | null;
  completed_exercise: CompletedExercisePayload | null;
  input: FollowUpInputPayload | null;
  validationErrors: string[];
  error: string | null;
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

function summarizeProgress(
  config: NormalizedLanguageLessonConfig,
): ProgressSummary {
  const issueCount = config.language_issues.length;
  const totalExerciseCount = config.language_issues.reduce(
    (count, issue) => count + issue.exercises.length,
    0,
  );
  const finishedExerciseCount = config.language_issues.reduce(
    (count, issue) =>
      count +
      issue.exercises.filter((exercise) => isExerciseFinished(exercise)).length,
    0,
  );

  return {
    issueCount,
    totalExerciseCount,
    finishedExerciseCount,
    pendingExerciseCount: totalExerciseCount - finishedExerciseCount,
  };
}

function buildIssuePayload(issue: LanguageIssue): LanguageIssuePayload {
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

function buildNextActionSuggestion(status: LanguageExerciseToolStatus): string {
  switch (status) {
    case "next_exercise_ready":
      return "Assume the user wants to keep going, so give the next exercise to the user.";
    case "all_exercises_finished":
      return "Congratulate the user for finishing all exercises and ask if they want to practice a new issue.";
    case "no_exercises_available":
      return "Tell the user no exercises are currently configured and ask them to add language lesson JSON in Configure Tools.";
    case "invalid_follow_up_input":
      return "Apologize to the user and tell them we hit an internal error that is not their fault.  Ask them what they want help with next.";
    case "config_invalid":
      return "Tell the user the lesson JSON is invalid or missing and ask them to fix it in Configure Tools.";
    case "persist_failed":
    case "persist_reload_invalid":
      return "Tell the user progress could not be saved reliably and ask them to retry the exercise flow.";
    case "previous_exercise_not_found":
      return "Tell the user the previous exercise id was not found and tell them we hit an internal erorr that is not their fault.  Ask them what they want help with next..";
    default:
      return "Continue the lesson flow based on the returned status.";
  }
}

function buildLanguageExerciseToolResponse(params: {
  status: LanguageExerciseToolStatus;
  mode: LanguageExerciseToolMode;
  message: string;
  next_action_suggestion?: string;
  config_hash?: string | null;
  summary?: LoadParsedLanguageLessonConfigResult["summary"] | null;
  progress?: ProgressSummary | null;
  overview?: ExerciseOverview | null;
  issue?: LanguageIssuePayload | null;
  exercise?: LanguageExercise | null;
  completed_exercise?: CompletedExercisePayload | null;
  input?: FollowUpInputPayload | null;
  validationErrors?: string[];
  error?: string | null;
}): LanguageExerciseToolResponse {
  return {
    type: "language_exercise_tool_response",
    version: "1.0",
    status: params.status,
    mode: params.mode,
    message: params.message,
    next_action_suggestion:
      params.next_action_suggestion || buildNextActionSuggestion(params.status),
    config_hash: params.config_hash ?? null,
    summary: params.summary ?? null,
    progress: params.progress ?? null,
    overview: params.overview ?? null,
    issue: params.issue ?? null,
    exercise: params.exercise ?? null,
    completed_exercise: params.completed_exercise ?? null,
    input: params.input ?? null,
    validationErrors: params.validationErrors ?? [],
    error: params.error ?? null,
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

function buildToolkitResult(
  payload: unknown,
  updatedToolSessionContext: ToolSessionContext,
): ToolkitResult {
  log.info(
    "[language_lesson] Emitting normalized tool response",
    {},
    {
      payload,
      updatedToolSessionContext,
    },
  );

  return {
    result: JSON.stringify(payload, null, 2),
    updatedToolSessionContext,
  };
}

function buildInvocationState(
  params: GetNextLanguageExerciseParams,
  toolSessionContext: ToolSessionContext,
): InvocationState {
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

  const invocationState: InvocationState = {
    previous_exercise_id,
    user_score,
    performance_notes,
    normalizedPreviousExerciseId,
    hasPreviousExerciseId,
    hasUserScore,
    isInitialCall,
  };

  log.info(
    "[language_lesson] Determined invocation mode",
    {},
    {
      ...invocationState,
      toolSessionContext,
    },
  );

  return invocationState;
}

function validateInvocationOrResult(
  invocationState: InvocationState,
  toolSessionContext: ToolSessionContext,
): ToolkitResult | null {
  if (invocationState.isInitialCall) {
    return null;
  }

  const hasValidUserScore =
    typeof invocationState.user_score === "number" &&
    Number.isFinite(invocationState.user_score);

  if (invocationState.hasPreviousExerciseId && hasValidUserScore) {
    return null;
  }

  const returnPayload = buildLanguageExerciseToolResponse({
    status: "invalid_follow_up_input",
    mode: "follow_up",
    message:
      "Follow-up calls require both previous_exercise_id and numeric user_score.",
    input: {
      previous_exercise_id: invocationState.previous_exercise_id,
      user_score: invocationState.user_score,
      performance_notes: invocationState.performance_notes,
    },
  });

  log.warn(
    "[language_lesson] Returning invalid follow-up input",
    {},
    {
      ...invocationState,
      hasValidUserScore,
      toolSessionContext,
      returnPayload,
    },
  );

  return buildToolkitResult(returnPayload, toolSessionContext);
}

async function loadValidatedConfigOrResult(
  invocationState: InvocationState,
  toolSessionContext: ToolSessionContext,
): Promise<{
  loadedConfigState: LoadedConfigState | null;
  toolkitResult: ToolkitResult | null;
}> {
  const parsedConfigResult = await loadParsedLanguageLessonConfig();

  log.info(
    "[language_lesson] Loaded parsed language lesson config",
    {},
    {
      invocationState,
      parsedConfigResult,
      toolSessionContext,
    },
  );

  if (
    parsedConfigResult.validationErrors.length > 0 ||
    !parsedConfigResult.parsedConfig
  ) {
    const returnPayload = buildLanguageExerciseToolResponse({
      status: "config_invalid",
      mode: invocationState.isInitialCall ? "initial" : "follow_up",
      message:
        "Language lesson config is invalid or missing. Update the JSON in Configure Tools.",
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
      validationErrors: parsedConfigResult.validationErrors,
    });

    log.warn(
      "[language_lesson] Returning config_invalid",
      {},
      {
        invocationState,
        parsedConfigResult,
        returnPayload,
        toolSessionContext,
      },
    );

    return {
      loadedConfigState: null,
      toolkitResult: buildToolkitResult(returnPayload, toolSessionContext),
    };
  }

  const mutableConfig = parsedConfigResult.parsedConfig;
  const progressBefore = summarizeProgress(mutableConfig);

  log.info(
    "[language_lesson] Current progress before operation",
    {},
    {
      invocationState,
      progressBefore,
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
      toolSessionContext,
    },
  );

  return {
    loadedConfigState: {
      parsedConfigResult,
      mutableConfig,
      progressBefore,
    },
    toolkitResult: null,
  };
}

function normalizePerformanceNotes(
  performanceNotes: string | null,
): string | null {
  if (!performanceNotes || performanceNotes.trim().length === 0) {
    return null;
  }

  return performanceNotes;
}

async function persistUpdatedConfigOrErrorResult(
  mutableConfig: NormalizedLanguageLessonConfig,
  parsedConfigResult: LoadParsedLanguageLessonConfigResult,
  previousExerciseId: string,
  toolSessionContext: ToolSessionContext,
): Promise<ToolkitResult | null> {
  try {
    await saveParsedLanguageLessonConfig(mutableConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const returnPayload = buildLanguageExerciseToolResponse({
      status: "persist_failed",
      mode: "follow_up",
      message: "Failed to persist updated language lesson progress.",
      error: errorMessage,
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
    });

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

    return buildToolkitResult(returnPayload, toolSessionContext);
  }

  log.info(
    "[language_lesson] Persisted updated lesson progress",
    {},
    {
      previous_exercise_id: previousExerciseId,
      config_hash_before_save: parsedConfigResult.hash,
      mutableConfig,
      toolSessionContext,
    },
  );

  return null;
}

async function reloadPersistedConfigOrResult(
  toolSessionContext: ToolSessionContext,
): Promise<{
  reloadedConfigResult: LoadParsedLanguageLessonConfigResult | null;
  reloadedConfig: NormalizedLanguageLessonConfig | null;
  toolkitResult: ToolkitResult | null;
}> {
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
    const returnPayload = buildLanguageExerciseToolResponse({
      status: "persist_reload_invalid",
      mode: "follow_up",
      message:
        "Progress was saved but reloading the updated config failed validation.",
      config_hash: reloadedConfigResult.hash,
      summary: reloadedConfigResult.summary,
      validationErrors: reloadedConfigResult.validationErrors,
    });

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
      reloadedConfigResult: null,
      reloadedConfig: null,
      toolkitResult: buildToolkitResult(returnPayload, toolSessionContext),
    };
  }

  return {
    reloadedConfigResult,
    reloadedConfig: reloadedConfigResult.parsedConfig,
    toolkitResult: null,
  };
}

async function handleFollowUpCall(
  invocationState: InvocationState,
  loadedConfigState: LoadedConfigState,
  toolSessionContext: ToolSessionContext,
): Promise<ToolkitResult> {
  const numericScore = invocationState.user_score as number;
  const normalizedPerformanceNotes = normalizePerformanceNotes(
    invocationState.performance_notes,
  );

  const previousExerciseLocator = findExerciseById(
    loadedConfigState.mutableConfig,
    invocationState.normalizedPreviousExerciseId,
  );

  if (!previousExerciseLocator) {
    const returnPayload = buildLanguageExerciseToolResponse({
      status: "previous_exercise_not_found",
      mode: "follow_up",
      message:
        "Could not find previous_exercise_id in current language lesson config.",
      config_hash: loadedConfigState.parsedConfigResult.hash,
      summary: loadedConfigState.parsedConfigResult.summary,
      progress: loadedConfigState.progressBefore,
      input: {
        previous_exercise_id: invocationState.normalizedPreviousExerciseId,
        user_score: numericScore,
        performance_notes: normalizedPerformanceNotes,
      },
    });

    log.warn(
      "[language_lesson] Returning previous_exercise_not_found",
      {},
      {
        invocationState,
        user_score: numericScore,
        performance_notes: normalizedPerformanceNotes,
        availableExerciseIds:
          loadedConfigState.mutableConfig.language_issues.flatMap((issue) =>
            issue.exercises.map((exercise) => exercise.exercise_id),
          ),
        returnPayload,
        toolSessionContext,
      },
    );

    return buildToolkitResult(returnPayload, toolSessionContext);
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
      previous_exercise_id: invocationState.normalizedPreviousExerciseId,
      previousExerciseBeforeUpdate,
      previousExerciseAfterUpdate: previousExerciseLocator.exercise,
      issueIndex: previousExerciseLocator.issueIndex,
      exerciseIndex: previousExerciseLocator.exerciseIndex,
      config_hash_before_save: loadedConfigState.parsedConfigResult.hash,
      progressBefore: loadedConfigState.progressBefore,
      toolSessionContext,
    },
  );

  const persistErrorResult = await persistUpdatedConfigOrErrorResult(
    loadedConfigState.mutableConfig,
    loadedConfigState.parsedConfigResult,
    invocationState.normalizedPreviousExerciseId,
    toolSessionContext,
  );

  if (persistErrorResult) {
    log.warn(
      "[language_lesson] Persistence step returned an error result; ending follow-up flow early",
      {},
      {
        previous_exercise_id: invocationState.normalizedPreviousExerciseId,
        toolSessionContext,
      },
    );
    return persistErrorResult;
  }

  log.info(
    "[language_lesson] Previous exercise progress persisted; continuing to select next exercise",
    {},
    {
      previous_exercise_id: invocationState.normalizedPreviousExerciseId,
      toolSessionContext,
    },
  );

  const reloadOutcome = await reloadPersistedConfigOrResult(toolSessionContext);
  if (reloadOutcome.toolkitResult || !reloadOutcome.reloadedConfigResult) {
    return reloadOutcome.toolkitResult as ToolkitResult;
  }

  const nextLocator = findFirstUnfinishedExercise(
    reloadOutcome.reloadedConfig!,
  );
  const progressAfter = summarizeProgress(reloadOutcome.reloadedConfig!);

  log.info(
    "[language_lesson] Selected next unfinished exercise after save",
    {},
    {
      nextLocator,
      progressAfter,
      config_hash_after_save: reloadOutcome.reloadedConfigResult.hash,
      toolSessionContext,
    },
  );

  if (!nextLocator) {
    const updatedToolSessionContext = buildUpdatedToolSessionContext(
      toolSessionContext,
      null,
      reloadOutcome.reloadedConfigResult.hash,
      previousExerciseLocator.issue.errorId,
    );

    const returnPayload = buildLanguageExerciseToolResponse({
      status: "all_exercises_finished",
      mode: "follow_up",
      message: "All exercises are finished.",
      config_hash: reloadOutcome.reloadedConfigResult.hash,
      summary: reloadOutcome.reloadedConfigResult.summary,
      progress: progressAfter,
      completed_exercise: {
        exercise_id: previousExerciseLocator.exercise.exercise_id,
        issue_error_id: previousExerciseLocator.issue.errorId,
        issue_title: previousExerciseLocator.issue.title,
        score: numericScore,
        notes: normalizedPerformanceNotes,
        finished_at: previousExerciseLocator.exercise.finished_at || null,
      },
    });

    log.info(
      "[language_lesson] Returning all_exercises_finished",
      {},
      {
        returnPayload,
        updatedToolSessionContext,
        toolSessionContext,
      },
    );

    return buildToolkitResult(returnPayload, updatedToolSessionContext);
  }

  const updatedToolSessionContext = buildUpdatedToolSessionContext(
    toolSessionContext,
    nextLocator,
    reloadOutcome.reloadedConfigResult.hash,
  );

  const returnPayload = buildLanguageExerciseToolResponse({
    status: "next_exercise_ready",
    mode: "follow_up",
    message:
      "Previous exercise was marked finished and persisted. Returning the next exercise to give to the user. The exercise details are in the exercise field, and see the issue field for more context.",
    config_hash: reloadOutcome.reloadedConfigResult.hash,
    summary: reloadOutcome.reloadedConfigResult.summary,
    progress: progressAfter,
    completed_exercise: {
      exercise_id: previousExerciseLocator.exercise.exercise_id,
      issue_error_id: previousExerciseLocator.issue.errorId,
      issue_title: previousExerciseLocator.issue.title,
      score: numericScore,
      notes: normalizedPerformanceNotes,
      finished_at: previousExerciseLocator.exercise.finished_at || null,
    },
    overview: {
      issueIndex: nextLocator.issueIndex,
      exerciseIndex: nextLocator.exerciseIndex,
      issueCount: reloadOutcome.reloadedConfigResult.summary.issueCount,
      totalExerciseCount:
        reloadOutcome.reloadedConfigResult.summary.exerciseCount,
      exerciseCountInIssue: nextLocator.issue.exercises.length,
    },
    issue: buildIssuePayload(nextLocator.issue),
    exercise: nextLocator.exercise,
  });

  log.info(
    "[language_lesson] Returning next unfinished exercise after follow-up",
    {},
    {
      returnPayload,
      updatedToolSessionContext,
      toolSessionContext,
    },
  );

  return buildToolkitResult(returnPayload, updatedToolSessionContext);
}

function handleInitialCall(
  loadedConfigState: LoadedConfigState,
  toolSessionContext: ToolSessionContext,
): ToolkitResult {
  const initialLocator = findFirstUnfinishedExercise(
    loadedConfigState.mutableConfig,
  );

  log.info(
    "[language_lesson] Selecting first unfinished exercise for initial call",
    {},
    {
      initialLocator,
      progressBefore: loadedConfigState.progressBefore,
      config_hash: loadedConfigState.parsedConfigResult.hash,
      summary: loadedConfigState.parsedConfigResult.summary,
      toolSessionContext,
    },
  );

  if (!initialLocator) {
    const returnPayload =
      loadedConfigState.progressBefore.totalExerciseCount === 0
        ? buildLanguageExerciseToolResponse({
            status: "no_exercises_available",
            mode: "initial",
            message: "No exercises were found in the language lesson config.",
            config_hash: loadedConfigState.parsedConfigResult.hash,
            summary: loadedConfigState.parsedConfigResult.summary,
            progress: loadedConfigState.progressBefore,
          })
        : buildLanguageExerciseToolResponse({
            status: "all_exercises_finished",
            mode: "initial",
            message: "All exercises are already finished.",
            config_hash: loadedConfigState.parsedConfigResult.hash,
            summary: loadedConfigState.parsedConfigResult.summary,
            progress: loadedConfigState.progressBefore,
          });

    log.warn(
      "[language_lesson] No initial unfinished exercise available",
      {},
      {
        returnPayload,
        progressBefore: loadedConfigState.progressBefore,
        config_hash: loadedConfigState.parsedConfigResult.hash,
        toolSessionContext,
      },
    );

    return buildToolkitResult(returnPayload, toolSessionContext);
  }

  const updatedToolSessionContext = buildUpdatedToolSessionContext(
    toolSessionContext,
    initialLocator,
    loadedConfigState.parsedConfigResult.hash,
  );

  const returnPayload = buildLanguageExerciseToolResponse({
    status: "next_exercise_ready",
    mode: "initial",
    message: "Returning next unfinished exercise.",
    config_hash: loadedConfigState.parsedConfigResult.hash,
    summary: loadedConfigState.parsedConfigResult.summary,
    progress: loadedConfigState.progressBefore,
    overview: {
      issueIndex: initialLocator.issueIndex,
      exerciseIndex: initialLocator.exerciseIndex,
      issueCount: loadedConfigState.parsedConfigResult.summary.issueCount,
      totalExerciseCount:
        loadedConfigState.parsedConfigResult.summary.exerciseCount,
      exerciseCountInIssue: initialLocator.issue.exercises.length,
    },
    issue: buildIssuePayload(initialLocator.issue),
    exercise: initialLocator.exercise,
  });

  log.info(
    "[language_lesson] Returning initial unfinished exercise",
    {},
    {
      returnPayload,
      updatedToolSessionContext,
      toolSessionContext,
    },
  );

  return buildToolkitResult(returnPayload, updatedToolSessionContext);
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
  const invocationState = buildInvocationState(params, toolSessionContext);

  const invocationValidationResult = validateInvocationOrResult(
    invocationState,
    toolSessionContext,
  );
  if (invocationValidationResult) {
    return invocationValidationResult;
  }

  const loadedConfigOutcome = await loadValidatedConfigOrResult(
    invocationState,
    toolSessionContext,
  );
  if (
    loadedConfigOutcome.toolkitResult ||
    !loadedConfigOutcome.loadedConfigState
  ) {
    return loadedConfigOutcome.toolkitResult as ToolkitResult;
  }

  if (invocationState.isInitialCall) {
    return handleInitialCall(
      loadedConfigOutcome.loadedConfigState,
      toolSessionContext,
    );
  }

  return handleFollowUpCall(
    invocationState,
    loadedConfigOutcome.loadedConfigState,
    toolSessionContext,
  );
}

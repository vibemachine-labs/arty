import { log } from "../../../../lib/logger";
import {
  loadParsedLanguageLessonConfig,
  saveParsedLanguageLessonConfig,
  type LoadParsedLanguageLessonConfigResult,
} from "../../../../lib/languageLessonConfig";
import type { NormalizedLanguageLessonConfig } from "./language_lesson_schema";
import type { ToolSessionContext, ToolkitResult } from "./types";

export interface StartFirstExerciseParams {}

export interface GradeUserExerciseParams {
  previous_exercise_id?: string | null;
  user_score?: number | null;
  performance_notes?: string | null;
}

export interface StartNextExerciseParams {
  previous_exercise_id?: string | null;
}

// Backward-compat alias for legacy tool callers.
export type GetNextLanguageExerciseParams = GradeUserExerciseParams;

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

interface LoadedConfigState {
  parsedConfigResult: LoadParsedLanguageLessonConfigResult;
  mutableConfig: NormalizedLanguageLessonConfig;
  progressBefore: ProgressSummary;
}

type LanguageExerciseToolMode = "initial" | "follow_up";

type LanguageExerciseToolStatus =
  | "next_exercise_ready"
  | "ready_for_next_exercise"
  | "retry_current_exercise"
  | "all_exercises_finished"
  | "no_exercises_available"
  | "invalid_follow_up_input"
  | "config_invalid"
  | "persist_failed"
  | "persist_reload_invalid"
  | "previous_exercise_not_found"
  | "exercise_already_finished";

interface ExerciseOverview {
  issueIndex: number;
  exerciseIndex: number;
  issueCount: number;
  totalExerciseCount: number;
  exerciseCountInIssue: number;
}

interface CompletedExercisePayload {
  exercise_id: string;
}

interface GradingResultPayload {
  user_score: number;
  performance_notes: string | null;
  passed: boolean;
  passing_score_threshold: number;
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
  next_exercise: LanguageExercise | null;
  completed_exercise: CompletedExercisePayload | null;
  grading_result: GradingResultPayload | null;
  input: FollowUpInputPayload | null;
  validationErrors: string[];
  error: string | null;
}

interface ValidatedGradeInput {
  previousExerciseId: string;
  userScore: number;
  performanceNotes: string | null;
}

const MIN_USER_SCORE = 0;
const MAX_USER_SCORE = 10;
const PASSING_SCORE_THRESHOLD = 8;

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
      return "Present next_exercise to the user now. After the user responds, call language_lesson__grade_user_exercise with previous_exercise_id, user_score, and optional performance_notes.";
    case "ready_for_next_exercise":
      return "Tell the user their score and why using grading_result, then call language_lesson__start_next_exercise to fetch the next unfinished exercise.";
    case "retry_current_exercise":
      return "Tell the user their score and why using grading_result, ask them to retry the exercise in next_exercise, then call language_lesson__grade_user_exercise again with previous_exercise_id, user_score, and performance_notes.";
    case "all_exercises_finished":
      return "Congratulate the user for finishing all exercises and ask if they want to practice a new issue.";
    case "no_exercises_available":
      return "Tell the user no exercises are currently configured and ask them to add language lesson JSON in Language Lesson settings.";
    case "invalid_follow_up_input":
      return "Apologize to the user and tell them we hit an internal error that is not their fault. Ask them what they want help with next.";
    case "config_invalid":
      return "Tell the user the lesson JSON is invalid or missing and ask them to fix it in Language Lesson settings.";
    case "persist_failed":
    case "persist_reload_invalid":
      return "Tell the user progress could not be saved reliably and ask them to retry the exercise flow.";
    case "previous_exercise_not_found":
      return "Tell the user the pending exercise id was not found and that this internal issue is not their fault. Ask what they want help with next.";
    case "exercise_already_finished":
      return "Tell the user this exercise was already finished. If they want to continue the lesson, call language_lesson__start_next_exercise with the same previous_exercise_id.";
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
  next_exercise?: LanguageExercise | null;
  completed_exercise?: CompletedExercisePayload | null;
  grading_result?: GradingResultPayload | null;
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
    next_exercise: params.next_exercise ?? null,
    completed_exercise: params.completed_exercise ?? null,
    grading_result: params.grading_result ?? null,
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

function normalizeOptionalTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidUserScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_USER_SCORE &&
    value <= MAX_USER_SCORE
  );
}

function normalizePerformanceNotes(
  performanceNotes: string | null | undefined,
): string | null {
  if (
    typeof performanceNotes !== "string" ||
    performanceNotes.trim().length === 0
  ) {
    return null;
  }

  return performanceNotes;
}

async function loadValidatedConfigOrResult(
  mode: LanguageExerciseToolMode,
  toolSessionContext: ToolSessionContext,
  logContext: Record<string, unknown>,
): Promise<{
  loadedConfigState: LoadedConfigState | null;
  toolkitResult: ToolkitResult | null;
}> {
  const parsedConfigResult = await loadParsedLanguageLessonConfig();

  log.info(
    "[language_lesson] Loaded parsed language lesson config",
    {},
    {
      mode,
      logContext,
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
      mode,
      message:
        "Language lesson config is invalid or missing. Update the JSON in Language Lesson settings.",
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
      validationErrors: parsedConfigResult.validationErrors,
    });

    log.warn(
      "[language_lesson] Returning config_invalid",
      {},
      {
        mode,
        logContext,
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
      mode,
      logContext,
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

async function persistUpdatedConfigOrErrorResult(
  mutableConfig: NormalizedLanguageLessonConfig,
  parsedConfigResult: LoadParsedLanguageLessonConfigResult,
  mode: LanguageExerciseToolMode,
  toolSessionContext: ToolSessionContext,
  logContext: Record<string, unknown>,
): Promise<ToolkitResult | null> {
  try {
    await saveParsedLanguageLessonConfig(mutableConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const returnPayload = buildLanguageExerciseToolResponse({
      status: "persist_failed",
      mode,
      message: "Failed to persist updated language lesson progress.",
      error: errorMessage,
      config_hash: parsedConfigResult.hash,
      summary: parsedConfigResult.summary,
    });

    log.error(
      "[language_lesson] Failed to persist updated lesson progress",
      {},
      {
        mode,
        logContext,
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
      mode,
      logContext,
      config_hash_before_save: parsedConfigResult.hash,
      mutableConfig,
      toolSessionContext,
    },
  );

  return null;
}

async function reloadPersistedConfigOrResult(
  mode: LanguageExerciseToolMode,
  toolSessionContext: ToolSessionContext,
  logContext: Record<string, unknown>,
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
      mode,
      logContext,
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
      mode,
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
        mode,
        logContext,
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

function updateExerciseAttemptState(params: {
  exercise: LanguageExercise;
  userScore: number;
  performanceNotes: string | null;
  passed: boolean;
}): void {
  const existingAttempts =
    typeof params.exercise.attempts === "number" ? params.exercise.attempts : 0;

  params.exercise.attempts = existingAttempts + 1;
  params.exercise.last_score = params.userScore;
  params.exercise.last_notes = params.performanceNotes;

  if (params.passed) {
    params.exercise.status = "finished";
    params.exercise.finished_at = new Date().toISOString();
    return;
  }

  params.exercise.status = "pending";
  params.exercise.finished_at = null;
}

function buildSelectionResult(params: {
  mode: LanguageExerciseToolMode;
  parsedConfigResult: LoadParsedLanguageLessonConfigResult;
  config: NormalizedLanguageLessonConfig;
  progress: ProgressSummary;
  toolSessionContext: ToolSessionContext;
  completedExerciseId?: string;
}): ToolkitResult {
  const nextLocator = findFirstUnfinishedExercise(params.config);

  log.info(
    "[language_lesson] Selecting next unfinished exercise",
    {},
    {
      mode: params.mode,
      nextLocator,
      progress: params.progress,
      config_hash: params.parsedConfigResult.hash,
      summary: params.parsedConfigResult.summary,
      completedExerciseId: params.completedExerciseId ?? null,
      toolSessionContext: params.toolSessionContext,
    },
  );

  if (!nextLocator) {
    const status: LanguageExerciseToolStatus =
      params.progress.totalExerciseCount === 0
        ? "no_exercises_available"
        : "all_exercises_finished";

    const message =
      status === "no_exercises_available"
        ? "No exercises were found in the language lesson config."
        : "All exercises are finished.";

    const updatedToolSessionContext = buildUpdatedToolSessionContext(
      params.toolSessionContext,
      null,
      params.parsedConfigResult.hash,
      params.toolSessionContext.current_issue_error_id,
    );

    const returnPayload = buildLanguageExerciseToolResponse({
      status,
      mode: params.mode,
      message,
      config_hash: params.parsedConfigResult.hash,
      summary: params.parsedConfigResult.summary,
      progress: params.progress,
      completed_exercise: params.completedExerciseId
        ? { exercise_id: params.completedExerciseId }
        : null,
    });

    log.info(
      "[language_lesson] Returning selection result with no unfinished exercises",
      {},
      {
        mode: params.mode,
        returnPayload,
        updatedToolSessionContext,
        toolSessionContext: params.toolSessionContext,
      },
    );

    return buildToolkitResult(returnPayload, updatedToolSessionContext);
  }

  const updatedToolSessionContext = buildUpdatedToolSessionContext(
    params.toolSessionContext,
    nextLocator,
    params.parsedConfigResult.hash,
  );

  const returnPayload = buildLanguageExerciseToolResponse({
    status: "next_exercise_ready",
    mode: params.mode,
    message:
      "Returning the next exercise to give to the user. The next exercise details are in the next_exercise field.",
    config_hash: params.parsedConfigResult.hash,
    summary: params.parsedConfigResult.summary,
    progress: params.progress,
    completed_exercise: params.completedExerciseId
      ? { exercise_id: params.completedExerciseId }
      : null,
    overview: {
      issueIndex: nextLocator.issueIndex,
      exerciseIndex: nextLocator.exerciseIndex,
      issueCount: params.parsedConfigResult.summary.issueCount,
      totalExerciseCount: params.parsedConfigResult.summary.exerciseCount,
      exerciseCountInIssue: nextLocator.issue.exercises.length,
    },
    issue: buildIssuePayload(nextLocator.issue),
    next_exercise: nextLocator.exercise,
  });

  log.info(
    "[language_lesson] Returning next_exercise_ready",
    {},
    {
      mode: params.mode,
      returnPayload,
      updatedToolSessionContext,
      toolSessionContext: params.toolSessionContext,
    },
  );

  return buildToolkitResult(returnPayload, updatedToolSessionContext);
}

function validateGradeInputOrResult(
  params: GradeUserExerciseParams,
  toolSessionContext: ToolSessionContext,
): {
  validatedInput: ValidatedGradeInput | null;
  toolkitResult: ToolkitResult | null;
} {
  const normalizedPreviousExerciseId = normalizeOptionalTrimmedString(
    params.previous_exercise_id,
  );
  const hasPreviousExerciseId = normalizedPreviousExerciseId.length > 0;
  const hasValidUserScore = isValidUserScore(params.user_score);

  log.info(
    "[language_lesson] Validating grade_user_exercise input",
    {},
    {
      params,
      normalizedPreviousExerciseId,
      hasPreviousExerciseId,
      hasValidUserScore,
      toolSessionContext,
    },
  );

  if (!hasPreviousExerciseId || !hasValidUserScore) {
    const returnPayload = buildLanguageExerciseToolResponse({
      status: "invalid_follow_up_input",
      mode: "follow_up",
      message:
        "grade_user_exercise requires both previous_exercise_id and numeric user_score between 0 and 10.",
      input: {
        previous_exercise_id: params.previous_exercise_id ?? null,
        user_score: params.user_score ?? null,
        performance_notes: params.performance_notes ?? null,
      },
    });

    log.warn(
      "[language_lesson] Returning invalid follow-up input for grade_user_exercise",
      {},
      {
        params,
        normalizedPreviousExerciseId,
        hasPreviousExerciseId,
        hasValidUserScore,
        returnPayload,
        toolSessionContext,
      },
    );

    return {
      validatedInput: null,
      toolkitResult: buildToolkitResult(returnPayload, toolSessionContext),
    };
  }

  return {
    validatedInput: {
      previousExerciseId: normalizedPreviousExerciseId,
      userScore: params.user_score as number,
      performanceNotes: normalizePerformanceNotes(params.performance_notes),
    },
    toolkitResult: null,
  };
}

function parseToolResponse(
  result: ToolkitResult,
): LanguageExerciseToolResponse | null {
  try {
    const parsed = JSON.parse(result.result);
    if (parsed && parsed.type === "language_exercise_tool_response") {
      return parsed as LanguageExerciseToolResponse;
    }
  } catch (error) {
    log.warn(
      "[language_lesson] Failed to parse toolkit result payload",
      {},
      {
        result,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return null;
}

export async function start_first_exercise(
  _params: StartFirstExerciseParams = {},
  _context_params?: any,
  toolSessionContext: ToolSessionContext = {},
): Promise<ToolkitResult> {
  log.info(
    "[language_lesson] start_first_exercise called",
    {},
    {
      toolSessionContext,
    },
  );

  const loadedConfigOutcome = await loadValidatedConfigOrResult(
    "initial",
    toolSessionContext,
    {
      tool: "start_first_exercise",
    },
  );

  if (
    loadedConfigOutcome.toolkitResult ||
    !loadedConfigOutcome.loadedConfigState
  ) {
    return loadedConfigOutcome.toolkitResult as ToolkitResult;
  }

  return buildSelectionResult({
    mode: "initial",
    parsedConfigResult:
      loadedConfigOutcome.loadedConfigState.parsedConfigResult,
    config: loadedConfigOutcome.loadedConfigState.mutableConfig,
    progress: loadedConfigOutcome.loadedConfigState.progressBefore,
    toolSessionContext,
  });
}

export async function grade_user_exercise(
  params: GradeUserExerciseParams = {},
  _context_params?: any,
  toolSessionContext: ToolSessionContext = {},
): Promise<ToolkitResult> {
  log.info(
    "[language_lesson] grade_user_exercise called",
    {},
    {
      params,
      toolSessionContext,
      passingScoreThreshold: PASSING_SCORE_THRESHOLD,
    },
  );

  const gradeValidation = validateGradeInputOrResult(
    params,
    toolSessionContext,
  );
  if (gradeValidation.toolkitResult || !gradeValidation.validatedInput) {
    return gradeValidation.toolkitResult as ToolkitResult;
  }

  const validatedInput = gradeValidation.validatedInput;

  const loadedConfigOutcome = await loadValidatedConfigOrResult(
    "follow_up",
    toolSessionContext,
    {
      tool: "grade_user_exercise",
      validatedInput,
    },
  );

  if (
    loadedConfigOutcome.toolkitResult ||
    !loadedConfigOutcome.loadedConfigState
  ) {
    return loadedConfigOutcome.toolkitResult as ToolkitResult;
  }

  const loadedConfigState = loadedConfigOutcome.loadedConfigState;

  const pendingExerciseLocator = findExerciseById(
    loadedConfigState.mutableConfig,
    validatedInput.previousExerciseId,
  );

  if (!pendingExerciseLocator) {
    const returnPayload = buildLanguageExerciseToolResponse({
      status: "previous_exercise_not_found",
      mode: "follow_up",
      message:
        "Could not find previous_exercise_id in current language lesson config.",
      config_hash: loadedConfigState.parsedConfigResult.hash,
      summary: loadedConfigState.parsedConfigResult.summary,
      progress: loadedConfigState.progressBefore,
      input: {
        previous_exercise_id: validatedInput.previousExerciseId,
        user_score: validatedInput.userScore,
        performance_notes: validatedInput.performanceNotes,
      },
    });

    log.warn(
      "[language_lesson] Returning previous_exercise_not_found from grade_user_exercise",
      {},
      {
        validatedInput,
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

  if (isExerciseFinished(pendingExerciseLocator.exercise)) {
    const updatedToolSessionContext = buildUpdatedToolSessionContext(
      toolSessionContext,
      pendingExerciseLocator,
      loadedConfigState.parsedConfigResult.hash,
      pendingExerciseLocator.issue.errorId,
    );

    const returnPayload = buildLanguageExerciseToolResponse({
      status: "exercise_already_finished",
      mode: "follow_up",
      message:
        "previous_exercise_id already refers to a finished exercise. Progress was not changed.",
      config_hash: loadedConfigState.parsedConfigResult.hash,
      summary: loadedConfigState.parsedConfigResult.summary,
      progress: loadedConfigState.progressBefore,
      completed_exercise: {
        exercise_id: validatedInput.previousExerciseId,
      },
      input: {
        previous_exercise_id: validatedInput.previousExerciseId,
        user_score: validatedInput.userScore,
        performance_notes: validatedInput.performanceNotes,
      },
    });

    log.warn(
      "[language_lesson] Refusing to re-grade an already finished exercise",
      {},
      {
        validatedInput,
        pendingExercise: pendingExerciseLocator.exercise,
        progressBefore: loadedConfigState.progressBefore,
        returnPayload,
        updatedToolSessionContext,
        toolSessionContext,
      },
    );

    return buildToolkitResult(returnPayload, updatedToolSessionContext);
  }

  const passed = validatedInput.userScore >= PASSING_SCORE_THRESHOLD;
  const pendingExerciseBeforeUpdate = { ...pendingExerciseLocator.exercise };

  updateExerciseAttemptState({
    exercise: pendingExerciseLocator.exercise,
    userScore: validatedInput.userScore,
    performanceNotes: validatedInput.performanceNotes,
    passed,
  });

  log.info(
    "[language_lesson] Updated pending exercise state before persistence",
    {},
    {
      validatedInput,
      passed,
      passingScoreThreshold: PASSING_SCORE_THRESHOLD,
      pendingExerciseBeforeUpdate,
      pendingExerciseAfterUpdate: pendingExerciseLocator.exercise,
      issueIndex: pendingExerciseLocator.issueIndex,
      exerciseIndex: pendingExerciseLocator.exerciseIndex,
      progressBefore: loadedConfigState.progressBefore,
      config_hash_before_save: loadedConfigState.parsedConfigResult.hash,
      toolSessionContext,
    },
  );

  const persistErrorResult = await persistUpdatedConfigOrErrorResult(
    loadedConfigState.mutableConfig,
    loadedConfigState.parsedConfigResult,
    "follow_up",
    toolSessionContext,
    {
      tool: "grade_user_exercise",
      validatedInput,
      passed,
    },
  );

  if (persistErrorResult) {
    return persistErrorResult;
  }

  const reloadOutcome = await reloadPersistedConfigOrResult(
    "follow_up",
    toolSessionContext,
    {
      tool: "grade_user_exercise",
      validatedInput,
      passed,
    },
  );

  if (reloadOutcome.toolkitResult || !reloadOutcome.reloadedConfigResult) {
    return reloadOutcome.toolkitResult as ToolkitResult;
  }

  const progressAfter = summarizeProgress(reloadOutcome.reloadedConfig!);

  if (passed) {
    const updatedToolSessionContext = buildUpdatedToolSessionContext(
      toolSessionContext,
      null,
      reloadOutcome.reloadedConfigResult.hash,
      pendingExerciseLocator.issue.errorId,
    );

    const returnPayload = buildLanguageExerciseToolResponse({
      status: "ready_for_next_exercise",
      mode: "follow_up",
      message:
        "Pending exercise was graded as passing and persisted. Tell the user their score and why this score was assigned, then call language_lesson__start_next_exercise to fetch the next unfinished exercise.",
      config_hash: reloadOutcome.reloadedConfigResult.hash,
      summary: reloadOutcome.reloadedConfigResult.summary,
      progress: progressAfter,
      completed_exercise: {
        exercise_id: validatedInput.previousExerciseId,
      },
      grading_result: {
        user_score: validatedInput.userScore,
        performance_notes: validatedInput.performanceNotes,
        passed,
        passing_score_threshold: PASSING_SCORE_THRESHOLD,
      },
    });

    log.info(
      "[language_lesson] Returning ready_for_next_exercise",
      {},
      {
        validatedInput,
        passed,
        returnPayload,
        updatedToolSessionContext,
        toolSessionContext,
      },
    );

    return buildToolkitResult(returnPayload, updatedToolSessionContext);
  }

  const retryLocator = findExerciseById(
    reloadOutcome.reloadedConfig!,
    validatedInput.previousExerciseId,
  );

  if (!retryLocator) {
    const returnPayload = buildLanguageExerciseToolResponse({
      status: "previous_exercise_not_found",
      mode: "follow_up",
      message:
        "Could not find previous_exercise_id after persistence while preparing retry guidance.",
      config_hash: reloadOutcome.reloadedConfigResult.hash,
      summary: reloadOutcome.reloadedConfigResult.summary,
      progress: progressAfter,
      input: {
        previous_exercise_id: validatedInput.previousExerciseId,
        user_score: validatedInput.userScore,
        performance_notes: validatedInput.performanceNotes,
      },
    });

    log.error(
      "[language_lesson] Retry locator missing after persisted fail grading",
      {},
      {
        validatedInput,
        progressAfter,
        returnPayload,
        toolSessionContext,
      },
    );

    return buildToolkitResult(returnPayload, toolSessionContext);
  }

  const updatedToolSessionContext = buildUpdatedToolSessionContext(
    toolSessionContext,
    retryLocator,
    reloadOutcome.reloadedConfigResult.hash,
  );

  const returnPayload = buildLanguageExerciseToolResponse({
    status: "retry_current_exercise",
    mode: "follow_up",
    message:
      "Pending exercise score was below passing threshold and was persisted. Tell the user their score and why this score was assigned, then ask the user to retry this same exercise.",
    config_hash: reloadOutcome.reloadedConfigResult.hash,
    summary: reloadOutcome.reloadedConfigResult.summary,
    progress: progressAfter,
    overview: {
      issueIndex: retryLocator.issueIndex,
      exerciseIndex: retryLocator.exerciseIndex,
      issueCount: reloadOutcome.reloadedConfigResult.summary.issueCount,
      totalExerciseCount:
        reloadOutcome.reloadedConfigResult.summary.exerciseCount,
      exerciseCountInIssue: retryLocator.issue.exercises.length,
    },
    issue: buildIssuePayload(retryLocator.issue),
    next_exercise: retryLocator.exercise,
    grading_result: {
      user_score: validatedInput.userScore,
      performance_notes: validatedInput.performanceNotes,
      passed,
      passing_score_threshold: PASSING_SCORE_THRESHOLD,
    },
    input: {
      previous_exercise_id: validatedInput.previousExerciseId,
      user_score: validatedInput.userScore,
      performance_notes: validatedInput.performanceNotes,
    },
  });

  log.info(
    "[language_lesson] Returning retry_current_exercise",
    {},
    {
      validatedInput,
      passed,
      passingScoreThreshold: PASSING_SCORE_THRESHOLD,
      returnPayload,
      updatedToolSessionContext,
      toolSessionContext,
    },
  );

  return buildToolkitResult(returnPayload, updatedToolSessionContext);
}

export async function start_next_exercise(
  params: StartNextExerciseParams = {},
  _context_params?: any,
  toolSessionContext: ToolSessionContext = {},
): Promise<ToolkitResult> {
  const normalizedPreviousExerciseId = normalizeOptionalTrimmedString(
    params.previous_exercise_id,
  );

  log.info(
    "[language_lesson] start_next_exercise called",
    {},
    {
      params,
      normalizedPreviousExerciseId,
      hasPreviousExerciseId: normalizedPreviousExerciseId.length > 0,
      toolSessionContext,
    },
  );

  const loadedConfigOutcome = await loadValidatedConfigOrResult(
    "follow_up",
    toolSessionContext,
    {
      tool: "start_next_exercise",
      previous_exercise_id: normalizedPreviousExerciseId || null,
    },
  );

  if (
    loadedConfigOutcome.toolkitResult ||
    !loadedConfigOutcome.loadedConfigState
  ) {
    return loadedConfigOutcome.toolkitResult as ToolkitResult;
  }

  return buildSelectionResult({
    mode: "follow_up",
    parsedConfigResult:
      loadedConfigOutcome.loadedConfigState.parsedConfigResult,
    config: loadedConfigOutcome.loadedConfigState.mutableConfig,
    progress: loadedConfigOutcome.loadedConfigState.progressBefore,
    toolSessionContext,
    completedExerciseId: normalizedPreviousExerciseId || undefined,
  });
}

/**
 * Backward-compat shim for legacy callers.
 *
 * New flow:
 * - language_lesson__start_first_exercise
 * - language_lesson__grade_user_exercise
 * - language_lesson__start_next_exercise
 */
export async function get_next_language_exercise(
  params: GetNextLanguageExerciseParams = {},
  _context_params?: any,
  toolSessionContext: ToolSessionContext = {},
): Promise<ToolkitResult> {
  log.warn(
    "[language_lesson] get_next_language_exercise is deprecated; use start_first_exercise/grade_user_exercise/start_next_exercise",
    {},
    {
      params,
      toolSessionContext,
    },
  );

  const normalizedPreviousExerciseId = normalizeOptionalTrimmedString(
    params.previous_exercise_id,
  );
  const hasPreviousExerciseId = normalizedPreviousExerciseId.length > 0;
  const hasUserScore =
    params.user_score !== null && params.user_score !== undefined;

  if (!hasPreviousExerciseId && !hasUserScore) {
    return start_first_exercise({}, _context_params, toolSessionContext);
  }

  const gradeResult = await grade_user_exercise(
    {
      previous_exercise_id: params.previous_exercise_id,
      user_score: params.user_score,
      performance_notes: params.performance_notes,
    },
    _context_params,
    toolSessionContext,
  );

  const parsedGradeResult = parseToolResponse(gradeResult);
  if (parsedGradeResult?.status !== "ready_for_next_exercise") {
    return gradeResult;
  }

  return start_next_exercise(
    {
      previous_exercise_id: normalizedPreviousExerciseId || null,
    },
    _context_params,
    gradeResult.updatedToolSessionContext,
  );
}

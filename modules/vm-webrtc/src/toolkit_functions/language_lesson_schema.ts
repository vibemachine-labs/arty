import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const DEFAULT_EXERCISE_NORMALIZATION = {
  casefold: true,
  strip_punctuation: true,
  trim_whitespace: true,
};

const DEFAULT_EXERCISE_CHECKS = {
  must_contain: [] as string[],
  must_match_regex_all: [] as string[],
  forbid_regex_any: [] as string[],
};

const DEFAULT_EXERCISE_FEEDBACK = {
  on_fail: undefined as string | undefined,
  hint_levels: [] as string[],
};

const DEFAULT_SPOKEN_FEEDBACK = {
  on_fail: undefined as
    | string
    | { level: number; text: string }[]
    | undefined,
  on_pass: undefined as string | undefined,
};

const DEFAULT_EXERCISE_METADATA = {
  difficulty: undefined as number | undefined,
  tags: [] as string[],
};

const DEFAULT_EXERCISE_PRESENTATION_RULES = {
  max_hint_level: 2,
  shuffle_exercises: true,
  speak_theory_before_first_exercise: true,
  spoken_corrections_after_each_attempt: true,
  allow_self_correction_window_seconds: 2.0,
};

const DEFAULT_EXERCISES_SPEC = {
  num_times_repeat_on_fail: 3,
  num_exercises_required_for_pass: 0.2,
  presentation_rules: DEFAULT_EXERCISE_PRESENTATION_RULES,
};

const languageIssueExampleSchema = z
  .object({
    userSaid: nonEmptyString,
    nativeTarget: nonEmptyString,
    tsStart: z.number(),
    tsEnd: z.number(),
  })
  .strict();

const theoryVoiceExamplePairSchema = z
  .object({
    incorrect: nonEmptyString,
    correct: nonEmptyString,
  })
  .strict();

const theoryVoiceSchema = z
  .object({
    spoken_explanation: nonEmptyString,
    example_pairs_audio: z
      .array(theoryVoiceExamplePairSchema)
      .optional()
      .default([]),
  })
  .strict();

const exerciseNormalizationSchema = z
  .object({
    casefold: z.boolean().optional(),
    strip_punctuation: z.boolean().optional(),
    trim_whitespace: z.boolean().optional(),
  })
  .strict()
  .optional()
  .transform((value) => ({
    casefold: value?.casefold ?? DEFAULT_EXERCISE_NORMALIZATION.casefold,
    strip_punctuation:
      value?.strip_punctuation ??
      DEFAULT_EXERCISE_NORMALIZATION.strip_punctuation,
    trim_whitespace:
      value?.trim_whitespace ?? DEFAULT_EXERCISE_NORMALIZATION.trim_whitespace,
  }));

const exerciseExpectedAnswersSchema = z
  .object({
    accepted_answers: z.array(nonEmptyString).min(1),
    normalize: exerciseNormalizationSchema,
  })
  .strict();

const exerciseChecksSchema = z
  .object({
    must_contain: z.array(nonEmptyString).optional(),
    must_match_regex_all: z.array(nonEmptyString).optional(),
    forbid_regex_any: z.array(nonEmptyString).optional(),
  })
  .strict()
  .optional()
  .transform((value) => ({
    must_contain: value?.must_contain ?? DEFAULT_EXERCISE_CHECKS.must_contain,
    must_match_regex_all:
      value?.must_match_regex_all ??
      DEFAULT_EXERCISE_CHECKS.must_match_regex_all,
    forbid_regex_any:
      value?.forbid_regex_any ?? DEFAULT_EXERCISE_CHECKS.forbid_regex_any,
  }));

const exerciseFeedbackSchema = z
  .object({
    on_fail: nonEmptyString.optional(),
    hint_levels: z.array(nonEmptyString).optional(),
  })
  .strict()
  .optional()
  .transform((value) => ({
    on_fail: value?.on_fail ?? DEFAULT_EXERCISE_FEEDBACK.on_fail,
    hint_levels: value?.hint_levels ?? DEFAULT_EXERCISE_FEEDBACK.hint_levels,
  }));

const spokenOnFailLevelSchema = z
  .object({
    level: z.number().int().min(1),
    text: nonEmptyString,
  })
  .strict();

const spokenFeedbackSchema = z
  .object({
    on_fail: z
      .union([nonEmptyString, z.array(spokenOnFailLevelSchema).min(1)])
      .optional(),
    on_pass: nonEmptyString.optional(),
  })
  .strict()
  .optional()
  .transform((value) => ({
    on_fail: value?.on_fail ?? DEFAULT_SPOKEN_FEEDBACK.on_fail,
    on_pass: value?.on_pass ?? DEFAULT_SPOKEN_FEEDBACK.on_pass,
  }));

const exerciseMetadataSchema = z
  .object({
    difficulty: z.number().optional(),
    tags: z.array(nonEmptyString).optional(),
  })
  .strict()
  .optional()
  .transform((value) => ({
    difficulty: value?.difficulty ?? DEFAULT_EXERCISE_METADATA.difficulty,
    tags: value?.tags ?? DEFAULT_EXERCISE_METADATA.tags,
  }));

const translateExerciseSchema = z
  .object({
    exercise_id: nonEmptyString,
    type: z.literal("translate"),
    prompt: nonEmptyString,
    expected: exerciseExpectedAnswersSchema,
    checks: exerciseChecksSchema,
    feedback: exerciseFeedbackSchema,
    metadata: exerciseMetadataSchema,
  })
  .strict();

const chooseOneOptionSchema = z
  .object({
    id: nonEmptyString,
    text: nonEmptyString,
  })
  .strict();

const chooseOneExerciseSchema = z
  .object({
    exercise_id: nonEmptyString,
    type: z.literal("choose_one"),
    prompt: nonEmptyString,
    stem: nonEmptyString.optional(),
    options: z.array(chooseOneOptionSchema).min(2),
    answer: z
      .object({
        correct_option_id: nonEmptyString,
      })
      .strict(),
    rationale: nonEmptyString.optional(),
    feedback: exerciseFeedbackSchema,
    metadata: exerciseMetadataSchema,
  })
  .strict()
  .superRefine((exercise, ctx) => {
    const optionIds = new Set(exercise.options.map((option) => option.id));
    if (!optionIds.has(exercise.answer.correct_option_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "answer.correct_option_id must match one of the provided option ids",
        path: ["answer", "correct_option_id"],
      });
    }
  });

const correctTheSentenceExerciseSchema = z
  .object({
    exercise_id: nonEmptyString,
    type: z.literal("correct_the_sentence"),
    prompt: nonEmptyString,
    sentence: nonEmptyString,
    expected: exerciseExpectedAnswersSchema,
    checks: exerciseChecksSchema,
    feedback: exerciseFeedbackSchema,
    metadata: exerciseMetadataSchema,
  })
  .strict();

const speechLearnerResponseSchema = z
  .object({
    mode: z.literal("speech"),
  })
  .strict();

const firstSecondEnumSchema = z.enum(["first", "second"]);

const listenLearnerResponseSchema = z
  .object({
    mode: z.literal("speech"),
    expected: z.array(firstSecondEnumSchema).min(1).optional(),
  })
  .strict();

const spokenCommonErrorPatternSchema = z
  .object({
    pattern: nonEmptyString,
    diagnosis: nonEmptyString,
  })
  .strict();

const spokenToleranceSchema = z
  .object({
    allow_minor_disfluencies: z.boolean().optional(),
    allow_article_variation: z.boolean().optional(),
  })
  .strict();

const spokenTranslationExerciseSchema = z
  .object({
    exercise_id: nonEmptyString,
    type: z.literal("spoken_translation"),
    agent_prompt_spoken: nonEmptyString,
    learner_response: speechLearnerResponseSchema,
    grading: z
      .object({
        semantic_target: nonEmptyString,
        must_include_concepts: z.array(nonEmptyString).optional(),
        common_error_patterns: z
          .array(spokenCommonErrorPatternSchema)
          .optional(),
        tolerance: spokenToleranceSchema.optional(),
      })
      .strict(),
    spoken_feedback: spokenFeedbackSchema,
    metadata: exerciseMetadataSchema,
  })
  .strict();

const listenAndDiscriminateExerciseSchema = z
  .object({
    exercise_id: nonEmptyString,
    type: z.literal("listen_and_discriminate"),
    agent_prompt_spoken: nonEmptyString,
    audio_pairs: z
      .array(
        z
          .object({
            first: nonEmptyString,
            second: nonEmptyString,
          })
          .strict(),
      )
      .min(1),
    learner_response: listenLearnerResponseSchema,
    grading: z
      .object({
        correct_answer: z.union([
          firstSecondEnumSchema,
          z.array(firstSecondEnumSchema).min(1),
        ]),
      })
      .strict(),
    spoken_feedback: spokenFeedbackSchema,
    metadata: exerciseMetadataSchema,
  })
  .strict();

const spokenCorrectionExerciseSchema = z
  .object({
    exercise_id: nonEmptyString,
    type: z.literal("spoken_correction"),
    agent_prompt_spoken: nonEmptyString,
    learner_response: speechLearnerResponseSchema,
    grading: z
      .object({
        required_fix: nonEmptyString,
        target_structure: nonEmptyString,
      })
      .strict(),
    spoken_feedback: spokenFeedbackSchema,
    metadata: exerciseMetadataSchema,
  })
  .strict();

const spokenPatternCompletionExerciseSchema = z
  .object({
    exercise_id: nonEmptyString,
    type: z.literal("spoken_pattern_completion"),
    agent_prompt_spoken: nonEmptyString,
    learner_response: speechLearnerResponseSchema,
    grading: z
      .object({
        expected_word: nonEmptyString,
        forbidden_patterns: z.array(nonEmptyString).optional(),
      })
      .strict(),
    spoken_feedback: spokenFeedbackSchema,
    metadata: exerciseMetadataSchema,
  })
  .strict();

export const languageExerciseSchema = z.discriminatedUnion("type", [
  translateExerciseSchema,
  chooseOneExerciseSchema,
  correctTheSentenceExerciseSchema,
  spokenTranslationExerciseSchema,
  listenAndDiscriminateExerciseSchema,
  spokenCorrectionExerciseSchema,
  spokenPatternCompletionExerciseSchema,
]);

const exercisePresentationRulesSchema = z
  .object({
    max_hint_level: z.number().int().min(0).optional(),
    shuffle_exercises: z.boolean().optional(),
    speak_theory_before_first_exercise: z.boolean().optional(),
    spoken_corrections_after_each_attempt: z.boolean().optional(),
    allow_self_correction_window_seconds: z.number().min(0).optional(),
    show_theory_before_first_exercise: z.boolean().optional(),
    show_corrections_after_each_attempt: z.boolean().optional(),
  })
  .strict()
  .optional()
  .transform((value) => {
    const speakTheoryBeforeFirstExercise =
      value?.speak_theory_before_first_exercise ??
      value?.show_theory_before_first_exercise ??
      DEFAULT_EXERCISE_PRESENTATION_RULES.speak_theory_before_first_exercise;

    const spokenCorrectionsAfterEachAttempt =
      value?.spoken_corrections_after_each_attempt ??
      value?.show_corrections_after_each_attempt ??
      DEFAULT_EXERCISE_PRESENTATION_RULES.spoken_corrections_after_each_attempt;

    return {
      max_hint_level:
        value?.max_hint_level ??
        DEFAULT_EXERCISE_PRESENTATION_RULES.max_hint_level,
      shuffle_exercises:
        value?.shuffle_exercises ??
        DEFAULT_EXERCISE_PRESENTATION_RULES.shuffle_exercises,
      speak_theory_before_first_exercise: speakTheoryBeforeFirstExercise,
      spoken_corrections_after_each_attempt:
        spokenCorrectionsAfterEachAttempt,
      allow_self_correction_window_seconds:
        value?.allow_self_correction_window_seconds ??
        DEFAULT_EXERCISE_PRESENTATION_RULES.allow_self_correction_window_seconds,
      show_theory_before_first_exercise: speakTheoryBeforeFirstExercise,
      show_corrections_after_each_attempt: spokenCorrectionsAfterEachAttempt,
    };
  });

const exercisesSpecSchema = z
  .object({
    num_times_repeat_on_fail: z.number().int().min(0).optional(),
    num_exercises_required_for_pass: z.number().min(0).max(100).optional(),
    presentation_rules: exercisePresentationRulesSchema.optional(),
  })
  .strict()
  .optional()
  .transform((value) => ({
    num_times_repeat_on_fail:
      value?.num_times_repeat_on_fail ??
      DEFAULT_EXERCISES_SPEC.num_times_repeat_on_fail,
    num_exercises_required_for_pass:
      value?.num_exercises_required_for_pass ??
      DEFAULT_EXERCISES_SPEC.num_exercises_required_for_pass,
    presentation_rules:
      value?.presentation_rules ?? DEFAULT_EXERCISES_SPEC.presentation_rules,
  }));

const languageIssueSchema = z
  .object({
    title: nonEmptyString,
    area: z.string().optional(),
    impact: z.string().optional(),
    description: z.string().optional(),
    theory: z.string().optional(),
    theory_voice: theoryVoiceSchema.optional(),
    examples: z.array(languageIssueExampleSchema).optional(),
    categoryCode: z.string().optional(),
    subcategoryCode: z.string().optional(),
    subcategoryName: z.string().optional(),
    errorId: nonEmptyString,
    exercises_spec: exercisesSpecSchema,
    exercises: z.array(languageExerciseSchema).min(1),
  })
  .strict();

export const languageLessonConfigSchema = z
  .object({
    language_issues: z.array(languageIssueSchema).min(1),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seenErrorIds = new Map<string, number>();
    const seenExerciseIds = new Map<
      string,
      { issueIndex: number; exerciseIndex: number }
    >();

    config.language_issues.forEach((issue, issueIndex) => {
      const priorErrorIssueIndex = seenErrorIds.get(issue.errorId);
      if (priorErrorIssueIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate errorId '${issue.errorId}' first seen at language_issues[${priorErrorIssueIndex}]`,
          path: ["language_issues", issueIndex, "errorId"],
        });
      } else {
        seenErrorIds.set(issue.errorId, issueIndex);
      }

      issue.exercises.forEach((exercise, exerciseIndex) => {
        const priorExerciseLocation = seenExerciseIds.get(exercise.exercise_id);
        if (priorExerciseLocation) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate exercise_id '${exercise.exercise_id}' first seen at language_issues[${priorExerciseLocation.issueIndex}].exercises[${priorExerciseLocation.exerciseIndex}]`,
            path: [
              "language_issues",
              issueIndex,
              "exercises",
              exerciseIndex,
              "exercise_id",
            ],
          });
        } else {
          seenExerciseIds.set(exercise.exercise_id, {
            issueIndex,
            exerciseIndex,
          });
        }
      });
    });
  });

export type NormalizedLanguageLessonConfig = z.infer<
  typeof languageLessonConfigSchema
>;
export type NormalizedLanguageIssue = z.infer<typeof languageIssueSchema>;
export type NormalizedLanguageExercise = z.infer<typeof languageExerciseSchema>;

export interface ParseLanguageLessonConfigResult {
  success: boolean;
  data: NormalizedLanguageLessonConfig | null;
  errors: string[];
}

function formatZodIssues(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

export function parseAndNormalizeLanguageLessonConfig(
  raw: string,
): ParseLanguageLessonConfigResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return {
      success: false,
      data: null,
      errors: ["root: Language lesson config is empty"],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      success: false,
      data: null,
      errors: [
        `root: Invalid JSON - ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  const normalizedResult = languageLessonConfigSchema.safeParse(parsed);
  if (!normalizedResult.success) {
    return {
      success: false,
      data: null,
      errors: formatZodIssues(normalizedResult.error.issues),
    };
  }

  return {
    success: true,
    data: normalizedResult.data,
    errors: [],
  };
}

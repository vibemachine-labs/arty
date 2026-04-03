import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import {
  parseAndNormalizeLanguageLessonConfig,
  type NormalizedLanguageLessonConfig,
} from "../modules/vm-webrtc/src/toolkit_functions/language_lesson_schema";
import { log } from "./logger";

const LANGUAGE_LESSON_EXERCISES_JSON_KEY =
  "@vibemachine/language_lesson/exercises_json";

export interface LanguageLessonConfigSummary {
  issueCount: number;
  exerciseCount: number;
}

export interface LoadParsedLanguageLessonConfigResult {
  raw: string;
  hash: string | null;
  parsedConfig: NormalizedLanguageLessonConfig | null;
  summary: LanguageLessonConfigSummary;
  validationErrors: string[];
  hashError: string | null;
}

export type ValidateLanguageLessonExercisesJsonResult =
  | {
      success: true;
      normalizedJson: string;
      parsedConfig: NormalizedLanguageLessonConfig;
      validationErrors: [];
    }
  | {
      success: false;
      normalizedJson: null;
      parsedConfig: null;
      validationErrors: string[];
    };

export function validateAndNormalizeLanguageLessonExercisesJson(
  raw: string,
): ValidateLanguageLessonExercisesJsonResult {
  const parseResult = parseAndNormalizeLanguageLessonConfig(raw);

  if (!parseResult.success || !parseResult.data) {
    return {
      success: false,
      normalizedJson: null,
      parsedConfig: null,
      validationErrors: parseResult.errors,
    };
  }

  return {
    success: true,
    normalizedJson: JSON.stringify(parseResult.data, null, 2),
    parsedConfig: parseResult.data,
    validationErrors: [],
  };
}

function summarizeLanguageLessonConfig(
  config: NormalizedLanguageLessonConfig,
): LanguageLessonConfigSummary {
  const issueCount = config.language_issues.length;
  const exerciseCount = config.language_issues.reduce(
    (total, issue) => total + issue.exercises.length,
    0,
  );

  return {
    issueCount,
    exerciseCount,
  };
}

export async function loadLanguageLessonConfigRaw(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(
      LANGUAGE_LESSON_EXERCISES_JSON_KEY,
    );

    log.info(
      "[LanguageLessonConfig] Loaded raw language lesson JSON",
      {},
      {
        storageKey: LANGUAGE_LESSON_EXERCISES_JSON_KEY,
        stored,
        storedLength: stored?.length ?? 0,
      },
    );

    return stored ?? "";
  } catch (error) {
    log.error(
      "[LanguageLessonConfig] Failed to load raw language lesson JSON",
      {},
      {
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : new Error(String(error)),
    );
    return "";
  }
}

// Backward-compatible alias used by existing UI.
export async function loadLanguageLessonExercisesJson(): Promise<string> {
  return loadLanguageLessonConfigRaw();
}

export async function loadParsedLanguageLessonConfig(): Promise<LoadParsedLanguageLessonConfigResult> {
  const raw = await loadLanguageLessonConfigRaw();
  const validationResult = validateAndNormalizeLanguageLessonExercisesJson(raw);

  if (!validationResult.success || !validationResult.parsedConfig) {
    log.warn(
      "[LanguageLessonConfig] Parsed language lesson config is invalid",
      {},
      {
        raw,
        validationErrors: validationResult.validationErrors,
      },
    );

    return {
      raw,
      hash: null,
      parsedConfig: null,
      summary: {
        issueCount: 0,
        exerciseCount: 0,
      },
      validationErrors: validationResult.validationErrors,
      hashError: null,
    };
  }

  const summary = summarizeLanguageLessonConfig(validationResult.parsedConfig);
  const canonicalNormalizedJson = JSON.stringify(validationResult.parsedConfig);

  try {
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      canonicalNormalizedJson,
    );

    log.info(
      "[LanguageLessonConfig] Parsed language lesson config loaded",
      {},
      {
        raw,
        hash,
        parsedConfig: validationResult.parsedConfig,
        summary,
      },
    );

    return {
      raw,
      hash,
      parsedConfig: validationResult.parsedConfig,
      summary,
      validationErrors: [],
      hashError: null,
    };
  } catch (error) {
    const hashErrorMessage = `Failed to hash normalized language lesson config - ${error instanceof Error ? error.message : String(error)}`;

    log.error(
      "[LanguageLessonConfig] Failed to hash normalized language lesson config",
      {},
      {
        raw,
        parsedConfig: validationResult.parsedConfig,
        summary,
        canonicalNormalizedJson,
        hashErrorMessage,
      },
      error instanceof Error ? error : new Error(String(error)),
    );

    return {
      raw,
      hash: null,
      parsedConfig: validationResult.parsedConfig,
      summary,
      validationErrors: [],
      hashError: hashErrorMessage,
    };
  }
}

export async function saveLanguageLessonExercisesJson(
  value: string,
): Promise<void> {
  const validationResult =
    validateAndNormalizeLanguageLessonExercisesJson(value);

  if (!validationResult.success || !validationResult.normalizedJson) {
    log.warn(
      "[LanguageLessonConfig] Rejected invalid exercises JSON save",
      {},
      {
        value,
        validationErrors: validationResult.validationErrors,
      },
    );

    throw new Error(
      `Invalid language lesson config: ${validationResult.validationErrors.join(" | ")}`,
    );
  }

  await AsyncStorage.setItem(
    LANGUAGE_LESSON_EXERCISES_JSON_KEY,
    validationResult.normalizedJson,
  );

  log.info(
    "[LanguageLessonConfig] Saved exercises JSON",
    {},
    {
      value,
      normalizedValue: validationResult.normalizedJson,
      valueLength: value.length,
      normalizedValueLength: validationResult.normalizedJson.length,
    },
  );
}

export async function saveLanguageLessonConfigRaw(
  value: string,
): Promise<void> {
  await saveLanguageLessonExercisesJson(value);
}

export async function saveParsedLanguageLessonConfig(
  config: NormalizedLanguageLessonConfig,
): Promise<void> {
  const raw = JSON.stringify(config, null, 2);
  await saveLanguageLessonExercisesJson(raw);
}

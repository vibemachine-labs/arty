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
  const parseResult = parseAndNormalizeLanguageLessonConfig(raw);

  if (!parseResult.success || !parseResult.data) {
    log.warn(
      "[LanguageLessonConfig] Parsed language lesson config is invalid",
      {},
      {
        raw,
        parseResult,
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
      validationErrors: parseResult.errors,
    };
  }

  const summary = summarizeLanguageLessonConfig(parseResult.data);
  const canonicalNormalizedJson = JSON.stringify(parseResult.data);

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
        parsedConfig: parseResult.data,
        summary,
      },
    );

    return {
      raw,
      hash,
      parsedConfig: parseResult.data,
      summary,
      validationErrors: [],
    };
  } catch (error) {
    const hashErrorMessage = `Failed to hash normalized language lesson config - ${error instanceof Error ? error.message : String(error)}`;

    log.error(
      "[LanguageLessonConfig] Failed to hash normalized language lesson config",
      {},
      {
        raw,
        parsedConfig: parseResult.data,
        summary,
        canonicalNormalizedJson,
        hashErrorMessage,
      },
      error instanceof Error ? error : new Error(String(error)),
    );

    return {
      raw,
      hash: null,
      parsedConfig: parseResult.data,
      summary,
      validationErrors: [hashErrorMessage],
    };
  }
}

export async function saveLanguageLessonExercisesJson(
  value: string,
): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_LESSON_EXERCISES_JSON_KEY, value);

  log.info(
    "[LanguageLessonConfig] Saved exercises JSON",
    {},
    {
      value,
      valueLength: value.length,
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

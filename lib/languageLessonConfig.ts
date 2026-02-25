import AsyncStorage from "@react-native-async-storage/async-storage";
import { log } from "./logger";

const LANGUAGE_LESSON_EXERCISES_JSON_KEY =
  "@vibemachine/language_lesson/exercises_json";

export async function loadLanguageLessonExercisesJson(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(
      LANGUAGE_LESSON_EXERCISES_JSON_KEY,
    );
    return stored ?? "";
  } catch (error) {
    log.error(
      "[LanguageLessonConfig] Failed to load exercises JSON",
      {},
      {
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : new Error(String(error)),
    );
    return "";
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

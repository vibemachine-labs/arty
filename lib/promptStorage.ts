import AsyncStorage from "@react-native-async-storage/async-storage";

import { log } from "./logger";

export const composePrompt = (basePrompt: string, addition: string): string => {
  const trimmedAddition = addition.trim();
  if (trimmedAddition.length === 0) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${trimmedAddition}`;
};

export const loadPromptAddition = async (storageKey: string): Promise<string> => {
  try {
    const stored = await AsyncStorage.getItem(storageKey);
    const addition = stored?.trim() ?? "";
    log.trace("Loaded prompt addition", {}, {
      storageKey,
      hasAddition: addition.length > 0,
      length: addition.length,
      additionPreview: addition.slice(0, 500),
    });
    return addition;
  } catch (error) {
    log.error("Failed to load prompt addition", {}, { storageKey, error });
    return "";
  }
};

export const savePromptAddition = async (
  storageKey: string,
  addition: string
): Promise<void> => {
  const trimmed = addition.trim();

  try {
    if (trimmed.length === 0) {
      await AsyncStorage.removeItem(storageKey);
      log.info("Cleared prompt addition; using base prompt", {}, { storageKey });
    } else {
      await AsyncStorage.setItem(storageKey, trimmed);
      log.info("Saved prompt addition", {}, { storageKey, length: trimmed.length });
    }
  } catch (error) {
    log.error("Failed to persist prompt addition", {}, { storageKey, error });
    throw error;
  }
};

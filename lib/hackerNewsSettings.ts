import AsyncStorage from "@react-native-async-storage/async-storage";

import { log } from "./logger";

const HACKER_NEWS_SUITE_STORAGE_KEY = "connectors.hackerNewsSuite.enabled";
const DEFAULT_ENABLED = true;

export const loadHackerNewsSuiteEnabled = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(HACKER_NEWS_SUITE_STORAGE_KEY);
    if (stored === null) {
      return DEFAULT_ENABLED;
    }
    return stored === "true";
  } catch (error) {
    log.warn("Failed to load Hacker News suite preference", {}, error);
    return DEFAULT_ENABLED;
  }
};

export const saveHackerNewsSuiteEnabled = async (value: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(HACKER_NEWS_SUITE_STORAGE_KEY, value ? "true" : "false");
  } catch (error) {
    log.warn("Failed to persist Hacker News suite preference", {}, error);
  }
};

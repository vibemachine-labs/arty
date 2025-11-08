import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@arty/connectors/hackerNewsEnabled";
const DEFAULT_VALUE = false;
const PREFIX = "[HackerNewsPreference]";

const warn = (message: string, error?: unknown) => {
  if (__DEV__) {
    console.warn(`${PREFIX} ${message}`, error);
  } else {
    console.warn(`${PREFIX} ${message}`);
  }
};

export const loadHackerNewsEnabled = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return DEFAULT_VALUE;
    }
    return stored === "true";
  } catch (error) {
    warn("Failed to load preference", error);
    return DEFAULT_VALUE;
  }
};

export const saveHackerNewsEnabled = async (enabled: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch (error) {
    warn("Failed to persist preference", error);
    throw error;
  }
};

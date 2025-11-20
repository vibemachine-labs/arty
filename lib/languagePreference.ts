import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@vibemachine/languagePreference";
export const DEFAULT_LANGUAGE = "English";

export const loadLanguagePreference = async (): Promise<string> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored || stored.trim().length === 0) {
      return DEFAULT_LANGUAGE;
    }
    return stored;
  } catch {
    return DEFAULT_LANGUAGE;
  }
};

export const saveLanguagePreference = async (language: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Ignore persistence errors for now; UI will fall back to default.
  }
};

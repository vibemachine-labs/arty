import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@vibemachine/transcriptionPreference";
export const DEFAULT_TRANSCRIPTION_ENABLED = true;

export const loadTranscriptionPreference = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return DEFAULT_TRANSCRIPTION_ENABLED;
    }
    return stored === "true";
  } catch {
    return DEFAULT_TRANSCRIPTION_ENABLED;
  }
};

export const saveTranscriptionPreference = async (
  enabled: boolean,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore persistence errors for now; UI will fall back to default.
  }
};

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@vibemachine/voicePreference";
export const DEFAULT_VOICE = "cedar";

export const loadVoicePreference = async (): Promise<string> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored || stored.trim().length === 0) {
      return DEFAULT_VOICE;
    }
    return stored;
  } catch {
    return DEFAULT_VOICE;
  }
};

export const saveVoicePreference = async (voice: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, voice);
  } catch {
    // Ignore persistence errors for now; UI will fall back to default.
  }
};

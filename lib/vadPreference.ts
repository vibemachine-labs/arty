import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@vibemachine/vadPreference";
export type VadMode = "server" | "semantic";
export const DEFAULT_VAD_MODE: VadMode = "server";

export const loadVadPreference = async (): Promise<VadMode> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_VAD_MODE;
    }
    if (stored === "server" || stored === "semantic") {
      return stored;
    }
    return DEFAULT_VAD_MODE;
  } catch {
    return DEFAULT_VAD_MODE;
  }
};

export const saveVadPreference = async (mode: VadMode): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore persistence errors for now; UI will fall back to default.
  }
};

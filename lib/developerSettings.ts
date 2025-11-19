import AsyncStorage from "@react-native-async-storage/async-storage";

const SHOW_REALTIME_ERROR_ALERTS_KEY = "developer.showRealtimeErrorAlerts";
const DISABLE_LOG_REDACTION_KEY = "developer.disableLogRedaction";
const RECORDING_MODE_KEY = "developer.recordingMode";
const DEV_SETTINGS_PREFIX = "[DeveloperSettings]";

const warn = (message: string, error: unknown) => {
  if (__DEV__) {
    console.warn(`${DEV_SETTINGS_PREFIX} ${message}`, error);
  } else {
    console.warn(`${DEV_SETTINGS_PREFIX} ${message}`);
  }
};

export const loadShowRealtimeErrorAlerts = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(SHOW_REALTIME_ERROR_ALERTS_KEY);
    if (stored === null) {
      return true;
    }
    return stored === "true";
  } catch (error) {
    warn("Failed to load realtime error alert preference", error);
    return true;
  }
};

export const saveShowRealtimeErrorAlerts = async (value: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(SHOW_REALTIME_ERROR_ALERTS_KEY, value ? "true" : "false");
  } catch (error) {
    warn("Failed to persist realtime error alert preference", error);
  }
};

export const loadLogRedactionDisabled = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(DISABLE_LOG_REDACTION_KEY);
    if (stored === null) {
      return false;
    }
    return stored === "true";
  } catch (error) {
    warn("Failed to load log redaction preference", error);
    return false;
  }
};

export const saveLogRedactionDisabled = async (value: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(DISABLE_LOG_REDACTION_KEY, value ? "true" : "false");
  } catch (error) {
    warn("Failed to persist log redaction preference", error);
  }
};

export const loadRecordingMode = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(RECORDING_MODE_KEY);
    if (stored === null) {
      return false;
    }
    return stored === "true";
  } catch (error) {
    warn("Failed to load recording mode preference", error);
    return false;
  }
};

export const saveRecordingMode = async (value: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(RECORDING_MODE_KEY, value ? "true" : "false");
  } catch (error) {
    warn("Failed to persist recording mode preference", error);
  }
};

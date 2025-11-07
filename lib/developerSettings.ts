import AsyncStorage from "@react-native-async-storage/async-storage";

import { log } from "./logger";

const SHOW_REALTIME_ERROR_ALERTS_KEY = "developer.showRealtimeErrorAlerts";
const DISABLE_LOG_REDACTION_KEY = "developer.disableLogRedaction";

export const loadShowRealtimeErrorAlerts = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(SHOW_REALTIME_ERROR_ALERTS_KEY);
    if (stored === null) {
      return true;
    }
    return stored === "true";
  } catch (error) {
    log.warn("Failed to load realtime error alert preference", {}, error);
    return true;
  }
};

export const saveShowRealtimeErrorAlerts = async (value: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(SHOW_REALTIME_ERROR_ALERTS_KEY, value ? "true" : "false");
  } catch (error) {
    log.warn("Failed to persist realtime error alert preference", {}, error);
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
    log.warn("Failed to load log redaction preference", {}, error);
    return false;
  }
};

export const saveLogRedactionDisabled = async (value: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(DISABLE_LOG_REDACTION_KEY, value ? "true" : "false");
  } catch (error) {
    log.warn("Failed to persist log redaction preference", {}, error);
  }
};

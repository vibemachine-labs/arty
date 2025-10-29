import AsyncStorage from "@react-native-async-storage/async-storage";

import { log } from "./logger";

const SHOW_REALTIME_ERROR_ALERTS_KEY = "developer.showRealtimeErrorAlerts";

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

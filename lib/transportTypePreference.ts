import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@vibemachine/transportTypePreference";
export type TransportType = "webrtc" | "websocket";
export const DEFAULT_TRANSPORT_TYPE: TransportType = "webrtc";

export const loadTransportTypePreference = async (): Promise<TransportType> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_TRANSPORT_TYPE;
    }
    if (stored === "webrtc" || stored === "websocket") {
      return stored;
    }
    return DEFAULT_TRANSPORT_TYPE;
  } catch {
    return DEFAULT_TRANSPORT_TYPE;
  }
};

export const saveTransportTypePreference = async (type: TransportType): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, type);
  } catch {
    // Ignore persistence errors for now; UI will fall back to default.
  }
};

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { log } from "../lib/logger";
import VmWebrtcModule, {
  type VoiceSessionStatusEventPayload,
} from "../modules/vm-webrtc";

export default function VoiceSessionStatus() {
  const [statusUpdate, setStatusUpdate] = useState<string>("Ready");

  useEffect(() => {
    if (!VmWebrtcModule?.addListener) {
      log.debug(
        "[VoiceSessionStatus] VmWebrtcModule.addListener not available",
      );
      return undefined;
    }

    log.debug(
      "[VoiceSessionStatus] Setting up listener for onVoiceSessionStatus",
    );

    const subscription = VmWebrtcModule.addListener(
      "onVoiceSessionStatus",
      (payload: VoiceSessionStatusEventPayload) => {
        log.debug("[VoiceSessionStatus] Received event:", {}, payload);
        setStatusUpdate(payload.status_update);
      },
    );

    return () => {
      log.debug("[VoiceSessionStatus] Removing listener");
      subscription.remove?.();
    };
  }, []);

  if (!statusUpdate) {
    log.debug("[VoiceSessionStatus] No status update, returning null");
    return null;
  }

  log.debug("[VoiceSessionStatus] Rendering status:", {}, { statusUpdate });

  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>{statusUpdate}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 70,
    left: 16,
    right: 16,
    alignItems: "center",
  },
  statusText: {
    fontSize: 14,
    color: "#8E8E93",
    textAlign: "center",
  },
});

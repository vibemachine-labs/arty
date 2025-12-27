import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import { BottomSheet } from "../ui/BottomSheet";

interface ConfigureTranscriptionProps {
  visible: boolean;
  transcriptionEnabled: boolean;
  onToggleTranscription: (enabled: boolean) => void;
  onClose: () => void;
}

export const ConfigureTranscription: React.FC<ConfigureTranscriptionProps> = ({
  visible,
  transcriptionEnabled,
  onToggleTranscription,
  onClose,
}) => {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Transcription">
      <View style={styles.body}>
        <Text style={styles.lead}>
          Enable audio transcription to convert your spoken input into text
          using Whisper. This helps with logging and debugging conversations.
        </Text>
        <View style={styles.optionCard}>
          <View style={styles.optionCopy}>
            <Text style={styles.optionTitle}>Transcribe Input Audio</Text>
            <Text style={styles.optionSubtitle}>
              Use Whisper-1 to transcribe your audio input in real-time.
            </Text>
          </View>
          <Switch
            value={transcriptionEnabled}
            onValueChange={onToggleTranscription}
            trackColor={{ false: "#D1D1D6", true: "#34C759" }}
            thumbColor="#FFFFFF"
            ios_backgroundColor="#D1D1D6"
          />
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: 16,
    paddingBottom: 16,
  },
  lead: {
    fontSize: 15,
    lineHeight: 20,
    color: "#3A3A3C",
  },
  optionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionCopy: {
    flex: 1,
    marginRight: 12,
    gap: 4,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  optionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: "#636366",
  },
});

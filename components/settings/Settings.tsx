import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { AudioOutputOption } from "./AudioOutputOption";

export type AudioOutput = "handset" | "speakerphone";

export interface SettingsProps {
  audioOutput: AudioOutput;
  onAudioOutputChange: (value: AudioOutput) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  audioOutput,
  onAudioOutputChange,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Audio Output</Text>
      <AudioOutputOption
        label="Handset"
        value="handset"
        selected={audioOutput === "handset"}
        onSelect={(value) => onAudioOutputChange(value as AudioOutput)}
        description="Route audio through the phone earpiece for private listening."
      />
      <AudioOutputOption
        label="Speakerphone"
        value="speakerphone"
        selected={audioOutput === "speakerphone"}
        onSelect={(value) => onAudioOutputChange(value as AudioOutput)}
        description="Use the loud speaker when you need the room to hear."
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 12,
  },
  sectionLabel: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1C1C1E",
    marginBottom: 16,
  },
});

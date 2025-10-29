import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Slider from "@react-native-community/slider";

import { BottomSheet } from "../ui/BottomSheet";

interface ConfigureContextWindowProps {
  visible: boolean;
  retentionRatio: number;
  maxConversationTurns: number | undefined;
  onRetentionRatioChange: (value: number) => void;
  onMaxConversationTurnsChange: (value: number | undefined) => void;
  onClose: () => void;
}

export const ConfigureContextWindow: React.FC<ConfigureContextWindowProps> = ({
  visible,
  retentionRatio,
  maxConversationTurns,
  onRetentionRatioChange,
  onMaxConversationTurnsChange,
  onClose,
}) => {
  const handleTurnsTextChange = (text: string) => {
    if (text === "") {
      onMaxConversationTurnsChange(undefined);
    } else {
      const num = parseInt(text, 10);
      if (!isNaN(num) && num > 0) {
        onMaxConversationTurnsChange(num);
      }
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Configure Context Window">
      <View style={styles.body}>
        <Text style={styles.lead}>
          Control how audio and conversation history are retained to optimize cost and performance.
        </Text>

        {/* Retention Ratio */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Retention Ratio</Text>
            <Text style={styles.sectionValue}>{Math.round(retentionRatio * 100)}%</Text>
          </View>
          <Text style={styles.settingSubtitle}>
            When context limit is hit, keep {Math.round(retentionRatio * 100)}% of most recent content
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={0.5}
            maximumValue={1.0}
            step={0.05}
            value={retentionRatio}
            onValueChange={onRetentionRatioChange}
            minimumTrackTintColor="#0A84FF"
            maximumTrackTintColor="#D1D1D6"
          />
        </View>

        {/* Max Conversation Turns */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Max Conversation Turns</Text>
          </View>
          <Text style={styles.settingSubtitle}>
            Limit total conversation turns (leave empty for unlimited)
          </Text>
          <TextInput
            style={styles.textInput}
            value={maxConversationTurns?.toString() ?? ""}
            onChangeText={handleTurnsTextChange}
            placeholder="Unlimited"
            placeholderTextColor="#8E8E93"
            keyboardType="number-pad"
            accessibilityLabel="Maximum conversation turns"
          />
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: 20,
    paddingBottom: 16,
  },
  lead: {
    fontSize: 15,
    lineHeight: 20,
    color: "#3A3A3C",
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  sectionValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0A84FF",
  },
  settingSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: "#636366",
  },
  slider: {
    width: "100%",
    height: 40,
  },
  textInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#1C1C1E",
  },
});

import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import Slider from "@react-native-community/slider";

import { BottomSheet } from "../ui/BottomSheet";

interface ConfigureContextWindowProps {
  visible: boolean;
  retentionRatio: number;
  maxConversationTurns: number;
  disableCompaction: boolean;
  onRetentionRatioChange: (value: number) => void;
  onMaxConversationTurnsChange: (value: number) => void;
  onDisableCompactionChange: (value: boolean) => void;
  onClose: () => void;
}

export const ConfigureContextWindow: React.FC<ConfigureContextWindowProps> = ({
  visible,
  retentionRatio,
  maxConversationTurns,
  disableCompaction,
  onRetentionRatioChange,
  onMaxConversationTurnsChange,
  onDisableCompactionChange,
  onClose,
}) => {
  const handleTurnsSliderChange = (value: number) => {
    onMaxConversationTurnsChange(Math.round(value));
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Configure Context Window"
    >
      <View style={styles.body}>
        <Text style={styles.lead}>
          Control how audio and conversation history are retained to optimize
          cost and performance.
        </Text>

        {/* Retention Ratio */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Retention Ratio</Text>
            <Text style={styles.sectionValue}>
              {Math.round(retentionRatio * 100)}%
            </Text>
          </View>
          <Text style={styles.settingSubtitle}>
            When context limit is hit, keep {Math.round(retentionRatio * 100)}%
            of most recent content
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
            <Text style={styles.sectionValue}>{maxConversationTurns}</Text>
          </View>
          <Text style={styles.settingSubtitle}>
            Limit conversation history to most recent {maxConversationTurns}{" "}
            turn{maxConversationTurns === 1 ? "" : "s"}
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={20}
            step={1}
            value={maxConversationTurns}
            onValueChange={handleTurnsSliderChange}
            minimumTrackTintColor="#0A84FF"
            maximumTrackTintColor="#D1D1D6"
            disabled={disableCompaction}
          />
        </View>

        {/* Disable Compaction */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Disable Compaction</Text>
            <Switch
              value={disableCompaction}
              onValueChange={onDisableCompactionChange}
              trackColor={{ false: "#D1D1D6", true: "#0A84FF" }}
              thumbColor="#FFFFFF"
            />
          </View>
          <Text style={styles.settingSubtitle}>
            When enabled, conversation history will not be compacted regardless
            of the max turns setting
          </Text>
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
});

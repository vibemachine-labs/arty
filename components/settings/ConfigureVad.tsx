import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "../ui/BottomSheet";

import { type VadMode } from "../../lib/vadPreference";

type VadOption = {
  value: VadMode;
  title: string;
  subtitle: string;
};

const OPTIONS: VadOption[] = [
  {
    value: "server",
    title: "Server VAD",
    subtitle: "Let the server decide when to start and stop capturing audio.",
  },
  {
    value: "semantic",
    title: "Semantic VAD",
    subtitle: "Use semantic cues on-device for more conversational pacing.",
  },
];

interface ConfigureVadProps {
  visible: boolean;
  selectedMode: VadMode;
  onSelectMode: (mode: VadMode) => void;
  onClose: () => void;
}

export const ConfigureVad: React.FC<ConfigureVadProps> = ({
  visible,
  selectedMode,
  onSelectMode,
  onClose,
}) => {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Voice Activity Detection"
    >
      <View style={styles.body}>
        <Text style={styles.lead}>
          Choose how Vibemachine detects when you're speaking. Adjust this
          anytime for the right feel during iOS sessions.
        </Text>
        <View style={styles.optionList}>
          {OPTIONS.map((option) => {
            const isSelected = option.value === selectedMode;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelectMode(option.value)}
                style={({ pressed }) => [
                  styles.optionCard,
                  isSelected && styles.optionCardSelected,
                  pressed && styles.optionCardPressed,
                ]}
              >
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
                </View>
                <Text
                  style={[
                    styles.optionCheckmark,
                    isSelected ? styles.optionCheckmarkActive : null,
                  ]}
                >
                  {isSelected ? "●" : "○"}
                </Text>
              </Pressable>
            );
          })}
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
  optionList: {
    gap: 12,
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
  optionCardSelected: {
    borderColor: "#0A84FF",
    backgroundColor: "#F0F6FF",
  },
  optionCardPressed: {
    backgroundColor: "#E5F1FF",
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
  optionCheckmark: {
    fontSize: 20,
    color: "#AEAEB2",
  },
  optionCheckmarkActive: {
    color: "#0A84FF",
  },
});

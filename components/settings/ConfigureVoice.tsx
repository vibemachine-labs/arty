import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "../ui/BottomSheet";

export type VoiceOption = {
  value: string;
  label: string;
  description: string;
};

export const VOICES: VoiceOption[] = [
  { value: "alloy", label: "Alloy", description: "Balanced, clear (improved)" },
  { value: "ash", label: "Ash", description: "Warm, friendly (improved)" },
  { value: "ballad", label: "Ballad", description: "Smooth, melodic (improved)" },
  { value: "coral", label: "Coral", description: "Vibrant, energetic (improved)" },
  { value: "echo", label: "Echo", description: "Calm, professional (improved)" },
  { value: "sage", label: "Sage", description: "Thoughtful, steady (improved)" },
  { value: "shimmer", label: "Shimmer", description: "Bright, cheerful (improved)" },
  { value: "verse", label: "Verse", description: "Expressive, dynamic (improved)" },
  { value: "cedar", label: "Cedar", description: "Natural, grounded (Realtime only)" },
  { value: "marin", label: "Marin", description: "Expressive, conversational (Realtime only)" },
];

export interface ConfigureVoiceProps {
  visible: boolean;
  selectedVoice: string;
  onSelectVoice: (value: string) => void;
  onClose: () => void;
  voices?: VoiceOption[];
}

export const ConfigureVoice: React.FC<ConfigureVoiceProps> = ({
  visible,
  selectedVoice,
  onSelectVoice,
  onClose,
  voices = VOICES,
}) => {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Configure Voice">
      <ScrollView
        contentContainerStyle={styles.body}
        style={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>Choose the voice that fits your session vibe.</Text>
        <View style={styles.voiceList}>
          {voices.map((voice) => {
            const isSelected = voice.value === selectedVoice;

            return (
              <Pressable
                key={voice.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelectVoice(voice.value)}
                style={({ pressed }) => [
                  styles.voiceCard,
                  isSelected && styles.voiceCardSelected,
                  pressed && styles.voiceCardPressed,
                ]}
              >
                <View style={styles.voiceContent}>
                  <Text style={styles.voiceLabel}>{voice.label}</Text>
                  <Text style={styles.voiceDescription}>{voice.description}</Text>
                </View>
                <Text style={[styles.voiceCheckmark, isSelected ? styles.voiceCheckmarkActive : null]}>
                  {isSelected ? "●" : "○"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.helperText}>
          You can adjust the voice anytime. Voice previews will arrive in an upcoming update.
        </Text>
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    maxHeight: 480,
  },
  body: {
    gap: 16,
    paddingBottom: 12,
  },
  lead: {
    fontSize: 16,
    color: "#3A3A3C",
  },
  voiceList: {
    gap: 12,
  },
  voiceCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  voiceCardSelected: {
    borderColor: "#0A84FF",
    backgroundColor: "#F0F6FF",
  },
  voiceCardPressed: {
    backgroundColor: "#E5F1FF",
  },
  voiceContent: {
    flex: 1,
    marginRight: 12,
  },
  voiceLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  voiceDescription: {
    marginTop: 4,
    fontSize: 13,
    color: "#636366",
  },
  voiceCheckmark: {
    fontSize: 20,
    color: "#AEAEB2",
  },
  voiceCheckmarkActive: {
    color: "#0A84FF",
  },
  helperText: {
    fontSize: 12,
    color: "#8E8E93",
  },
});

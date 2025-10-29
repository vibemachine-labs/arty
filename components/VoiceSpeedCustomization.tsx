import Slider from "@react-native-community/slider";
import { Platform, StyleSheet, Text, UIManager, View } from "react-native";
import { useMemo } from "react";

type VoiceSpeedCustomizationProps = {
  voiceSpeed: number;
  onVoiceSpeedChange: (value: number) => void;
  onVoiceSpeedCommit: (value: number) => void;
};

export function VoiceSpeedCustomization({
  voiceSpeed,
  onVoiceSpeedChange,
  onVoiceSpeedCommit,
}: VoiceSpeedCustomizationProps) {
  const isVoiceSpeedSliderAvailable = useMemo(() => {
    if (Platform.OS !== "ios") {
      return false;
    }

    const hasConfig =
      typeof UIManager.getViewManagerConfig === "function"
        ? UIManager.getViewManagerConfig("RNCSlider")
        : undefined;
    const hasLegacyConfig =
      typeof (UIManager as unknown as { hasViewManagerConfig?: (name: string) => boolean }).hasViewManagerConfig ===
      "function"
        ? (UIManager as unknown as { hasViewManagerConfig: (name: string) => boolean }).hasViewManagerConfig("RNCSlider")
        : false;

    return Boolean(hasConfig || hasLegacyConfig);
  }, []);

  return (
    <View style={styles.advancedColumn}>
      <View style={styles.advancedRowHeader}>
        <Text style={styles.advancedRowLabel}>Voice Speed</Text>
        <Text style={styles.advancedValueText}>{voiceSpeed.toFixed(2)}x</Text>
      </View>
      <Text style={styles.advancedRowDescription}>
        Fine-tune the assistant tempo. 1.0x keeps speech natural while higher values add focus.
      </Text>
      {isVoiceSpeedSliderAvailable ? (
        <Slider
          accessibilityLabel="Adjust assistant voice speed"
          accessibilityHint="Slide left to slow playback or right to speed it up"
          style={styles.advancedSlider}
          minimumValue={0.6}
          maximumValue={1.4}
          step={0.01}
          minimumTrackTintColor="#0A84FF"
          maximumTrackTintColor="#D1D1D6"
          thumbTintColor="#0A84FF"
          value={voiceSpeed}
          onValueChange={onVoiceSpeedChange}
          onSlidingComplete={onVoiceSpeedCommit}
        />
      ) : (
        <View style={styles.advancedSliderUnavailable}>
          <Text style={styles.advancedUnavailableTitle}>Slider unavailable</Text>
          <Text style={styles.advancedUnavailableBody}>
            Install @react-native-community/slider and rebuild the iOS client to fine-tune speed here.
          </Text>
        </View>
      )}
      <View style={styles.advancedSliderTicks}>
        <Text style={styles.advancedTickLabel}>0.6x</Text>
        <Text style={styles.advancedTickLabel}>1.0x</Text>
        <Text style={styles.advancedTickLabel}>1.4x</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  advancedColumn: {
    width: "100%",
    gap: 12,
  },
  advancedRowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  advancedRowLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1C1C1E",
  },
  advancedValueText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0A84FF",
  },
  advancedRowDescription: {
    marginTop: 4,
    fontSize: 13,
    color: "#6E6E73",
  },
  advancedSlider: {
    width: "100%",
  },
  advancedSliderUnavailable: {
    width: "100%",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    backgroundColor: "#F8F8F8",
    gap: 4,
  },
  advancedUnavailableTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  advancedUnavailableBody: {
    fontSize: 12,
    color: "#6E6E73",
  },
  advancedSliderTicks: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  advancedTickLabel: {
    fontSize: 12,
    color: "#8E8E93",
  },
});

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "../ui/BottomSheet";

import { type TransportType } from "../../lib/transportTypePreference";

type TransportOption = {
  value: TransportType;
  title: string;
  subtitle: string;
};

const OPTIONS: TransportOption[] = [
  {
    value: "webrtc",
    title: "WebRTC",
    subtitle: "Use WebRTC for real-time voice sessions (default).",
  },
  {
    value: "websocket",
    title: "WebSocket",
    subtitle: "Use WebSocket for voice sessions (experimental).",
  },
];

interface ConfigureTransportTypeProps {
  visible: boolean;
  selectedType: TransportType;
  onSelectType: (type: TransportType) => void;
  onClose: () => void;
}

export const ConfigureTransportType: React.FC<ConfigureTransportTypeProps> = ({
  visible,
  selectedType,
  onSelectType,
  onClose,
}) => {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Transport Type">
      <View style={styles.body}>
        <Text style={styles.lead}>
          Choose the transport protocol for voice sessions. WebRTC is the default option.
        </Text>
        <View style={styles.optionList}>
          {OPTIONS.map((option) => {
            const isSelected = option.value === selectedType;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelectType(option.value)}
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
                <Text style={[styles.optionCheckmark, isSelected ? styles.optionCheckmarkActive : null]}>
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

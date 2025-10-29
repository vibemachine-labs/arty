import { memo } from "react";
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

export type ChatMode = "voice" | "text";

type ConfigureChatModeProps = {
  visible: boolean;
  selectedMode: ChatMode;
  onSelectMode: (mode: ChatMode) => void;
  onClose: () => void;
};

const CHAT_MODES: { id: ChatMode; label: string; description: string }[] = [
  { id: "voice", label: "Voice", description: "Talk naturally with realtime responses." },
  { id: "text", label: "Text", description: "Type and read chat messages." },
];

export const ConfigureChatMode = memo(({ visible, selectedMode, onSelectMode, onClose }: ConfigureChatModeProps) => {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Configure Chat Mode</Text>
        <Text style={styles.subtitle}>Choose how you want to interact with Vibemachine.</Text>
        <View style={styles.optionsContainer}>
          {CHAT_MODES.map((mode) => {
            const isSelected = selectedMode === mode.id;
            return (
              <Pressable
                key={mode.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelectMode(mode.id)}
                style={[styles.option, isSelected && styles.optionSelected]}
              >
                <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                  {isSelected && <View style={styles.radioInner} />}
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionLabel}>{mode.label}</Text>
                  <Text style={styles.optionDescription}>{mode.description}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(28,28,30,0.32)",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1C1C1E",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: "#6E6E73",
    marginBottom: 20,
  },
  optionsContainer: {
    gap: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F2F2F7",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionSelected: {
    backgroundColor: "#E6F0FF",
    borderColor: "#0A84FF",
    borderWidth: 2,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#C7C7CC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  radioOuterSelected: {
    borderColor: "#0A84FF",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#0A84FF",
  },
  optionCopy: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  optionDescription: {
    fontSize: 13,
    color: "#6E6E73",
    marginTop: 4,
  },
});

import React, { useCallback, useMemo } from "react";
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface CustomPromptModalProps {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export const CustomPromptModal: React.FC<CustomPromptModalProps> = ({
  visible,
  value,
  onChange,
  onClose,
  onSave,
}) => {
  const insets = useSafeAreaInsets();
  const maxInputHeight = useMemo(
    () => Math.max(160, Math.round(Dimensions.get("window").height * 0.35)),
    []
  );
  const handleReset = useCallback(() => {
    onChange("");
  }, [onChange]);

  return (
    <Modal
      animationType="slide"
      presentationStyle="formSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoider}
        keyboardVerticalOffset={insets.top + 12}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.body}>
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss custom prompt"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.headerAction,
                  pressed && styles.headerActionPressed,
                ]}
              >
                <Text style={styles.headerActionText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset custom prompt"
                onPress={handleReset}
                style={({ pressed }) => [
                  styles.headerAction,
                  pressed && styles.headerActionPressed,
                ]}
              >
                <Text style={styles.headerActionText}>Reset</Text>
              </Pressable>
            </View>
            <View style={styles.content}>
              <Text style={styles.title}>Custom Prompt</Text>
              <Text style={styles.subtitle}>
                Draft the custom prompt to guide VibeMachine. You can update this anytime.
              </Text>
              <TextInput
                multiline
                value={value}
                onChangeText={onChange}
                placeholder="Describe the vibe you want to set..."
                style={[styles.input, { maxHeight: maxInputHeight }]}
                textAlignVertical="top"
                accessibilityLabel="Custom prompt text area"
                scrollEnabled
              />
            </View>
            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save custom prompt"
                onPress={onSave}
                style={({ pressed }) => [styles.saveButton, pressed && styles.saveButtonPressed]}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F5F7",
  },
  body: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActionText: {
    color: "#0A84FF",
    fontSize: 16,
    fontWeight: "600",
  },
  headerAction: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  headerActionPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  content: {
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#636366",
    marginBottom: 16,
  },
  input: {
    minHeight: 160,
    flexGrow: 1,
    flexShrink: 1,
    borderWidth: 1,
    borderColor: "#C7C7CC",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    padding: 16,
    fontSize: 16,
    color: "#1C1C1E",
    marginBottom: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 16,
  },
  saveButton: {
    backgroundColor: "#0A84FF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveButtonPressed: {
    backgroundColor: "#0060DF",
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
  },
});

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { log } from "../../lib/logger";

export interface ConfigurePromptModalProps {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSaveSuccess: () => void;
  loadPromptAddition: () => Promise<string>;
  savePromptAddition: (value: string) => Promise<void>;
  basePrompt?: string;
  title?: string;
}

export const ConfigurePromptModal: React.FC<ConfigurePromptModalProps> = ({
  visible,
  value,
  onChange,
  onClose,
  onSaveSuccess,
  loadPromptAddition,
  savePromptAddition,
  basePrompt,
  title = "Configure Prompt",
}) => {
  const insets = useSafeAreaInsets();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setIsExpanded(false);
    }
  }, [visible]);

  useEffect(() => {
    let isActive = true;

    if (!visible) {
      return () => {
        isActive = false;
      };
    }

    const loadStoredPrompt = async () => {
      try {
        setIsLoading(true);
        const stored = await loadPromptAddition();
        if (!isActive) {
          return;
        }

        onChange(stored);
      } catch (error) {
        if (isActive) {
          log.error("Failed to load prompt addition", {}, error);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    loadStoredPrompt();

    return () => {
      isActive = false;
    };
  }, [visible, loadPromptAddition, onChange]);

  const handleToggleCurrentPrompt = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExpanded((prev) => !prev);
  }, []);

  const handleChangeText = useCallback(
    (text: string) => {
      onChange(text);
    },
    [onChange],
  );

  const handleClearPress = useCallback(() => {
    if (isLoading || isSaving) {
      return;
    }

    onChange("");
  }, [isLoading, isSaving, onChange]);

  const handleCopyPress = useCallback(async () => {
    if (isLoading || isSaving || value.trim().length === 0) {
      return;
    }

    try {
      await Clipboard.setStringAsync(value);
      log.info("Copied prompt addition", {}, { length: value.trim().length });
    } catch (error) {
      log.error("Failed to copy prompt addition", {}, error);
      Alert.alert(
        "Copy Failed",
        "We couldn't copy your prompt. Please try again.",
      );
    }
  }, [isLoading, isSaving, value]);

  const handleSavePress = useCallback(async () => {
    if (isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      await savePromptAddition(value);
      log.info("Saved prompt addition", {}, { length: value.trim().length });
      onSaveSuccess();
    } catch (error) {
      log.error("Failed to save prompt addition", {}, error);
      Alert.alert(
        "Save Failed",
        "We couldn't update your prompt. Please try again in a moment.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, savePromptAddition, value, onSaveSuccess]);

  const isClearDisabled = isLoading || isSaving || value.trim().length === 0;
  const isCopyDisabled = isLoading || isSaving || value.trim().length === 0;

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoider}
        keyboardVerticalOffset={insets.top + 12}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.container}>
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel configuring prompt"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.headerAction,
                  pressed ? styles.headerActionPressed : null,
                ]}
              >
                <Text style={styles.headerActionText}>Cancel</Text>
              </Pressable>
              <Text style={styles.headerTitle}>{title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save prompt"
                onPress={handleSavePress}
                disabled={isSaving}
                style={({ pressed }) => [
                  styles.headerAction,
                  isSaving ? styles.headerActionDisabled : null,
                  pressed && !isSaving ? styles.headerActionPressed : null,
                ]}
              >
                <Text
                  style={[
                    styles.headerActionText,
                    styles.headerActionTextPrimary,
                    isSaving ? styles.headerActionTextDisabled : null,
                  ]}
                >
                  Save
                </Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <View>
                <Text style={styles.sectionLabel}>Add to the prompt</Text>
                <TextInput
                  value={value}
                  onChangeText={handleChangeText}
                  placeholder="Capture the context you want to add..."
                  multiline
                  scrollEnabled={false}
                  textAlignVertical="top"
                  style={[
                    styles.textArea,
                    isLoading || isSaving ? styles.textAreaDisabled : null,
                  ]}
                  accessibilityLabel="Additional prompt text"
                  editable={!isLoading && !isSaving}
                  autoCorrect={false}
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <View style={styles.promptActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy additional prompt text to clipboard"
                    onPress={handleCopyPress}
                    disabled={isCopyDisabled}
                    style={({ pressed }) => [
                      styles.actionButton,
                      styles.copyButton,
                      pressed && !isCopyDisabled
                        ? styles.copyButtonPressed
                        : null,
                      isCopyDisabled ? styles.actionButtonDisabled : null,
                    ]}
                  >
                    <Text style={styles.copyButtonIcon}>📋</Text>
                    <Text style={styles.copyButtonText}>Copy</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear additional prompt text"
                    onPress={handleClearPress}
                    disabled={isClearDisabled}
                    style={({ pressed }) => [
                      styles.actionButton,
                      styles.clearButton,
                      pressed && !isClearDisabled
                        ? styles.clearButtonPressed
                        : null,
                      isClearDisabled ? styles.actionButtonDisabled : null,
                    ]}
                  >
                    <Text style={styles.clearButtonIcon}>X</Text>
                    <Text style={styles.clearButtonText}>Clear</Text>
                  </Pressable>
                </View>
              </View>

              {basePrompt ? (
                <View style={styles.currentPromptSection}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isExpanded }}
                    onPress={handleToggleCurrentPrompt}
                    style={({ pressed }) => [
                      styles.currentPromptHeader,
                      pressed ? styles.currentPromptHeaderPressed : null,
                    ]}
                  >
                    <Text style={styles.currentPromptTitle}>
                      Current prompt
                    </Text>
                    <Text style={styles.currentPromptChevron}>
                      {isExpanded ? "⌃" : "⌄"}
                    </Text>
                  </Pressable>
                  {isExpanded ? (
                    <View style={styles.currentPromptBody}>
                      <Text style={styles.currentPromptText}>{basePrompt}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
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
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerAction: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    minWidth: 64,
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
    textAlign: "center",
  },
  headerActionPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  headerActionDisabled: {
    opacity: 0.6,
  },
  headerActionText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  headerActionTextPrimary: {
    color: "#0A84FF",
  },
  headerActionTextDisabled: {
    color: "#5E7FB4",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 24,
  },
  contentScroll: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 12,
  },
  textArea: {
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C7C7CC",
    backgroundColor: "#FFFFFF",
    padding: 16,
    fontSize: 16,
    color: "#1C1C1E",
  },
  textAreaDisabled: {
    opacity: 0.6,
  },
  promptActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 12,
    alignSelf: "flex-start",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  copyButton: {
    borderWidth: 1,
    borderColor: "#D1D1D6",
    backgroundColor: "#FFFFFF",
  },
  copyButtonPressed: {
    backgroundColor: "rgba(60, 60, 67, 0.08)",
  },
  copyButtonIcon: {
    marginRight: 6,
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  copyButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  clearButton: {
    backgroundColor: "rgba(255, 59, 48, 0.1)",
  },
  clearButtonPressed: {
    backgroundColor: "rgba(255, 59, 48, 0.16)",
  },
  clearButtonIcon: {
    marginRight: 6,
    fontSize: 15,
    fontWeight: "600",
    color: "#FF3B30",
  },
  clearButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FF3B30",
  },
  currentPromptSection: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    backgroundColor: "#FFFFFF",
  },
  currentPromptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  currentPromptHeaderPressed: {
    backgroundColor: "#F2F2F7",
  },
  currentPromptTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  currentPromptChevron: {
    fontSize: 18,
    color: "#8E8E93",
  },
  currentPromptBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  currentPromptText: {
    fontSize: 14,
    color: "#6E6E73",
  },
});

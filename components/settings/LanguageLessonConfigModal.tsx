import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  loadLanguageLessonExercisesJson,
  saveLanguageLessonExercisesJson,
  validateAndNormalizeLanguageLessonExercisesJson,
} from "../../lib/languageLessonConfig";
import { log } from "../../lib/logger";

export interface LanguageLessonConfigModalProps {
  visible: boolean;
  onClose: () => void;
}

export const LanguageLessonConfigModal: React.FC<
  LanguageLessonConfigModalProps
> = ({ visible, onClose }) => {
  const insets = useSafeAreaInsets();
  const [jsonText, setJsonText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let isMounted = true;

    const loadStoredConfig = async () => {
      try {
        setIsLoading(true);
        const stored = await loadLanguageLessonExercisesJson();
        if (!isMounted) {
          return;
        }
        setJsonText(stored);
      } catch (error) {
        log.error(
          "[LanguageLessonConfigModal] Failed loading stored JSON",
          {},
          {
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadStoredConfig();

    return () => {
      isMounted = false;
    };
  }, [visible]);

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return;
    }

    const validationResult =
      validateAndNormalizeLanguageLessonExercisesJson(jsonText);

    if (!validationResult.success || !validationResult.normalizedJson) {
      const validationMessage = validationResult.validationErrors
        .slice(0, 3)
        .join("\n");

      Alert.alert(
        "Invalid Lesson JSON",
        validationMessage.length > 0
          ? validationMessage
          : "Please fix the lesson JSON before saving.",
      );
      log.warn(
        "[LanguageLessonConfigModal] Invalid language lesson config submitted",
        {},
        {
          jsonText,
          validationErrors: validationResult.validationErrors,
        },
      );
      return;
    }

    try {
      setIsSaving(true);
      await saveLanguageLessonExercisesJson(validationResult.normalizedJson);
      Alert.alert("Saved", "Language lesson JSON has been saved.");
      onClose();
    } catch (error) {
      log.error(
        "[LanguageLessonConfigModal] Failed saving JSON",
        {},
        {
          jsonText,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error : new Error(String(error)),
      );
      Alert.alert("Save Failed", "Unable to save language lesson JSON.");
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, jsonText, onClose]);

  const handleClear = useCallback(() => {
    if (isLoading || isSaving) {
      return;
    }

    log.info(
      "[LanguageLessonConfigModal] Clearing JSON text",
      {},
      {
        previousJsonText: jsonText,
      },
    );
    setJsonText("");
  }, [isLoading, isSaving, jsonText]);

  const handleCopy = useCallback(async () => {
    if (isLoading || isSaving) {
      return;
    }

    try {
      await Clipboard.setStringAsync(jsonText);
      log.info(
        "[LanguageLessonConfigModal] Copied JSON text to clipboard",
        {},
        {
          jsonText,
        },
      );
      Alert.alert("Copied", "Language lesson JSON copied to clipboard.");
    } catch (error) {
      log.error(
        "[LanguageLessonConfigModal] Failed copying JSON to clipboard",
        {},
        {
          jsonText,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error : new Error(String(error)),
      );
      Alert.alert("Copy Failed", "Unable to copy language lesson JSON.");
    }
  }, [isLoading, isSaving, jsonText]);

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
        keyboardVerticalOffset={insets.top}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <Pressable
              onPress={onClose}
              disabled={isSaving}
              style={({ pressed }) => [
                styles.headerAction,
                pressed && styles.headerActionPressed,
              ]}
            >
              <Text
                style={[
                  styles.headerActionText,
                  isSaving && styles.disabledText,
                ]}
              >
                Cancel
              </Text>
            </Pressable>
            <Text style={styles.headerTitle}>Language Lesson JSON</Text>
            <Pressable
              onPress={handleSave}
              disabled={isSaving || isLoading}
              style={({ pressed }) => [
                styles.headerAction,
                pressed &&
                  !isSaving &&
                  !isLoading &&
                  styles.headerActionPressed,
              ]}
            >
              <Text
                style={[
                  styles.headerActionText,
                  styles.saveText,
                  (isSaving || isLoading) && styles.disabledText,
                ]}
              >
                {isSaving ? "Saving..." : "Save"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.content}>
            <Text style={styles.description}>
              Paste the full exercises JSON used by the language lesson tool.
            </Text>

            <View style={styles.actionRow}>
              <Pressable
                onPress={handleClear}
                disabled={isLoading || isSaving}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed &&
                    !isLoading &&
                    !isSaving &&
                    styles.actionButtonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.actionButtonText,
                    (isLoading || isSaving) && styles.disabledText,
                  ]}
                >
                  ❌ Clear
                </Text>
              </Pressable>

              <Pressable
                onPress={handleCopy}
                disabled={isLoading || isSaving || jsonText.length === 0}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed &&
                    !isLoading &&
                    !isSaving &&
                    jsonText.length > 0 &&
                    styles.actionButtonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.actionButtonText,
                    (isLoading || isSaving || jsonText.length === 0) &&
                      styles.disabledText,
                  ]}
                >
                  Copy
                </Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.textArea}
              value={jsonText}
              onChangeText={setJsonText}
              editable={!isLoading && !isSaving}
              placeholder="Paste language_issues JSON here..."
              placeholderTextColor="#8E8E93"
              multiline
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              textAlignVertical="top"
            />
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  headerAction: {
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    minWidth: 64,
    alignItems: "center",
  },
  headerActionPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.12)",
  },
  headerActionText: {
    fontSize: 16,
    color: "#0A84FF",
    fontWeight: "500",
  },
  saveText: {
    fontWeight: "700",
  },
  disabledText: {
    color: "#8E8E93",
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    gap: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 21,
    color: "#3A3A3C",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: "#D1D1D6",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  actionButtonPressed: {
    backgroundColor: "#F2F2F7",
  },
  actionButtonText: {
    fontSize: 14,
    color: "#0A84FF",
    fontWeight: "600",
  },
  textArea: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    padding: 14,
    fontSize: 14,
    lineHeight: 20,
    color: "#1C1C1E",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { log } from "../../lib/logger";
import {
  deleteGithubToken,
  getGithubToken,
  saveGithubToken,
} from "../../lib/secure-storage";

export interface GithubConnectorConfigProps {
  visible: boolean;
  onClose: () => void;
  onSave?: () => void;
}
export const GithubConnectorConfig: React.FC<GithubConnectorConfigProps> = ({
  visible,
  onClose,
  onSave,
}) => {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  // Load existing token when modal opens
  useEffect(() => {
    if (visible) {
      const loadToken = async () => {
        try {
          const [existingToken, enabledValue] = await Promise.all([
            getGithubToken(),
            AsyncStorage.getItem("github_connector_enabled"),
          ]);
          if (existingToken) {
            setToken(existingToken);
            setHasExistingToken(true);
          } else {
            setToken("");
            setHasExistingToken(false);
          }
          // Default to false if not set
          setIsEnabled(enabledValue === "true");
        } catch (error) {
          log.error("Failed to load GitHub token:", {}, error);
        }
      };
      loadToken();
    }
  }, [visible]);

  const handleCancel = useCallback(() => {
    setToken("");
    setHasExistingToken(false);
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!token.trim()) {
      Alert.alert("Invalid Token", "Please enter a valid GitHub personal access token.");
      return;
    }

    setIsLoading(true);
    try {
      await saveGithubToken(token.trim());
      log.info("✅ GitHub token saved successfully");
      
      Alert.alert(
        "Success",
        "Your GitHub token has been saved securely.",
        [
          {
            text: "OK",
            onPress: () => {
              setToken("");
              setHasExistingToken(false);
              onSave?.();
              onClose();
            },
          },
        ]
      );
    } catch (error) {
      log.error("❌ Failed to save GitHub token:", {}, error);
      Alert.alert(
        "Error",
        "Failed to save GitHub token. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }, [token, onSave, onClose]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Token",
      "Are you sure you want to delete your GitHub token? This cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsLoading(true);
            try {
              await deleteGithubToken();
              setToken("");
              setHasExistingToken(false);
              log.info("✅ GitHub token deleted successfully");

              Alert.alert("Success", "Your GitHub token has been deleted.");
            } catch (error) {
              log.error("❌ Failed to delete GitHub token:", {}, error);
              Alert.alert("Error", "Failed to delete GitHub token. Please try again.");
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  }, []);

  const handleToggleEnabled = useCallback(async (value: boolean) => {
    if (value) {
      // Show alert when trying to enable
      Alert.alert(
        "GitHub Connector Unavailable",
        "The GitHub connector is temporarily disabled and not currently working. We're working on bringing it back in a future update.",
        [{ text: "OK" }]
      );
      return;
    }
    setIsEnabled(value);
    try {
      await AsyncStorage.setItem("github_connector_enabled", value.toString());
    } catch {
      // ignore errors
    }
  }, []);

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoider}
        keyboardVerticalOffset={insets.top}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <SafeAreaView style={styles.safeArea}>
            {/* Header */}
            <View style={styles.header}>
              <Pressable
                onPress={handleCancel}
                disabled={isLoading}
                style={({ pressed }) => [
                  styles.headerAction,
                  pressed && styles.headerActionPressed,
                ]}
              >
                <Text style={[styles.headerActionText, isLoading && styles.disabledText]}>
                  Cancel
                </Text>
              </Pressable>
              <Text style={styles.headerTitle}>GitHub</Text>
              <Pressable
                onPress={handleSave}
                disabled={isLoading || !token.trim()}
                style={({ pressed }) => [
                  styles.headerAction,
                  pressed && !isLoading && token.trim() && styles.headerActionPressed,
                ]}
              >
                <Text
                  style={[
                    styles.headerActionText,
                    styles.saveText,
                    (isLoading || !token.trim()) && styles.disabledText,
                  ]}
                >
                  {isLoading ? "Saving..." : "Save"}
                </Text>
              </Pressable>
            </View>

            {/* Content */}
            <View style={styles.content}>
              <View style={styles.enableSection}>
                <Text style={styles.enableLabel}>Enable GitHub Connector</Text>
                <Switch
                  value={isEnabled}
                  onValueChange={handleToggleEnabled}
                  trackColor={{ false: "#E5E5EA", true: "#34C759" }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {isEnabled && (
                <>
                  <View style={styles.iconContainer}>
                    <Text style={styles.icon}>🐙</Text>
                  </View>

                  <Text style={styles.title}>GitHub Personal Access Token</Text>
                  <Text style={styles.description}>
                    Enter your GitHub personal access token to enable repository access and code analysis.
                  </Text>

              <View style={styles.inputSection}>
                <Text style={styles.label}>Access Token</Text>
                <TextInput
                  style={styles.input}
                  value={token}
                  onChangeText={setToken}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  placeholderTextColor="#C7C7CC"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  secureTextEntry={hasExistingToken && token.length > 0}
                  editable={!isLoading}
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                />
                <Text style={styles.hint}>
                  Generate a token at github.com/settings/tokens
                </Text>
              </View>

              {hasExistingToken && (
                <View style={styles.statusBanner}>
                  <Text style={styles.statusIcon}>✓</Text>
                  <Text style={styles.statusText}>Token configured</Text>
                </View>
              )}

              {hasExistingToken && (
                <Pressable
                  onPress={handleDelete}
                  disabled={isLoading}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    pressed && !isLoading && styles.deleteButtonPressed,
                  ]}
                >
                  <Text style={styles.deleteButtonText}>Delete Token</Text>
                </Pressable>
              )}

              <View style={styles.infoBox}>
                <Text style={styles.infoTitle}>What permissions do I need?</Text>
                <Text style={styles.infoText}>
                  • <Text style={styles.infoBold}>repo</Text> - Access repositories{"\n"}
                  • <Text style={styles.infoBold}>read:org</Text> - Read organization data{"\n"}
                  • <Text style={styles.infoBold}>read:user</Text> - Read user profile
                </Text>
              </View>

              <View style={styles.footerNote}>
                <Text style={styles.footerNoteText}>
                  Your token is stored securely and never shared. SSO support coming soon.
                </Text>
              </View>
                </>
              )}
            </View>
          </SafeAreaView>
        </TouchableWithoutFeedback>
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
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
    backgroundColor: "#FFFFFF",
  },
  headerAction: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    minWidth: 60,
  },
  headerActionPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  headerActionText: {
    color: "#0A84FF",
    fontSize: 16,
    fontWeight: "600",
  },
  saveText: {
    fontWeight: "700",
  },
  disabledText: {
    color: "#C7C7CC",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  enableSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  enableLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "#E7F0FF",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 24,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1C1C1E",
    textAlign: "center",
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: "#636366",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  inputSection: {
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#C7C7CC",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#1C1C1E",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  hint: {
    fontSize: 13,
    color: "#8E8E93",
    marginTop: 8,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F5E9",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statusIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  statusText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2E7D32",
  },
  deleteButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FF3B30",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 24,
  },
  deleteButtonPressed: {
    backgroundColor: "#FFF5F5",
  },
  deleteButtonText: {
    color: "#FF3B30",
    fontSize: 16,
    fontWeight: "600",
  },
  infoBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#636366",
    lineHeight: 20,
  },
  infoBold: {
    fontWeight: "600",
    color: "#1C1C1E",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  footerNote: {
    paddingVertical: 16,
  },
  footerNoteText: {
    fontSize: 13,
    color: "#8E8E93",
    textAlign: "center",
    lineHeight: 18,
  },
});

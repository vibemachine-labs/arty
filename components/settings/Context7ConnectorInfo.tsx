import React, { useEffect, useState } from "react";
import {
  Alert,
  DeviceEventEmitter,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CONNECTOR_SETTINGS_CHANGED_EVENT } from "@/modules/vm-webrtc";
import {
  saveContext7ApiKey,
  getContext7ApiKey,
  deleteContext7ApiKey,
} from "@/lib/secure-storage";

type Context7ConnectorInfoProps = {
  visible: boolean;
  onClose: () => void;
};

export const Context7ConnectorInfo: React.FC<Context7ConnectorInfoProps> = ({
  visible,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const [isEnabled, setIsEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);

  // Load enabled state and check for existing API key when modal opens
  useEffect(() => {
    if (visible) {
      const loadState = async () => {
        try {
          // Load enabled state
          const enabledValue = await AsyncStorage.getItem("context7_connector_enabled");
          setIsEnabled(enabledValue === null ? true : enabledValue === "true");

          // Check if API key exists (don't load the actual value for security)
          const existingKey = await getContext7ApiKey();
          setHasExistingKey(!!existingKey);
        } catch {
          // ignore errors
        }
      };
      loadState();
    }
  }, [visible]);

  const handleToggleEnabled = async (value: boolean) => {
    setIsEnabled(value);
    try {
      await AsyncStorage.setItem("context7_connector_enabled", value.toString());
      // Emit event to trigger cache reload
      DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
    } catch {
      // ignore errors
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      Alert.alert("Error", "Please enter a valid API key");
      return;
    }

    setIsSaving(true);
    try {
      await saveContext7ApiKey(apiKey.trim());
      setHasExistingKey(true);
      setApiKey("");
      Alert.alert("Success", "Context7 API key saved successfully");
      // Emit event to trigger cache reload
      DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
    } catch (error) {
      Alert.alert(
        "Error",
        `Failed to save API key: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteApiKey = async () => {
    Alert.alert(
      "Delete API Key",
      "Are you sure you want to delete your Context7 API key?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteContext7ApiKey();
              setHasExistingKey(false);
              setApiKey("");
              Alert.alert("Success", "Context7 API key deleted successfully");
              // Emit event to trigger cache reload
              DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
            } catch (error) {
              Alert.alert(
                "Error",
                `Failed to delete API key: ${error instanceof Error ? error.message : "Unknown error"}`
              );
            }
          },
        },
      ]
    );
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Context7</Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.headerAction,
              pressed && styles.headerActionPressed,
            ]}
          >
            <Text style={styles.headerActionText}>Done</Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.content,
            { paddingBottom: insets.bottom > 0 ? insets.bottom : 24 },
          ]}
        >
          <View style={styles.enableSection}>
            <Text style={styles.enableLabel}>Enable Context7 Connector</Text>
            <Switch
              value={isEnabled}
              onValueChange={handleToggleEnabled}
              trackColor={{ false: "#E5E5EA", true: "#34C759" }}
              thumbColor="#FFFFFF"
            />
          </View>

          <Text style={styles.bodyText}>
            Access up-to-date, version-specific documentation and code examples for any library.
            Context7 provides higher rate limits and private repository access with an API key.
          </Text>

          <Text style={styles.sectionTitle}>API Key (Optional)</Text>
          <Text style={styles.sectionDescription}>
            Get your API key at{" "}
            <Text style={styles.link}>context7.com/dashboard</Text>
          </Text>

          {hasExistingKey && (
            <View style={styles.existingKeyBanner}>
              <Text style={styles.existingKeyText}>✓ API key configured</Text>
              <Pressable onPress={handleDeleteApiKey}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          )}

          <TextInput
            style={styles.input}
            placeholder="Enter Context7 API key (optional)"
            value={apiKey}
            onChangeText={setApiKey}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSaving}
          />

          <Pressable
            style={({ pressed }) => [
              styles.saveButton,
              isSaving && styles.saveButtonDisabled,
              pressed && !isSaving && styles.saveButtonPressed,
            ]}
            onPress={handleSaveApiKey}
            disabled={isSaving}
          >
            <Text style={styles.saveButtonText}>
              {isSaving ? "Saving..." : "Save API Key"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  headerAction: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  headerActionPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  headerActionText: {
    color: "#0A84FF",
    fontSize: 16,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
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
  bodyText: {
    fontSize: 17,
    lineHeight: 24,
    color: "#1C1C1E",
    textAlign: "left",
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 15,
    lineHeight: 22,
    color: "#636366",
    marginBottom: 16,
  },
  link: {
    color: "#0A84FF",
    fontWeight: "600",
  },
  existingKeyBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#E8F5E9",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  existingKeyText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2E7D32",
  },
  deleteText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FF3B30",
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: "#0A84FF",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  saveButtonPressed: {
    backgroundColor: "#0066CC",
  },
  saveButtonDisabled: {
    backgroundColor: "#C7C7CC",
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});

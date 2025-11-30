import React, { useEffect, useState } from "react";
import {
  DeviceEventEmitter,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CONNECTOR_SETTINGS_CHANGED_EVENT } from "@/modules/vm-webrtc";

type GithubLegacyConnectorInfoProps = {
  visible: boolean;
  onClose: () => void;
};

export const GithubLegacyConnectorInfo: React.FC<GithubLegacyConnectorInfoProps> = ({
  visible,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const [isEnabled, setIsEnabled] = useState(false);

  // Load enabled state when modal opens
  useEffect(() => {
    if (visible) {
      const loadEnabled = async () => {
        try {
          const enabledValue = await AsyncStorage.getItem("github_legacy_connector_enabled");
          // Default to false (disabled) for legacy connectors
          setIsEnabled(enabledValue === "true");
        } catch {
          // ignore errors
        }
      };
      loadEnabled();
    }
  }, [visible]);

  const handleToggleEnabled = async (value: boolean) => {
    setIsEnabled(value);
    try {
      await AsyncStorage.setItem("github_legacy_connector_enabled", value.toString());
      // Emit event to trigger cache reload
      DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
    } catch {
      // ignore errors
    }
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
          <Text style={styles.headerTitle}>GitHub (Legacy)</Text>
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
            <Text style={styles.enableLabel}>Enable Legacy GitHub Connector</Text>
            <Switch
              value={isEnabled}
              onValueChange={handleToggleEnabled}
              trackColor={{ false: "#E5E5EA", true: "#34C759" }}
              thumbColor="#FFFFFF"
            />
          </View>

          <Text style={styles.bodyText}>
            This is the legacy GitHub connector that uses Octokit and executes JavaScript snippets.
            {"\n\n"}
            It is disabled by default. The newer GitHub tools in the main GitHub connector are recommended.
            {"\n\n"}
            To use this connector, you must configure your GitHub personal access token in the GitHub connector settings.
          </Text>
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
  },
});

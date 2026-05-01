import React, { useCallback, useEffect, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MCPClient } from "../../modules/vm-webrtc/src/mcp_client/client";
import type { Tool } from "../../modules/vm-webrtc/src/mcp_client/types";
import {
  addMcpExtension,
  deleteMcpExtension,
  getMcpBearerToken,
  type McpExtensionRecord,
} from "../../lib/secure-storage";
import { CONNECTOR_SETTINGS_CHANGED_EVENT } from "../../modules/vm-webrtc/src/ToolkitManager";
import { McpConnectorConfig } from "./McpConnectorConfig";

export interface McpExtensionDetailScreenProps {
  extension: McpExtensionRecord;
  visible: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
  onUpdated: (updated: McpExtensionRecord) => void;
}

export const McpExtensionDetailScreen: React.FC<McpExtensionDetailScreenProps> = ({
  extension,
  visible,
  onClose,
  onRemove,
  onUpdated,
}) => {
  const insets = useSafeAreaInsets();
  const [currentExtension, setCurrentExtension] = useState(extension);
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [configureVisible, setConfigureVisible] = useState(false);

  useEffect(() => {
    setCurrentExtension(extension);
  }, [extension]);

  const fetchTools = useCallback(async () => {
    setToolsLoading(true);
    setToolsError(null);
    try {
      const token = await getMcpBearerToken(currentExtension.id);
      const client = new MCPClient(currentExtension.serverUrl, token ?? undefined);
      const result = await client.listTools();
      setTools(result.tools ?? []);
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : String(err));
    } finally {
      setToolsLoading(false);
    }
  }, [currentExtension.id, currentExtension.serverUrl]);

  useEffect(() => {
    if (visible) {
      setTools([]);
      fetchTools();
    }
  }, [visible]);

  const handleRemove = () => {
    const doRemove = async () => {
      await deleteMcpExtension(currentExtension.id);
      DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
      onRemove(currentExtension.id);
      onClose();
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Remove "${currentExtension.name}"?`,
          message: "This will disconnect the extension and delete all saved credentials.",
          options: ["Cancel", "Remove"],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) doRemove();
        }
      );
    } else {
      Alert.alert(
        "Remove Extension",
        `Remove "${currentExtension.name}"? This will disconnect the extension and delete all saved credentials.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: doRemove },
        ]
      );
    }
  };

  const handleToggleDisabled = async (enabled: boolean) => {
    const updated = { ...currentExtension, disabled: !enabled };
    await addMcpExtension(updated);
    DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
    setCurrentExtension(updated);
    onUpdated(updated);
  };

  const handleConfigureSave = (updated?: McpExtensionRecord) => {
    setConfigureVisible(false);
    if (updated) {
      setCurrentExtension(updated);
      onUpdated(updated);
      fetchTools();
    }
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="formSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={
            <RefreshControl refreshing={toolsLoading} onRefresh={fetchTools} tintColor="#8E8E93" />
          }
        >
          <View style={styles.infoCard}>
            <View style={styles.iconContainer}>
              <Text style={styles.iconText}>🔌</Text>
            </View>
            <View style={styles.infoBody}>
              <Text style={styles.extensionName}>{currentExtension.name}</Text>
              <Text style={styles.extensionUrl} numberOfLines={2}>
                {currentExtension.serverUrl}
              </Text>
            </View>
          </View>

          <View style={styles.enableRow}>
            <Text style={styles.enableLabel}>Enabled</Text>
            <Switch
              value={!currentExtension.disabled}
              onValueChange={handleToggleDisabled}
              trackColor={{ false: "#E5E5EA", true: "#34C759" }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Tools</Text>
            <Pressable
              onPress={fetchTools}
              disabled={toolsLoading}
              style={({ pressed }) => [
                styles.refreshButton,
                pressed && styles.refreshButtonPressed,
              ]}
            >
              {toolsLoading ? (
                <ActivityIndicator size="small" color="#0A84FF" />
              ) : (
                <Text style={styles.refreshButtonText}>↻ Refresh</Text>
              )}
            </Pressable>
          </View>

          {toolsError ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{toolsError}</Text>
              <Pressable
                onPress={fetchTools}
                style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : tools.length === 0 && !toolsLoading ? (
            <View style={styles.emptyTools}>
              <Text style={styles.emptyToolsText}>No tools found</Text>
            </View>
          ) : (
            <View style={styles.toolsList}>
              {tools.map((tool, idx) => (
                <View
                  key={tool.name}
                  style={[styles.toolRow, idx < tools.length - 1 && styles.toolRowBorder]}
                >
                  <Text style={styles.toolName}>{tool.name}</Text>
                  {!!tool.description && (
                    <Text style={styles.toolDescription} numberOfLines={2}>
                      {tool.description}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            style={({ pressed }) => [styles.configureButton, pressed && styles.configureButtonPressed]}
            onPress={() => setConfigureVisible(true)}
          >
            <Text style={styles.configureButtonText}>Configure</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
            onPress={handleRemove}
          >
            <Text style={styles.removeButtonText}>Remove</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <McpConnectorConfig
        visible={configureVisible}
        onClose={() => setConfigureVisible(false)}
        existingExtension={currentExtension}
        onSave={handleConfigureSave}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F5F7",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  backButtonPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  backButtonText: {
    fontSize: 17,
    color: "#0A84FF",
    fontWeight: "400",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 16,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  enableRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  enableLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1C1C1E",
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#F0FFF4",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 24,
  },
  infoBody: {
    flex: 1,
    gap: 4,
  },
  extensionName: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  extensionUrl: {
    fontSize: 13,
    color: "#8E8E93",
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  refreshButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    minWidth: 80,
    alignItems: "center",
  },
  refreshButtonPressed: {
    opacity: 0.6,
  },
  refreshButtonText: {
    fontSize: 13,
    color: "#0A84FF",
    fontWeight: "600",
  },
  errorContainer: {
    backgroundColor: "#FFF2F2",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#FFD0D0",
  },
  errorText: {
    fontSize: 13,
    color: "#FF3B30",
    lineHeight: 18,
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  retryButtonPressed: {
    opacity: 0.6,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FF3B30",
  },
  emptyTools: {
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyToolsText: {
    fontSize: 15,
    color: "#8E8E93",
  },
  toolsList: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    overflow: "hidden",
  },
  toolRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 3,
  },
  toolRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#F2F2F7",
  },
  toolName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1C1C1E",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  toolDescription: {
    fontSize: 12,
    color: "#8E8E93",
    lineHeight: 17,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E5EA",
    backgroundColor: "#F5F5F7",
  },
  configureButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#1C1C1E",
  },
  configureButtonPressed: {
    opacity: 0.85,
  },
  configureButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  removeButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FF3B30",
  },
  removeButtonPressed: {
    backgroundColor: "#FFF2F2",
  },
  removeButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FF3B30",
  },
});

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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

import {
  listMcpServers,
  removeMcpServer,
  type McpServerDefinition,
  upsertMcpServer,
} from "../../lib/secure-storage";

type McpConnectorConfigProps = {
  visible: boolean;
  onClose: () => void;
};

const initialFormState = { name: "", url: "" };

export const McpConnectorConfig: React.FC<McpConnectorConfigProps> = ({
  visible,
  onClose,
}) => {
  const [servers, setServers] = useState<McpServerDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [form, setForm] = useState(initialFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refreshServers = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listMcpServers();
      setServers(list);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      refreshServers();
    } else {
      setAddModalVisible(false);
      setForm(initialFormState);
      setFormError(null);
    }
  }, [visible, refreshServers]);

  const handleSaveServer = useCallback(async () => {
    const trimmedName = form.name.trim();
    const trimmedUrl = form.url.trim();

    if (!trimmedName || !trimmedUrl) {
      setFormError("Both name and URL are required.");
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      const updated = await upsertMcpServer(trimmedName, trimmedUrl);
      setServers(updated);
      setForm(initialFormState);
      setAddModalVisible(false);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Unable to save MCP server right now.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [form]);

  const confirmDeleteServer = useCallback((server: McpServerDefinition) => {
    Alert.alert(
      "Remove MCP Server",
      `Remove “${server.name}”? You can add it back later.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const updated = await removeMcpServer(server.name);
            setServers(updated);
          },
        },
      ],
    );
  }, []);

  const emptyStateCopy = useMemo(
    () => ({
      title: "No MCP servers yet",
      subtitle: "Use the + button to securely add a Model Context Protocol server.",
    }),
    [],
  );

  return (
    <>
      <Modal
        animationType="slide"
        presentationStyle="formSheet"
        visible={visible}
        onRequestClose={onClose}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <View style={styles.headerTextGroup}>
              <Text style={styles.headerTitle}>Model Context Protocol</Text>
              <Text style={styles.headerSubtitle}>
                Maintain trusted MCP endpoints for your connector tools.
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => setAddModalVisible(true)}
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && styles.iconButtonPressed,
                ]}
              >
                <Text style={styles.iconButtonText}>＋</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.doneButton,
                  pressed && styles.doneButtonPressed,
                ]}
              >
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
          >
            {isLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator color="#0A84FF" />
                <Text style={styles.loadingCopy}>Loading servers…</Text>
              </View>
            ) : servers.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{emptyStateCopy.title}</Text>
                <Text style={styles.emptySubtitle}>
                  {emptyStateCopy.subtitle}
                </Text>
              </View>
            ) : (
              servers.map((server) => (
                <View key={server.name} style={styles.serverRow}>
                  <View style={styles.serverInfo}>
                    <Text style={styles.serverName}>{server.name}</Text>
                    <Text style={styles.serverUrl} numberOfLines={1}>
                      {server.url}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel={`Delete ${server.name}`}
                    accessibilityRole="button"
                    onPress={() => confirmDeleteServer(server)}
                    style={({ pressed }) => [
                      styles.deleteButton,
                      pressed && styles.deleteButtonPressed,
                    ]}
                  >
                    <Text style={styles.deleteButtonText}>Remove</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={addModalVisible}
        onRequestClose={() => setAddModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.addModalContainer}
        >
          <Pressable
            style={styles.addModalBackdrop}
            onPress={() => setAddModalVisible(false)}
          />

          <View style={styles.addModalCard}>
            <Text style={styles.addModalTitle}>New MCP Server</Text>
            <Text style={styles.addModalSubtitle}>
              Give the server a friendly name and paste the full URL.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Name</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Internal Tools"
                placeholderTextColor="#C7C7CC"
                style={styles.textInput}
                value={form.name}
                onChangeText={(value) => {
                  setForm((prev) => ({ ...prev, name: value }));
                  if (formError) {
                    setFormError(null);
                  }
                }}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>URL</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://server.example.com/mcp"
                placeholderTextColor="#C7C7CC"
                keyboardType="url"
                style={styles.textInput}
                value={form.url}
                onChangeText={(value) => {
                  setForm((prev) => ({ ...prev, url: value }));
                  if (formError) {
                    setFormError(null);
                  }
                }}
              />
            </View>

            {formError && <Text style={styles.formError}>{formError}</Text>}

            <View style={styles.addModalActions}>
              <Pressable
                onPress={() => {
                  setForm(initialFormState);
                  setFormError(null);
                  setAddModalVisible(false);
                }}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveServer}
                disabled={isSaving}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || isSaving) && styles.primaryButtonPressed,
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
  },
  headerTextGroup: {
    flex: 1,
    paddingRight: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#636366",
    lineHeight: 20,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  iconButtonPressed: {
    backgroundColor: "#F2F2F7",
  },
  iconButtonText: {
    fontSize: 24,
    lineHeight: 24,
    color: "#0A84FF",
  },
  doneButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  doneButtonPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  doneButtonText: {
    color: "#0A84FF",
    fontSize: 16,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 12,
  },
  loadingState: {
    paddingVertical: 64,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingCopy: {
    fontSize: 14,
    color: "#636366",
  },
  emptyState: {
    paddingVertical: 64,
    paddingHorizontal: 16,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#636366",
    textAlign: "center",
    lineHeight: 20,
  },
  serverRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  serverInfo: {
    flex: 1,
  },
  serverName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 4,
  },
  serverUrl: {
    fontSize: 13,
    color: "#636366",
  },
  deleteButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FF3B30",
  },
  deleteButtonPressed: {
    backgroundColor: "rgba(255, 59, 48, 0.1)",
  },
  deleteButtonText: {
    color: "#FF3B30",
    fontSize: 14,
    fontWeight: "600",
  },
  addModalContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
  },
  addModalBackdrop: {
    flex: 1,
  },
  addModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 16,
  },
  addModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  addModalSubtitle: {
    fontSize: 14,
    color: "#636366",
    lineHeight: 20,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#3A3A3C",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  textInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1C1C1E",
    backgroundColor: "#F9F9FB",
  },
  formError: {
    color: "#FF3B30",
    fontSize: 13,
    marginTop: 4,
  },
  addModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 8,
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D1D6",
  },
  secondaryButtonPressed: {
    backgroundColor: "#F2F2F7",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  primaryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#0A84FF",
    minWidth: 96,
    alignItems: "center",
  },
  primaryButtonPressed: {
    opacity: 0.8,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});

export default McpConnectorConfig;

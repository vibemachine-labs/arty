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
import * as Clipboard from "expo-clipboard";

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
            <View style={styles.headerTopRow}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.doneButton,
                  pressed && styles.doneButtonPressed,
                ]}
              >
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
              <Pressable
                onPress={() => setAddModalVisible(true)}
                style={({ pressed }) => [
                  styles.addButton,
                  pressed && styles.addButtonPressed,
                ]}
                accessibilityLabel="Add MCP server"
                accessibilityRole="button"
              >
                <Text style={styles.addButtonText}>＋</Text>
              </Pressable>
            </View>
            <View style={styles.headerTextGroup}>
              <Text style={styles.headerTitle}>MCP Servers</Text>
              <Text style={styles.headerSubtitle}>Manage MCP servers</Text>
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
            <View style={styles.modalNavBar}>
              <Pressable
                onPress={() => {
                  setForm(initialFormState);
                  setFormError(null);
                  setAddModalVisible(false);
                }}
                style={({ pressed }) => [
                  styles.navTextButton,
                  pressed && styles.navTextButtonPressed,
                ]}
              >
                <Text style={styles.navTextButtonLabel}>Cancel</Text>
              </Pressable>
              <Text style={styles.modalTitle}>New MCP Server</Text>
              <Pressable
                onPress={handleSaveServer}
                disabled={isSaving}
                style={({ pressed }) => [
                  styles.navTextButton,
                  (pressed || isSaving) && styles.navTextButtonPressed,
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#0A84FF" />
                ) : (
                  <Text style={styles.navTextButtonPrimary}>Done</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.modalBody}>
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
                <View style={styles.urlLabelRow}>
                  <Text style={styles.inputLabel}>URL</Text>
                  <Pressable
                    onPress={async () => {
                      const clipboardContent = await Clipboard.getStringAsync();
                      if (clipboardContent) {
                        setForm((prev) => ({ ...prev, url: clipboardContent }));
                        if (formError) {
                          setFormError(null);
                        }
                      }
                    }}
                    style={({ pressed }) => [
                      styles.pasteButton,
                      pressed && styles.pasteButtonPressed,
                    ]}
                  >
                    <Text style={styles.pasteButtonText}>Paste</Text>
                  </Pressable>
                </View>
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
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
    gap: 12,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTextGroup: {
    flex: 1,
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
  addButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
  },
  addButtonPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  addButtonText: {
    color: "#0A84FF",
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 22,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 12,
    flexGrow: 1,
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
    flex: 1,
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    gap: 6,
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
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  addModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  addModalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingBottom: 12,
  },
  modalNavBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E5EA",
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  navTextButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
  },
  navTextButtonPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  navTextButtonLabel: {
    color: "#0A84FF",
    fontSize: 16,
    fontWeight: "500",
  },
  navTextButtonPrimary: {
    color: "#0A84FF",
    fontSize: 16,
    fontWeight: "600",
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
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
  urlLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pasteButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "#E5F1FF",
  },
  pasteButtonPressed: {
    backgroundColor: "#D7E9FF",
  },
  pasteButtonText: {
    color: "#0A84FF",
    fontSize: 13,
    fontWeight: "600",
  },
});

export default McpConnectorConfig;

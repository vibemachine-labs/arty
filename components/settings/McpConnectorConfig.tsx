import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { probeMcpServer } from "../../modules/vm-webrtc/src/mcp_client/extensions";
import {
  addMcpExtension,
  saveMcpBearerToken,
} from "../../lib/secure-storage";

export interface McpConnectorConfigProps {
  visible: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export const McpConnectorConfig: React.FC<McpConnectorConfigProps> = ({
  visible,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const sanitizeToken = (value: string) => value.replace(/[\r\n\t ]+/g, "");

  const handleTokenChange = (value: string) => {
    setBearerToken(sanitizeToken(value));
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setBearerToken(sanitizeToken(text));
  };

  const handleCopy = async () => {
    if (!bearerToken) return;
    await Clipboard.setStringAsync(bearerToken);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  };

  const handleAdd = async () => {
    setIsConnecting(true);
    try {
      const token = bearerToken.trim() || undefined;
      const result = await probeMcpServer(serverUrl, token, name);

      if (result.success) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await addMcpExtension({ id, name, serverUrl });
        if (token) await saveMcpBearerToken(id, token);
        onSave?.();
        resetAndClose();
        Alert.alert(
          "Connected Successfully",
          "Extension added. You can update its config anytime from the Extensions (MCP) screen.",
          [{ text: "OK" }]
        );
      } else {
        const detail = result.error ?? `Server returned ${result.statusCode}`;
        Alert.alert("Connection Failed", detail, [{ text: "OK" }]);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const resetAndClose = () => {
    setName("");
    setServerUrl("");
    setBearerToken("");
    setAdvancedExpanded(false);
    setTokenVisible(false);
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="formSheet"
      visible={visible}
      onRequestClose={resetAndClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Add MCP Extension</Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter extension name..."
              placeholderTextColor="#AEAEB2"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>MCP Server URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://..."
              placeholderTextColor="#AEAEB2"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.hint}>
              Streamable HTTP endpoint for the MCP server
            </Text>
          </View>

          <Pressable
            style={styles.advancedToggle}
            onPress={() => setAdvancedExpanded((v) => !v)}
          >
            <Text style={styles.advancedToggleText}>Advanced</Text>
            <Text style={styles.advancedChevron}>
              {advancedExpanded ? "▲" : "▼"}
            </Text>
          </Pressable>

          {advancedExpanded && (
            <View style={styles.advancedSection}>
              <Text style={styles.label}>Bearer Token</Text>

              <View style={styles.tokenInputRow}>
                <TextInput
                  style={[styles.input, styles.tokenInput]}
                  value={bearerToken}
                  onChangeText={handleTokenChange}
                  placeholder="Optional JWT or access token..."
                  placeholderTextColor="#AEAEB2"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!tokenVisible}
                  multiline={false}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.tokenIconButton,
                    pressed && styles.tokenIconButtonPressed,
                  ]}
                  onPress={() => setTokenVisible((v) => !v)}
                >
                  <Text style={styles.tokenIconText}>
                    {tokenVisible ? "🙈" : "👁️"}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.tokenActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.tokenActionButton,
                    pressed && styles.tokenActionButtonPressed,
                  ]}
                  onPress={handlePaste}
                >
                  <Text style={styles.tokenActionText}>Paste</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.tokenActionButton,
                    !bearerToken && styles.tokenActionButtonDisabled,
                    pressed && styles.tokenActionButtonPressed,
                  ]}
                  onPress={handleCopy}
                  disabled={!bearerToken}
                >
                  <Text style={styles.tokenActionText}>
                    {copyFeedback ? "Copied!" : "Copy"}
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.hint}>
                Sent as{" "}
                <Text style={styles.hintMono}>Authorization: Bearer …</Text> on
                every request. Newlines are stripped automatically.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.cancelButtonPressed,
            ]}
            onPress={resetAndClose}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.connectButton,
              (!name.trim() || !serverUrl.trim() || isConnecting) && styles.connectButtonDisabled,
              pressed && styles.connectButtonPressed,
            ]}
            onPress={handleAdd}
            disabled={!name.trim() || !serverUrl.trim() || isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.connectButtonText}>Add</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F7",
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1C1C1E",
  },
  hint: {
    fontSize: 12,
    color: "#8E8E93",
    marginTop: 6,
    lineHeight: 17,
  },
  hintMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#E5E5EA",
  },
  advancedToggleText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#636366",
  },
  advancedChevron: {
    fontSize: 11,
    color: "#AEAEB2",
  },
  advancedSection: {
    marginBottom: 24,
  },
  tokenInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tokenInput: {
    flex: 1,
  },
  tokenIconButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    alignItems: "center",
    justifyContent: "center",
  },
  tokenIconButtonPressed: {
    opacity: 0.6,
  },
  tokenIconText: {
    fontSize: 18,
  },
  tokenActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  tokenActionButton: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  tokenActionButtonDisabled: {
    opacity: 0.4,
  },
  tokenActionButtonPressed: {
    opacity: 0.6,
  },
  tokenActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0A84FF",
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: "#E5E5EA",
    backgroundColor: "#F5F5F7",
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  cancelButtonPressed: {
    opacity: 0.7,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#636366",
  },
  connectButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#1C1C1E",
  },
  connectButtonDisabled: {
    backgroundColor: "#AEAEB2",
  },
  connectButtonPressed: {
    opacity: 0.85,
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});

import React, { useState } from "react";
import {
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

export interface McpConnectorConfigProps {
  visible: boolean;
  onClose: () => void;
}

export const McpConnectorConfig: React.FC<McpConnectorConfigProps> = ({
  visible,
  onClose,
}) => {
  const [name, setName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  const handleConnect = () => {
    // TODO: wire up MCP connection logic
    onClose();
  };

  const handleCancel = () => {
    setName("");
    setServerUrl("");
    setBearerToken("");
    setAdvancedExpanded(false);
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="formSheet"
      visible={visible}
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Add MCP Connector</Text>
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
              placeholder="Enter connector name..."
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
              <TextInput
                style={styles.input}
                value={bearerToken}
                onChangeText={setBearerToken}
                placeholder="Optional JWT or access token..."
                placeholderTextColor="#AEAEB2"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Text style={styles.hint}>
                Sent as{" "}
                <Text style={styles.hintMono}>Authorization: Bearer …</Text> on
                every request
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
            onPress={handleCancel}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.connectButton,
              (!name.trim() || !serverUrl.trim()) && styles.connectButtonDisabled,
              pressed && styles.connectButtonPressed,
            ]}
            onPress={handleConnect}
            disabled={!name.trim() || !serverUrl.trim()}
          >
            <Text style={styles.connectButtonText}>Connect</Text>
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
    marginBottom: 0,
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

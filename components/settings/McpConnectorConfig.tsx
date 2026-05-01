import React, { useState } from "react";
import {
  ActivityIndicator,
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
import { log } from "../../lib/logger";

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
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const headers: Record<string, string> = {};
      if (bearerToken.trim()) {
        headers["Authorization"] = `Bearer ${bearerToken.trim()}`;
      }

      log.info(
        "[mcp_connector] Probing MCP server (Step 1: initial request)",
        {},
        { connector_name: name, server_url: serverUrl, has_bearer_token: !!bearerToken.trim() }
      );

      let response: Response;
      try {
        response = await fetch(serverUrl, { method: "GET", headers });
      } catch (fetchError: any) {
        log.error(
          "[mcp_connector] Step 1: network error reaching MCP server",
          {},
          { connector_name: name, server_url: serverUrl, error: fetchError?.message }
        );
        return;
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseBody: string | null = null;
      try {
        responseBody = await response.text();
      } catch {
        responseBody = null;
      }

      const logAttrs = {
        connector_name: name,
        server_url: serverUrl,
        status_code: response.status,
        status_text: response.statusText,
        response_headers: responseHeaders,
        response_body_snippet: responseBody?.slice(0, 500) ?? null,
        www_authenticate: responseHeaders["www-authenticate"] ?? null,
        resource_metadata_url: null as string | null,
      };

      // Extract resource_metadata from WWW-Authenticate if present
      const wwwAuth = responseHeaders["www-authenticate"] ?? "";
      const resourceMetadataMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
      if (resourceMetadataMatch) {
        logAttrs.resource_metadata_url = resourceMetadataMatch[1];
      }

      if (response.status === 401) {
        log.info(
          "[mcp_connector] Step 1: got 401 — server requires auth (expected)",
          { allowSensitiveLogging: true },
          logAttrs
        );
      } else {
        log.info(
          "[mcp_connector] Step 1: server responded",
          { allowSensitiveLogging: true },
          logAttrs
        );
      }
    } finally {
      setIsConnecting(false);
    }
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
              (!name.trim() || !serverUrl.trim() || isConnecting) && styles.connectButtonDisabled,
              pressed && styles.connectButtonPressed,
            ]}
            onPress={handleConnect}
            disabled={!name.trim() || !serverUrl.trim() || isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.connectButtonText}>Connect</Text>
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

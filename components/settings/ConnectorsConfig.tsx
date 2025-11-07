import React, { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GDriveConnectorConfig } from "./GDriveConnectorConfig";
import { GithubConnectorConfig } from "./GithubConnectorConfig";
import {
  CONNECTOR_OPTIONS,
  type ConnectorId,
  type ConnectorOption,
} from "./connectorOptions";
import { WebConnectorInfo } from "./WebConnectorInfo";
import {
  loadHackerNewsSuiteEnabled,
  saveHackerNewsSuiteEnabled,
} from "../../lib/hackerNewsSettings";

export interface ConnectorsConfigProps {
  visible: boolean;
  onClose: () => void;
}

export const ConnectorsConfig: React.FC<ConnectorsConfigProps> = ({
  visible,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const [githubConfigVisible, setGithubConfigVisible] = useState(false);
  const [gdriveConfigVisible, setGDriveConfigVisible] = useState(false);
  const [webInfoVisible, setWebInfoVisible] = useState(false);
  const [hackerNewsEnabled, setHackerNewsEnabled] = useState(true);
  const [isHackerNewsHydrated, setIsHackerNewsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const stored = await loadHackerNewsSuiteEnabled();
      if (!isMounted) {
        return;
      }
      setHackerNewsEnabled(stored);
      setIsHackerNewsHydrated(true);
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleToggleHackerNews = async () => {
    const next = !hackerNewsEnabled;
    setHackerNewsEnabled(next);
    await saveHackerNewsSuiteEnabled(next);
  };

  const handleConnectorPress = (connectorId: ConnectorId) => {
    if (connectorId === "github") {
      setGithubConfigVisible(true);
    } else if (connectorId === "gdrive") {
      setGDriveConfigVisible(true);
    } else if (connectorId === "web") {
      setWebInfoVisible(true);
    } else if (connectorId === "gmail") {
      Alert.alert("Coming soon", "Gmail connector support is on the way.", [
        { text: "OK", style: "default" },
      ]);
    } else if (connectorId === "mcp") {
      Alert.alert("Coming soon", "MCP connector support is on the way.", [
        { text: "OK", style: "default" },
      ]);
    } else {
      // TODO: Navigate to other connector config screens
      console.log(`Configure ${connectorId}`);
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
          <Text style={styles.headerTitle}>Connectors</Text>
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

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          <Text style={styles.subtitle}>
            Configure external services to extend assistant capabilities
          </Text>

          <View style={styles.toggleCard}>
            <View style={styles.toggleTextContainer}>
              <Text style={styles.toggleTitle}>Hacker News tools</Text>
              <Text style={styles.toggleSubtitle}>
                Read-only access to stories, users, and updates. Enabled by default.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Enable Hacker News tool suite"
              onValueChange={handleToggleHackerNews}
              value={hackerNewsEnabled}
              disabled={!isHackerNewsHydrated}
              trackColor={{ true: "#0A84FF", false: "#D1D1D6" }}
              ios_backgroundColor="#D1D1D6"
            />
          </View>

          <View style={styles.grid}>
            {CONNECTOR_OPTIONS.map((connector: ConnectorOption) => (
              <Pressable
                key={connector.id}
                onPress={() => handleConnectorPress(connector.id)}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: connector.backgroundColor },
                  pressed && styles.cardPressed,
                ]}
              >
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: connector.iconBackgroundColor },
                  ]}
                >
                  <Text style={styles.icon}>{connector.icon}</Text>
                </View>
                <Text style={styles.cardTitle}>{connector.name}</Text>
                {connector.isConfigured && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>✓</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* GitHub Connector Config Modal */}
      <GithubConnectorConfig
        visible={githubConfigVisible}
        onClose={() => setGithubConfigVisible(false)}
        onSave={() => {
          // TODO: Refresh connector status
          console.log("GitHub token saved");
        }}
      />

      {/* Google Drive Connector Config Modal */}
      <GDriveConnectorConfig
        visible={gdriveConfigVisible}
        onClose={() => setGDriveConfigVisible(false)}
        onSave={() => {
          // TODO: Refresh connector status
          console.log("GDrive client ID override saved");
        }}
      />

      <WebConnectorInfo
        visible={webInfoVisible}
        onClose={() => setWebInfoVisible(false)}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  subtitle: {
    fontSize: 14,
    color: "#636366",
    marginBottom: 24,
    lineHeight: 20,
  },
  toggleCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  toggleTextContainer: {
    flex: 1,
    paddingRight: 12,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  toggleSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#6E6E73",
    lineHeight: 18,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  card: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  cardPressed: {
    opacity: 0.7,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  icon: {
    fontSize: 28,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1C1C1E",
    textAlign: "center",
  },
  badge: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#34C759",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});

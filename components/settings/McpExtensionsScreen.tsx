import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getMcpExtensions,
  type McpExtensionRecord,
} from "../../lib/secure-storage";
import { McpConnectorConfig } from "./McpConnectorConfig";
import { McpExtensionDetailScreen } from "./McpExtensionDetailScreen";

export interface McpExtensionsScreenProps {
  visible: boolean;
  onClose: () => void;
}

export const McpExtensionsScreen: React.FC<McpExtensionsScreenProps> = ({
  visible,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const [extensions, setExtensions] = useState<McpExtensionRecord[]>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [detailExtension, setDetailExtension] = useState<McpExtensionRecord | null>(null);

  const loadExtensions = useCallback(async () => {
    const list = await getMcpExtensions();
    setExtensions(list);
  }, []);

  useEffect(() => {
    if (visible) loadExtensions();
  }, [visible, loadExtensions]);

  const handleRemove = (id: string) => {
    setDetailExtension(null);
    setExtensions((prev) => prev.filter((e) => e.id !== id));
  };

  const handleUpdated = (updated: McpExtensionRecord) => {
    setExtensions((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
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
          <Text style={styles.headerTitle}>Extensions (MCP)</Text>
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => setAddVisible(true)}
              style={({ pressed }) => [
                styles.addButton,
                pressed && styles.addButtonPressed,
              ]}
            >
              <Text style={styles.addButtonText}>＋</Text>
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

        {extensions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔌</Text>
            <Text style={styles.emptyTitle}>No MCP Extensions</Text>
            <Text style={styles.emptySubtitle}>
              Connect to any MCP-compatible server to extend the assistant with
              custom tools.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.emptyAddButton,
                pressed && styles.emptyAddButtonPressed,
              ]}
              onPress={() => setAddVisible(true)}
            >
              <Text style={styles.emptyAddButtonText}>＋ Add your first MCP extension</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: insets.bottom + 24 },
            ]}
          >
            {extensions.map((ext) => (
              <Pressable
                key={ext.id}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => setDetailExtension(ext)}
              >
                <View style={styles.cardIcon}>
                  <Text style={styles.cardIconText}>🔌</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardName}>{ext.name}</Text>
                  <Text style={styles.cardUrl} numberOfLines={1}>
                    {ext.serverUrl}
                  </Text>
                </View>
                <Text style={styles.cardChevron}>›</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      <McpConnectorConfig
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onSave={() => {
          setAddVisible(false);
          loadExtensions();
        }}
      />

      {detailExtension && (
        <McpExtensionDetailScreen
          extension={detailExtension}
          visible={detailExtension !== null}
          onClose={() => setDetailExtension(null)}
          onRemove={handleRemove}
          onUpdated={handleUpdated}
        />
      )}
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
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonPressed: {
    opacity: 0.7,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontSize: 20,
    lineHeight: 24,
  },
  doneButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  doneButtonPressed: {
    backgroundColor: "rgba(10, 132, 255, 0.08)",
  },
  doneButtonText: {
    color: "#0A84FF",
    fontSize: 16,
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#636366",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  emptyAddButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: "#1C1C1E",
  },
  emptyAddButtonPressed: {
    opacity: 0.8,
  },
  emptyAddButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  cardPressed: {
    backgroundColor: "#F2F2F7",
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#F0FFF4",
    alignItems: "center",
    justifyContent: "center",
  },
  cardIconText: {
    fontSize: 20,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  cardUrl: {
    fontSize: 12,
    color: "#8E8E93",
  },
  cardChevron: {
    fontSize: 22,
    color: "#C7C7CC",
    fontWeight: "300",
  },
});

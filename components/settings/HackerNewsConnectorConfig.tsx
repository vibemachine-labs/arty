import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { saveHackerNewsEnabled } from "../../lib/hackerNewsPreference";

export interface HackerNewsConnectorConfigProps {
  visible: boolean;
  enabled: boolean;
  onClose: () => void;
  onStatusChange?: (enabled: boolean) => void;
}

export const HackerNewsConnectorConfig: React.FC<HackerNewsConnectorConfigProps> = ({
  visible,
  enabled,
  onClose,
  onStatusChange,
}) => {
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [isSaving, setIsSaving] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setLocalEnabled(enabled);
    }
  }, [enabled, visible]);

  const handleToggle = useCallback(
    async (value: boolean) => {
      setLocalEnabled(value);
      setIsSaving(true);
      try {
        await saveHackerNewsEnabled(value);
        onStatusChange?.(value);
      } catch (error) {
        Alert.alert(
          "Unable to Update",
          "We couldn't update Hacker News right now. Please try again."
        );
        setLocalEnabled(!value);
      } finally {
        setIsSaving(false);
      }
    },
    [onStatusChange]
  );

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Hacker News</Text>
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
            { paddingBottom: insets.bottom > 0 ? insets.bottom : 32 },
          ]}
        >
          <View style={styles.hero}>
            <Text style={styles.heroIcon}>🗞️</Text>
            <Text style={styles.heroTitle}>Hacker News Highlights</Text>
            <Text style={styles.heroDescription}>
              Surface trending engineering stories inside the assistant. You can
              keep this connector lightweight—just toggle it on when you want
              updates.
            </Text>
          </View>

          <View style={styles.preferenceCard}>
            <View style={styles.preferenceHeader}>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceTitle}>Enable Connector</Text>
                <Text style={styles.preferenceSubtitle}>
                  Allow the assistant to answer with the latest Hacker News
                  context.
                </Text>
              </View>
              <Switch
                value={localEnabled}
                onValueChange={handleToggle}
                trackColor={{ true: "#34C759", false: "#D1D1D6" }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#D1D1D6"
                disabled={isSaving}
              />
            </View>
          </View>
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
    paddingTop: 32,
    gap: 24,
  },
  hero: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  heroIcon: {
    fontSize: 32,
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
    marginBottom: 8,
    textAlign: "center",
  },
  heroDescription: {
    fontSize: 15,
    lineHeight: 22,
    color: "#636366",
    textAlign: "center",
  },
  preferenceCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  preferenceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  preferenceCopy: {
    flex: 1,
    gap: 4,
  },
  preferenceTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  preferenceSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: "#636366",
  },
});

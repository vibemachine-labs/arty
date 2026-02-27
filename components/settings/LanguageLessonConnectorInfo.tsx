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
import { LanguageLessonConfigModal } from "./LanguageLessonConfigModal";

type LanguageLessonConnectorInfoProps = {
  visible: boolean;
  onClose: () => void;
};

export const LanguageLessonConnectorInfo: React.FC<
  LanguageLessonConnectorInfoProps
> = ({ visible, onClose }) => {
  const insets = useSafeAreaInsets();
  const [isEnabled, setIsEnabled] = useState(false);
  const [configModalVisible, setConfigModalVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      const loadEnabled = async () => {
        try {
          const enabledValue = await AsyncStorage.getItem(
            "language_lesson_connector_enabled",
          );
          setIsEnabled(enabledValue === null ? false : enabledValue === "true");
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
      await AsyncStorage.setItem(
        "language_lesson_connector_enabled",
        value.toString(),
      );
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
          <Text style={styles.headerTitle}>Language Lesson</Text>
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
            <Text style={styles.enableLabel}>Enable Language Lesson</Text>
            <Switch
              value={isEnabled}
              onValueChange={handleToggleEnabled}
              trackColor={{ false: "#E5E5EA", true: "#34C759" }}
              thumbColor="#FFFFFF"
            />
          </View>

          <Text style={styles.bodyText}>
            This enables the language lesson toolkit group. The lesson JSON is
            shared across all language lesson tools.
          </Text>

          <View style={styles.jsonSection}>
            <Text style={styles.jsonTitle}>Lesson JSON</Text>
            <Text style={styles.jsonDescription}>
              Paste or update your lesson JSON for the entire language lesson
              flow.
            </Text>
            <Pressable
              onPress={() => setConfigModalVisible(true)}
              style={({ pressed }) => [
                styles.editButton,
                pressed && styles.editButtonPressed,
              ]}
            >
              <Text style={styles.editButtonText}>Edit Lesson JSON</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <LanguageLessonConfigModal
        visible={configModalVisible}
        onClose={() => setConfigModalVisible(false)}
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
    marginBottom: 24,
  },
  jsonSection: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  jsonTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  jsonDescription: {
    fontSize: 15,
    lineHeight: 21,
    color: "#3A3A3C",
  },
  editButton: {
    alignSelf: "flex-start",
    backgroundColor: "#0A84FF",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  editButtonPressed: {
    opacity: 0.85,
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});

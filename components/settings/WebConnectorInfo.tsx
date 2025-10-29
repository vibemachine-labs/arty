import React from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type WebConnectorInfoProps = {
  visible: boolean;
  onClose: () => void;
};

export const WebConnectorInfo: React.FC<WebConnectorInfoProps> = ({
  visible,
  onClose,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Web Search</Text>
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
          <Text style={styles.bodyText}>
            Web search is handled using GPT-5 and needs no further configuration.
            More options will be added later.
          </Text>
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
    justifyContent: "center",
  },
  bodyText: {
    fontSize: 17,
    lineHeight: 24,
    color: "#1C1C1E",
    textAlign: "left",
  },
});

import React, { useCallback } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "../ui/BottomSheet";
import { clearAllStoredSecrets } from "../../lib/secure-storage";
import { log } from "../../lib/logger";

interface AdvancedConfigurationSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfigureMainPrompt: () => void;
  onConfigureTools: () => void;
  onConfigureVad: () => void;
  onConfigureContextWindow: () => void;
}

type AdvancedAction = {
  id: "mainPrompt" | "tools" | "vad" | "contextWindow" | "clearSecrets";
  title: string;
  subtitle: string;
  onPress?: () => void;
  isPrimary?: boolean;
  isDanger?: boolean;
};

export const AdvancedConfigurationSheet: React.FC<AdvancedConfigurationSheetProps> = ({
  visible,
  onClose,
  onConfigureMainPrompt,
  onConfigureTools,
  onConfigureVad,
  onConfigureContextWindow,
}) => {
  const handleClearStoredSecrets = useCallback(() => {
    Alert.alert(
      "Clear All Secrets?",
      "This will permanently delete all stored secrets including:\n\n• OpenAI API Key\n• GitHub Token\n• Google Drive Tokens\n• Logfire API Key\n• All other credentials\n\nThis action cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            try {
              await clearAllStoredSecrets();

              // Re-initialize logging to pick up the cleared state
              await log.initialize();

              Alert.alert(
                "Secrets Cleared",
                "All stored secrets have been successfully deleted from secure storage.",
                [{ text: "OK" }]
              );
            } catch (error) {
              log.error("Failed to clear stored secrets", {}, error);
              Alert.alert(
                "Error",
                "Failed to clear stored secrets. Please try again.",
                [{ text: "OK" }]
              );
            }
          },
        },
      ]
    );
  }, []);

  const actions: AdvancedAction[] = [
    {
      id: "mainPrompt",
      title: "Configure Main Prompt",
      subtitle: "Refine the baseline instructions that guide every session.",
      onPress: () => {
        onClose();
        onConfigureMainPrompt();
      },
      isPrimary: true,
    },
    {
      id: "vad",
      title: "Configure Voice Activity Detection",
      subtitle: "Choose between server VAD or semantic VAD.",
      onPress: () => {
        onClose();
        onConfigureVad();
      },
    },
    {
      id: "contextWindow",
      title: "Configure Context Window",
      subtitle: "Manage audio retention, truncation, and conversation limits.",
      onPress: () => {
        onClose();
        onConfigureContextWindow();
      },
    },
    {
      id: "tools",
      title: "Configure Tools",
      subtitle: "Manage companion tools like GitHub and Google Drive.",
      onPress: () => {
        onClose();
        onConfigureTools();
      },
    },
    {
      id: "clearSecrets",
      title: "Clear Stored Secrets",
      subtitle: "Delete all API keys, tokens, and credentials from secure storage.",
      onPress: handleClearStoredSecrets,
      isDanger: true,
    },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Advanced Configuration">
      <View style={styles.body}>
        <Text style={styles.lead}>
          Tune advanced settings to tailor Vibemachine for your iOS sessions.
        </Text>
        <View style={styles.actionList}>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              accessibilityLabel={action.title}
              accessibilityHint={action.subtitle}
              onPress={action.onPress}
              disabled={!action.onPress}
              style={({ pressed }) => [
                styles.actionCard,
                action.isPrimary ? styles.actionCardPrimary : null,
                action.isDanger ? styles.actionCardDanger : null,
                !action.onPress ? styles.actionCardDisabled : null,
                pressed && action.onPress ? (action.isDanger ? styles.actionCardDangerPressed : styles.actionCardPressed) : null,
              ]}
            >
              <View style={styles.actionCopy}>
                <Text
                  style={[
                    styles.actionTitle,
                    action.isPrimary ? styles.actionTitlePrimary : null,
                    action.isDanger ? styles.actionTitleDanger : null,
                    !action.onPress ? styles.actionTitleDisabled : null,
                  ]}
                >
                  {action.title}
                </Text>
                <Text
                  style={[
                    styles.actionSubtitle,
                    !action.onPress ? styles.actionSubtitleDisabled : null,
                  ]}
                >
                  {action.subtitle}
                </Text>
              </View>
              <Text
                style={[
                  styles.actionChevron,
                  !action.onPress ? styles.actionChevronDisabled : null,
                ]}
              >
                ›
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: 16,
    paddingBottom: 16,
  },
  lead: {
    fontSize: 15,
    lineHeight: 20,
    color: "#3A3A3C",
  },
  actionList: {
    gap: 12,
  },
  actionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionCardPrimary: {
    borderColor: "#0A84FF",
    backgroundColor: "#F0F6FF",
  },
  actionCardDanger: {
    borderColor: "#FF3B30",
    backgroundColor: "#FFF0F0",
  },
  actionCardPressed: {
    backgroundColor: "#E5F1FF",
  },
  actionCardDangerPressed: {
    backgroundColor: "#FFE0DF",
  },
  actionCardDisabled: {
    borderColor: "#E2E3E8",
    backgroundColor: "#F6F6F8",
  },
  actionCopy: {
    flex: 1,
    marginRight: 12,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  actionTitlePrimary: {
    color: "#0A84FF",
  },
  actionTitleDanger: {
    color: "#FF3B30",
  },
  actionTitleDisabled: {
    color: "#8E8E93",
  },
  actionSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#636366",
  },
  actionSubtitleDisabled: {
    color: "#A1A1A6",
  },
  actionChevron: {
    fontSize: 18,
    color: "#8E8E93",
  },
  actionChevronDisabled: {
    color: "#C7C7CC",
  },
});

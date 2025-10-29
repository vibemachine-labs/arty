import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";

import { OnboardingWizard } from "../../app/OnboardingWizard";
import { RecordingScreen } from "./RecordingScreen";
import { loadShowRealtimeErrorAlerts, saveShowRealtimeErrorAlerts } from "../../lib/developerSettings";
import {
  getLogfireApiKey,
  getLogfireEnabled,
  saveLogfireApiKey,
  saveLogfireEnabled,
} from "../../lib/secure-storage";
import { log } from "../../lib/logger";

export interface DeveloperModeProps {
  visible: boolean;
  onClose: () => void;
}

const DeveloperModeHeader: React.FC<{
  onCancel: () => void;
  onDone: () => void;
  isSaving: boolean;
  isDoneDisabled: boolean;
}> = ({ onCancel, onDone, isSaving, isDoneDisabled }) => {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Cancel developer mode changes"
        accessibilityRole="button"
        onPress={onCancel}
        style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
      >
        <Text style={styles.headerButtonText}>Cancel</Text>
      </Pressable>
      <Text style={styles.title}>Developer Mode</Text>
      <Pressable
        accessibilityLabel="Save developer mode changes"
        accessibilityRole="button"
        onPress={onDone}
        disabled={isDoneDisabled}
        style={({ pressed }) => [
          styles.headerButton,
          pressed && !isDoneDisabled ? styles.headerButtonPressed : null,
          isDoneDisabled ? styles.headerButtonDisabled : null,
        ]}
      >
        <Text
          style={[
            styles.headerButtonText,
            isDoneDisabled ? styles.headerButtonTextDisabled : null,
          ]}
        >
          {isSaving ? "Saving…" : "Done"}
        </Text>
      </Pressable>
    </View>
  );
};

const ManagerRecordingSection: React.FC<{ onOpenManager: () => void }> = ({
  onOpenManager,
}) => {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Manager Recording</Text>
      <Text style={styles.sectionSubtitle}>
        Review iOS voice session audio captured during testing. Files stay on this device.
      </Text>
      <Pressable
        accessibilityLabel="Open recording manager"
        accessibilityRole="button"
        onPress={onOpenManager}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>Open Recording Manager</Text>
      </Pressable>
    </View>
  );
};

const OnboardingSection: React.FC<{ onFinishOnboarding: () => void }> = ({ onFinishOnboarding }) => {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Onboarding Wizard</Text>
      <Text style={styles.sectionSubtitle}>
        Walk through API key setup and Google Drive connector access so you can start voice chatting with your files.
      </Text>
      <OnboardingWizard
        onFinish={onFinishOnboarding}
        renderTrigger={(open) => (
          <Pressable
            accessibilityLabel="Open onboarding wizard"
            accessibilityRole="button"
            onPress={open}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>Launch Onboarding</Text>
          </Pressable>
        )}
      />
    </View>
  );
};

const ErrorAlertsSection: React.FC<{
  showErrorAlerts: boolean;
  onToggle: (value: boolean) => void;
}> = ({ showErrorAlerts, onToggle }) => {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.settingRow}>
        <View style={styles.settingTextContainer}>
          <Text style={styles.sectionTitle}>Show Error Alerts</Text>
          <Text style={styles.sectionSubtitle}>
            Display alert dialogs when realtime errors occur. Useful for debugging issues without interrupting the call.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Toggle error alerts"
          value={showErrorAlerts}
          onValueChange={onToggle}
          ios_backgroundColor="#D1D1D6"
          trackColor={{ false: "#D1D1D6", true: "#34C759" }}
        />
      </View>
    </View>
  );
};

const LogfireTracingSection: React.FC<{
  logfireEnabled: boolean;
  logfireApiKey: string;
  onToggleEnabled: (value: boolean) => void;
  onApiKeyChange: (value: string) => void;
  onPaste: () => void;
}> = ({ logfireEnabled, logfireApiKey, onToggleEnabled, onApiKeyChange, onPaste }) => {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.settingRow}>
        <View style={styles.settingTextContainer}>
          <Text style={styles.sectionTitle}>Enable Pydantic Logfire Tracing</Text>
          <Text style={styles.sectionSubtitle}>
            Send OpenTelemetry traces to Pydantic Logfire for observability and debugging.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Toggle Pydantic Logfire tracing"
          value={logfireEnabled}
          onValueChange={onToggleEnabled}
          ios_backgroundColor="#D1D1D6"
          trackColor={{ false: "#D1D1D6", true: "#34C759" }}
        />
      </View>
      {logfireEnabled && (
        <View style={styles.apiKeyInputContainer}>
          <Text style={styles.apiKeyLabel}>Logfire API Key</Text>
          <View style={styles.apiKeyInputRow}>
            <TextInput
              style={styles.apiKeyInput}
              value={logfireApiKey}
              onChangeText={onApiKeyChange}
              placeholder="Paste your Pydantic Logfire API key"
              placeholderTextColor="#8E8E93"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Pressable
              accessibilityLabel="Paste API key from clipboard"
              accessibilityRole="button"
              onPress={onPaste}
              style={({ pressed }) => [
                styles.pasteButton,
                pressed && styles.pasteButtonPressed,
              ]}
            >
              <Text style={styles.pasteButtonText}>Paste</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
};

export const DeveloperMode: React.FC<DeveloperModeProps> = ({ visible, onClose }) => {
  const [recordingManagerVisible, setRecordingManagerVisible] = useState(false);
  const [showErrorAlerts, setShowErrorAlerts] = useState(true);
  const [logfireEnabled, setLogfireEnabled] = useState(false);
  const [logfireApiKey, setLogfireApiKey] = useState("");
  const [initialSettings, setInitialSettings] = useState<{
    showErrorAlerts: boolean;
    logfireEnabled: boolean;
    logfireApiKey: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isReady = initialSettings !== null;

  useEffect(() => {
    if (!visible) {
      setRecordingManagerVisible(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const loadSettings = async () => {
      const setting = await loadShowRealtimeErrorAlerts();
      const enabled = await getLogfireEnabled();
      const apiKey = (await getLogfireApiKey()) || "";
      setShowErrorAlerts(setting);
      setLogfireEnabled(enabled);
      setLogfireApiKey(apiKey);
      setInitialSettings({
        showErrorAlerts: setting,
        logfireEnabled: enabled,
        logfireApiKey: apiKey,
      });
    };
    void loadSettings();
  }, [visible]);

  const handleOpenRecordingManager = useCallback(() => {
    setRecordingManagerVisible(true);
  }, []);

  const handleToggleErrorAlerts = useCallback((value: boolean) => {
    setShowErrorAlerts(value);
  }, []);

  const handleToggleLogfireEnabled = useCallback((value: boolean) => {
    setLogfireEnabled(value);
  }, []);

  const handleLogfireApiKeyChange = useCallback((value: string) => {
    setLogfireApiKey(value);
  }, []);

  const handlePasteLogfireApiKey = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim().length > 0) {
        setLogfireApiKey(text.trim());
      }
    } catch (error) {
      // Silently fail if clipboard access fails
      console.error("Failed to paste from clipboard:", error);
    }
  }, []);

  const restoreInitialSettings = useCallback(() => {
    if (initialSettings) {
      setShowErrorAlerts(initialSettings.showErrorAlerts);
      setLogfireEnabled(initialSettings.logfireEnabled);
      setLogfireApiKey(initialSettings.logfireApiKey);
    } else {
      setShowErrorAlerts(false);
      setLogfireEnabled(false);
      setLogfireApiKey("");
    }
    setRecordingManagerVisible(false);
  }, [initialSettings]);

  const persistSettings = useCallback(async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    const previous = initialSettings ?? {
      showErrorAlerts: false,
      logfireEnabled: false,
      logfireApiKey: "",
    };
    const trimmedApiKey = logfireApiKey.trim();
    try {
      if (showErrorAlerts !== previous.showErrorAlerts) {
        await saveShowRealtimeErrorAlerts(showErrorAlerts);
      }
      if (logfireEnabled !== previous.logfireEnabled) {
        await saveLogfireEnabled(logfireEnabled);
      }
      if (trimmedApiKey !== previous.logfireApiKey) {
        await saveLogfireApiKey(trimmedApiKey);
      }
      if (
        logfireEnabled !== previous.logfireEnabled ||
        trimmedApiKey !== previous.logfireApiKey
      ) {
        await log.initialize();
      }
      setInitialSettings({
        showErrorAlerts,
        logfireEnabled,
        logfireApiKey: trimmedApiKey,
      });
      setLogfireApiKey(trimmedApiKey);
      setRecordingManagerVisible(false);
      onClose();
    } catch (error) {
      console.error("Failed to save developer settings", error);
      Alert.alert(
        "Save failed",
        "Unable to persist developer settings. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    initialSettings,
    isSaving,
    logfireApiKey,
    logfireEnabled,
    onClose,
    showErrorAlerts,
  ]);

  const handleCancel = useCallback(() => {
    if (isSaving) {
      return;
    }
    restoreInitialSettings();
    onClose();
  }, [isSaving, onClose, restoreInitialSettings]);

  const handleDone = useCallback(() => {
    if (!initialSettings) {
      return;
    }
    void persistSettings();
  }, [initialSettings, persistSettings]);

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      supportedOrientations={["portrait"]}
      visible={visible}
      onRequestClose={handleCancel}
    >
      <SafeAreaView style={styles.safeArea}>
        <DeveloperModeHeader
          onCancel={handleCancel}
          onDone={handleDone}
          isSaving={isSaving}
          isDoneDisabled={!isReady || isSaving}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
          style={styles.keyboardAvoider}
        >
          <ScrollView
            bounces
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}
            style={styles.content}
            keyboardShouldPersistTaps="handled"
            contentInset={{ bottom: 32 }}
            contentInsetAdjustmentBehavior="automatic"
          >
            <ErrorAlertsSection
              showErrorAlerts={showErrorAlerts}
              onToggle={handleToggleErrorAlerts}
            />
            <ManagerRecordingSection
              onOpenManager={handleOpenRecordingManager}
            />
            <OnboardingSection onFinishOnboarding={onClose} />
            <LogfireTracingSection
              logfireEnabled={logfireEnabled}
              logfireApiKey={logfireApiKey}
              onToggleEnabled={handleToggleLogfireEnabled}
              onApiKeyChange={handleLogfireApiKeyChange}
              onPaste={handlePasteLogfireApiKey}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <RecordingScreen
        visible={recordingManagerVisible}
        onClose={() => setRecordingManagerVisible(false)}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#C6C6C8",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 12,
  },
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 60,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  headerButtonPressed: {
    backgroundColor: "rgba(0, 122, 255, 0.12)",
  },
  headerButtonDisabled: {
    opacity: 0.4,
  },
  headerButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#007AFF",
  },
  headerButtonTextDisabled: {
    color: "#8E8E93",
  },
  content: {
    flex: 1,
  },
  keyboardAvoider: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
  },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1C1C1E",
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: "#6E6E73",
    marginBottom: 16,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: "#0A84FF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonPressed: {
    backgroundColor: "#0060DF",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  settingTextContainer: {
    flex: 1,
  },
  apiKeyInputContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E5EA",
  },
  apiKeyLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  apiKeyInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  apiKeyInput: {
    flex: 1,
    backgroundColor: "#F2F2F7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  pasteButton: {
    backgroundColor: "#0A84FF",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 70,
    alignItems: "center",
    justifyContent: "center",
  },
  pasteButtonPressed: {
    backgroundColor: "#0060DF",
  },
  pasteButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});

import { Camera } from "expo-camera";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdvancedConfigurationSheet } from "../components/settings/AdvancedConfigurationSheet";
import { ConfigureChatMode, type ChatMode } from "../components/settings/ConfigureChatMode";
import { ConfigureMainPromptModal } from "../components/settings/ConfigureMainPromptModal";
import { ConfigureVoice } from "../components/settings/ConfigureVoice";
import { ConfigureVad } from "../components/settings/ConfigureVad";
import { ConfigureContextWindow } from "../components/settings/ConfigureContextWindow";
import { ConfigureToolsSheet } from "../components/settings/ConfigureToolsSheet";
import { ConnectorsConfig } from "../components/settings/ConnectorsConfig";
import { DeveloperMode } from "../components/ui/DeveloperMode";
import { HamburgerButton } from "../components/ui/HamburgerButton";
import { HamburgerMenu, type MenuSection } from "../components/ui/HamburgerMenu";
import { log } from "../lib/logger";
import { DEFAULT_VAD_MODE, loadVadPreference, saveVadPreference, type VadMode } from "../lib/vadPreference";
import { DEFAULT_VOICE, loadVoicePreference, saveVoicePreference } from "../lib/voicePreference";
import { getApiKey } from "../lib/secure-storage";
import { loadMainPromptAddition } from "../lib/mainPrompt";
import { ConfigureApiKeyScreen } from "./ConfigureApiKey";
import { OnboardingWizard } from "./OnboardingWizard";
import TextChat from "./TextChat";
import VoiceChat from "./VoiceChat";

import { type BaseOpenAIConnectionOptions } from "../modules/vm-webrtc";

const buildConnectionOptions = async (): Promise<BaseOpenAIConnectionOptions | null> => {
  // Try to get user-saved API key first
  let apiKey = await getApiKey({ forceSecureStore: true });
  
  if (apiKey) {
    log.info("Using user-saved API key from secure storage");
  } else {
    // Fall back to environment variable
    apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY || null;
    if (apiKey) {
      log.info("Using API key from environment variable (.env)");
    }
  }

  if (!apiKey) {
    log.warn("No API key available from secure storage or environment");
    return null;
  }

  const envVoice = process.env.EXPO_PUBLIC_OPENAI_REALTIME_VOICE?.trim();

  return {
    apiKey,
    model: process.env.EXPO_PUBLIC_OPENAI_REALTIME_MODEL,
    baseUrl: process.env.EXPO_PUBLIC_OPENAI_REALTIME_BASE_URL,
    voice: envVoice && envVoice.length > 0 ? envVoice : "cedar",
  };
};

export default function Index() {
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [apiKeyConfigVisible, setApiKeyConfigVisible] = useState(false);
  const [developerModeVisible, setDeveloperModeVisible] = useState(false);
  const [connectorsConfigVisible, setConnectorsConfigVisible] = useState(false);
  const [advancedConfigVisible, setAdvancedConfigVisible] = useState(false);
  const [configureToolsVisible, setConfigureToolsVisible] = useState(false);
  const [baseConnectionOptions, setBaseConnectionOptions] = useState<BaseOpenAIConnectionOptions | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE);
  const [voiceSheetVisible, setVoiceSheetVisible] = useState(false);
  const [selectedVadMode, setSelectedVadMode] = useState<VadMode>(DEFAULT_VAD_MODE);
  const [vadSheetVisible, setVadSheetVisible] = useState(false);
  const [selectedChatMode, setSelectedChatMode] = useState<ChatMode>("voice");
  const [chatModeSheetVisible, setChatModeSheetVisible] = useState(false);
  const [mainPromptModalVisible, setMainPromptModalVisible] = useState(false);
  const [mainPromptDraft, setMainPromptDraft] = useState("");
  const [mainPromptAddition, setMainPromptAddition] = useState("");
  const [contextWindowVisible, setContextWindowVisible] = useState(false);
  const [retentionRatio, setRetentionRatio] = useState(0.8);
  const [maxConversationTurns, setMaxConversationTurns] = useState<number | undefined>(7);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [onboardingCheckToken, setOnboardingCheckToken] = useState(0);
  const [onboardingCompletionToken, setOnboardingCompletionToken] = useState(0);

  // Load connection options on mount and when API key config screen closes
  useEffect(() => {
    const loadConnectionOptions = async () => {
      const options = await buildConnectionOptions();
      setBaseConnectionOptions(options);
      // Don't set selectedVoice here - it's managed by voice preference persistence
    };
    void loadConnectionOptions();
  }, [apiKeyConfigVisible, onboardingCompletionToken]); // Reload when API key config closes or onboarding completes

  useEffect(() => {
    let isActive = true;

    const loadPromptAddition = async () => {
      const addition = await loadMainPromptAddition();
      if (!isActive) {
        return;
      }
      setMainPromptAddition(addition);
      setMainPromptDraft(addition);
    };

    loadPromptAddition();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const hydrateVadPreference = async () => {
      const stored = await loadVadPreference();
      if (!isMounted) {
        return;
      }
      setSelectedVadMode(stored);
    };

    hydrateVadPreference();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const hydrateVoicePreference = async () => {
      const stored = await loadVoicePreference();
      if (!isMounted) {
        return;
      }
      setSelectedVoice(stored);
      log.info("Voice preference loaded from storage", {}, { voice: stored });
    };

    hydrateVoicePreference();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const evaluateOnboardingStatus = async () => {
      try {
        const storedKey = await getApiKey({ forceSecureStore: true });
        const hasStoredKey = typeof storedKey === "string" && storedKey.trim().length > 0;
        if (!isActive) {
          return;
        }
        setOnboardingVisible(!hasStoredKey);
      } catch (error) {
        if (!isActive) {
          return;
        }
        log.warn("Unable to determine onboarding status from secure storage", {}, error);
        setOnboardingVisible(true);
      }
    };

    if (!apiKeyConfigVisible) {
      void evaluateOnboardingStatus();
    }

    return () => {
      isActive = false;
    };
  }, [apiKeyConfigVisible, onboardingCheckToken]);

  const handleOnboardingDismiss = useCallback(() => {
    setOnboardingVisible(false);
    setOnboardingCheckToken((prev) => prev + 1);
  }, []);

  const handleOnboardingFinish = useCallback(() => {
    setOnboardingCompletionToken((prev) => prev + 1);
  }, []);

  const handleSelectVoice = useCallback(
    (voice: string) => {
      setSelectedVoice(voice);
      void saveVoicePreference(voice);
      log.info("Voice preference updated and saved", {}, { voice });
      setVoiceSheetVisible(false);
    },
    []
  );

  const handleSelectVadMode = useCallback(
    (mode: VadMode) => {
      setSelectedVadMode(mode);
      void saveVadPreference(mode);
      log.info("VAD preference updated", {}, { mode });
      setVadSheetVisible(false);
    },
    []
  );

  const handleSelectChatMode = useCallback(
    (mode: ChatMode) => {
      setSelectedChatMode(mode);
      log.info("Chat mode preference updated", {}, { mode });
      setChatModeSheetVisible(false);
    },
    []
  );

  const handleMaxConversationTurnsChange = useCallback(
    (value: number | undefined) => {
      if (value !== undefined) {
        Alert.alert(
          "Not Implemented",
          "Maximum conversation turns is not currently implemented. This setting will be available in a future update.",
          [{ text: "OK" }]
        );
        setMaxConversationTurns(undefined);
      } else {
        setMaxConversationTurns(value);
      }
    },
    []
  );

  const handleSelectMenuSection = useCallback(
    (section: MenuSection) => {
      if (section.id === "voice") {
        setVoiceSheetVisible(true);
        return;
      }

      if (section.id === "chatMode") {
        setChatModeSheetVisible(true);
        return;
      }

      if (section.id === "connectors") {
        setConnectorsConfigVisible(true);
        return;
      }

      if (section.id === "apiKey") {
        setApiKeyConfigVisible(true);
        return;
      }

      if (section.id === "developer") {
        setDeveloperModeVisible(true);
        return;
      }

      if (section.id === "advanced") {
        setMainPromptDraft(mainPromptAddition);
        setAdvancedConfigVisible(true);
        return;
      }

      Alert.alert("Coming Soon", "This configuration section is currently under construction.");
    },
    [
      setVoiceSheetVisible,
      setChatModeSheetVisible,
      setConnectorsConfigVisible,
      setApiKeyConfigVisible,
      setDeveloperModeVisible,
      mainPromptAddition,
      setAdvancedConfigVisible,
    ]
  );

  useEffect(() => {
    if (Platform.OS !== "ios") {
      log.warn("Skipping microphone permission request on unsupported platform", {}, { platform: Platform.OS });
      setHasMicPermission(false);
      return;
    }

    const ensureMicrophonePermission = async () => {
      try {
        const existing = await Camera.getMicrophonePermissionsAsync();
        log.debug("Checked existing microphone permission", {}, {
          status: existing.status,
          granted: existing.granted,
          canAskAgain: existing.canAskAgain,
        });

        if (existing.granted || existing.status === "granted") {
          setHasMicPermission(true);
          setPermissionError(null);
          log.info("Microphone permission already granted");
          return;
        }

        if (!existing.canAskAgain) {
          setHasMicPermission(false);
          setPermissionError("Microphone access is disabled. Update iOS Settings to enable audio.");
          log.warn("Microphone permission permanently denied");
          return;
        }

        log.debug("Requesting microphone permission at startup");
        const requested = await Camera.requestMicrophonePermissionsAsync();
        const permissionGranted = requested.granted || requested.status === "granted";
        setHasMicPermission(permissionGranted);
        if (!permissionGranted) {
          setPermissionError("Microphone access is required to start a voice session.");
          log.warn("Microphone permission denied after prompt", {}, {
            status: requested.status,
            granted: requested.granted,
            canAskAgain: requested.canAskAgain,
          });
        } else {
          setPermissionError(null);
          log.info("Microphone permission granted after prompt");
        }
      } catch (error) {
        setHasMicPermission(false);
        setPermissionError("Unable to request microphone permission.");
        log.error("Failed to ensure microphone permission", {}, error);
      }
    };

    ensureMicrophonePermission();
  }, []);

  const renderChatSurface =
    selectedChatMode === "voice" ? (
      <VoiceChat
        baseConnectionOptions={baseConnectionOptions}
        hasMicPermission={hasMicPermission}
        permissionError={permissionError}
        selectedVoice={selectedVoice}
        selectedVadMode={selectedVadMode}
        mainPromptAddition={mainPromptAddition}
        retentionRatio={retentionRatio}
        maxConversationTurns={maxConversationTurns}
      />
    ) : (
      <TextChat mainPromptAddition={mainPromptAddition} />
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <HamburgerButton onPress={() => setMenuVisible(true)} />
          <Text style={styles.headerTitle}>✨🕺🏻 Vibemachine</Text>
          <View style={styles.headerSpacer} />
        </View>
        {renderChatSurface}
      </View>
      <HamburgerMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onSelectSection={handleSelectMenuSection}
      />
      <ConfigureVoice
        visible={voiceSheetVisible}
        selectedVoice={selectedVoice}
        onSelectVoice={handleSelectVoice}
        onClose={() => setVoiceSheetVisible(false)}
      />
      <ConfigureVad
        visible={vadSheetVisible}
        selectedMode={selectedVadMode}
        onSelectMode={handleSelectVadMode}
        onClose={() => setVadSheetVisible(false)}
      />
      <ConfigureChatMode
        visible={chatModeSheetVisible}
        selectedMode={selectedChatMode}
        onSelectMode={handleSelectChatMode}
        onClose={() => setChatModeSheetVisible(false)}
      />
      <AdvancedConfigurationSheet
        visible={advancedConfigVisible}
        onClose={() => setAdvancedConfigVisible(false)}
        onConfigureMainPrompt={() => {
          setMainPromptDraft(mainPromptAddition);
          setMainPromptModalVisible(true);
        }}
        onConfigureVad={() => setVadSheetVisible(true)}
        onConfigureContextWindow={() => setContextWindowVisible(true)}
        onConfigureTools={() => setConfigureToolsVisible(true)}
      />
      <ConfigureContextWindow
        visible={contextWindowVisible}
        retentionRatio={retentionRatio}
        maxConversationTurns={maxConversationTurns}
        onRetentionRatioChange={setRetentionRatio}
        onMaxConversationTurnsChange={handleMaxConversationTurnsChange}
        onClose={() => setContextWindowVisible(false)}
      />
      <ConfigureToolsSheet
        visible={configureToolsVisible}
        onClose={() => setConfigureToolsVisible(false)}
      />
      <ConnectorsConfig
        visible={connectorsConfigVisible}
        onClose={() => setConnectorsConfigVisible(false)}
      />
      <ConfigureApiKeyScreen
        visible={apiKeyConfigVisible}
        onClose={() => setApiKeyConfigVisible(false)}
      />
      <ConfigureMainPromptModal
        visible={mainPromptModalVisible}
        value={mainPromptDraft}
        onChange={setMainPromptDraft}
        onClose={() => setMainPromptModalVisible(false)}
        onSave={async () => {
          setMainPromptModalVisible(false);
          const addition = await loadMainPromptAddition();
          setMainPromptAddition(addition);
          setMainPromptDraft(addition);
        }}
      />
      <DeveloperMode
        visible={developerModeVisible}
        onClose={() => setDeveloperModeVisible(false)}
      />
      <OnboardingWizard
        isVisible={onboardingVisible}
        onRequestClose={() => setOnboardingVisible(false)}
        onDismiss={handleOnboardingDismiss}
        onFinish={handleOnboardingFinish}
        renderTrigger={() => null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 24,
    backgroundColor: "#FFFFFF",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonBase: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    minWidth: 220,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  buttonShadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  startButton: {
    backgroundColor: "#E8F5E8",
    borderColor: "#4CAF50",
  },
  startButtonPressed: {
    backgroundColor: "#DDEFD9",
    borderColor: "#4CAF50",
  },
  stopButton: {
    backgroundColor: "#FFE8E8",
    borderColor: "#FF6B6B",
  },
  stopButtonPressed: {
    backgroundColor: "#F9DADA",
    borderColor: "#FF6B6B",
  },
  disabledButton: {
    backgroundColor: "#F5F5F5",
    borderColor: "#CCCCCC",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
  },
  startButtonText: {
    color: "#2E7D32",
  },
  stopButtonText: {
    color: "#D32F2F",
  },
  disabledButtonText: {
    color: "#8E8E93",
  },
});

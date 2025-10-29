import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GDriveConnectorConfigCore } from '../components/settings/GDriveConnectorConfigCore';
import { getApiKey, hasGDriveTokens } from '../lib/secure-storage';
import {
  ConfigureApiKeyActionState,
  ConfigureApiKeyCore,
} from './ConfigureApiKeyCore';

type OnboardingStep = 'intro' | 'apiKey' | 'gdrive' | 'help';
type ApiKeyActionSnapshot = Pick<ConfigureApiKeyActionState, 'canSubmit' | 'isSubmitting' | 'onSubmit'>;

interface OnboardingWizardProps {
  onFinish?: () => void;
  renderTrigger?: (open: () => void) => ReactNode;
  triggerLabel?: string;
  isVisible?: boolean;
  onRequestClose?: () => void;
  onDismiss?: () => void;
}

const HeaderButton = ({
  title,
  onPress,
  disabled,
  emphasis,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  emphasis?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      styles.headerButton,
      pressed && !disabled ? styles.headerButtonPressed : null,
      disabled ? styles.headerButtonDisabled : null,
    ]}
  >
    <Text
      style={[
        styles.headerButtonText,
        emphasis ? styles.headerButtonTextEmphasis : null,
        disabled ? styles.headerButtonTextDisabled : null,
      ]}
    >
      {title}
    </Text>
  </Pressable>
);

const InfoLink = ({ title, url }: { title: string; url: string }) => {
  const handlePress = useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Unable to open link');
      }
    } catch {
      Alert.alert('Unable to open link');
    }
  }, [url]);

  return (
    <Pressable onPress={handlePress}>
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
};

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  renderTrigger,
  triggerLabel = 'Onboarding Wizard',
  isVisible,
  onRequestClose,
  onDismiss,
  onFinish,
}) => {
  const [internalVisible, setInternalVisible] = useState(false);
  const [step, setStep] = useState<OnboardingStep>('intro');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [gdriveConnected, setGdriveConnected] = useState(false);
  const [apiKeyActionState, setApiKeyActionState] = useState<ApiKeyActionSnapshot | null>(null);
  const pendingAdvanceRef = useRef(false);

  const isControlled = typeof isVisible === 'boolean';
  const wizardVisible = isControlled ? Boolean(isVisible) : internalVisible;

  const resetWizardState = useCallback(() => {
    setStep('intro');
    setApiKeySaved(false);
    setApiKeyDirty(false);
    setGdriveConnected(false);
    setApiKeyActionState(null);
    pendingAdvanceRef.current = false;
  }, []);

  const ApiKeyActionBridge: React.FC<{ actionState: ConfigureApiKeyActionState }> = ({
    actionState,
  }) => {
    useEffect(() => {
      setApiKeyDirty(actionState.isDirty);
      if (actionState.isDirty) {
        setApiKeySaved(false);
      }
    }, [actionState.isDirty]);

    useEffect(() => {
      setApiKeyActionState((prev) => {
        if (
          prev &&
          prev.canSubmit === actionState.canSubmit &&
          prev.isSubmitting === actionState.isSubmitting &&
          prev.onSubmit === actionState.onSubmit
        ) {
          return prev;
        }
        return {
          canSubmit: actionState.canSubmit,
          isSubmitting: actionState.isSubmitting,
          onSubmit: actionState.onSubmit,
        };
      });
    }, [actionState.canSubmit, actionState.isSubmitting, actionState.onSubmit]);

    return null;
  };

  const openWizard = useCallback(() => {
    if (!isControlled) {
      setInternalVisible(true);
    }
    resetWizardState();
  }, [isControlled, resetWizardState]);

  const closeWizard = useCallback(() => {
    if (isControlled) {
      onRequestClose?.();
    } else {
      setInternalVisible(false);
    }
    resetWizardState();
    onDismiss?.();
  }, [isControlled, onDismiss, onRequestClose, resetWizardState]);

  const preloadState = useCallback(async () => {
    try {
      const [storedKey, hasTokens] = await Promise.all([
        getApiKey({ forceSecureStore: true }),
        hasGDriveTokens(),
      ]);
      setApiKeySaved(Boolean(storedKey));
      setApiKeyDirty(false);
      setGdriveConnected(Boolean(hasTokens));
    } catch {
      setApiKeySaved(false);
      setApiKeyDirty(false);
      setGdriveConnected(false);
    }
  }, []);

  useEffect(() => {
    if (wizardVisible) {
      preloadState();
    }
  }, [wizardVisible, preloadState]);

  const previousVisibleRef = useRef<boolean>(wizardVisible);
  useEffect(() => {
    if (!isControlled) {
      previousVisibleRef.current = wizardVisible;
      return;
    }
    const wasVisible = previousVisibleRef.current;
    if (wizardVisible && !wasVisible) {
      resetWizardState();
    }
    if (!wizardVisible && wasVisible) {
      resetWizardState();
    }
    previousVisibleRef.current = wizardVisible;
  }, [isControlled, resetWizardState, wizardVisible]);

  const canGoNext = useMemo(() => {
    if (step === 'intro') return true;
    if (step === 'apiKey') {
      if (apiKeyActionState?.isSubmitting) return false;
      if (!apiKeyDirty && apiKeySaved) return true;
      return Boolean(apiKeyActionState?.canSubmit);
    }
    if (step === 'gdrive') return gdriveConnected;
    if (step === 'help') return true;
    return false;
  }, [apiKeyActionState, apiKeyDirty, apiKeySaved, gdriveConnected, step]);

  const handleCancel = useCallback(() => {
    closeWizard();
  }, [closeWizard]);

  const handleFinish = useCallback(() => {
    onFinish?.();
    closeWizard();
  }, [closeWizard, onFinish]);

  const handleNext = useCallback(() => {
    if (step === 'intro') {
      setStep('apiKey');
      return;
    }
    if (step === 'apiKey') {
      if (apiKeyDirty) {
        if (
          !apiKeyActionState ||
          apiKeyActionState.isSubmitting ||
          !apiKeyActionState.canSubmit ||
          !apiKeyActionState.onSubmit
        ) {
          return;
        }
        pendingAdvanceRef.current = true;
        void apiKeyActionState
          .onSubmit()
          .then(() => {
            // handled in onSaveSuccess
          })
          .catch(() => {
            pendingAdvanceRef.current = false;
          });
        return;
      }
      if (apiKeySaved) {
        setStep('gdrive');
        return;
      }
      Alert.alert('Add Your API Key', 'Please enter your OpenAI API key before continuing.');
      return;
    }
    if (step === 'gdrive') {
      setStep('help');
      return;
    }
    if (step === 'help') {
      handleFinish();
    }
  }, [apiKeyActionState, apiKeyDirty, apiKeySaved, handleFinish, step]);

  const handleApiKeySaveSuccess = useCallback(() => {
    setApiKeySaved(true);
    setApiKeyDirty(false);
    if (pendingAdvanceRef.current) {
      pendingAdvanceRef.current = false;
      setStep('gdrive');
    }
  }, [setStep]);

  const handleGdriveStatusChange = useCallback((connected: boolean) => {
    setGdriveConnected(connected);
  }, []);

  const renderHeader = () => {
    const title =
      step === 'intro'
        ? '👋 Welcome'
        : step === 'apiKey'
        ? 'Add API Key'
        : step === 'gdrive'
        ? '📂 Connect Google Drive'
        : 'All Set';

    return (
      <View style={styles.header}>
        {step === 'help' ? (
          <View style={styles.headerSpacer} />
        ) : (
          <HeaderButton title="Cancel" onPress={handleCancel} />
        )}
        <Text style={styles.headerTitle}>{title}</Text>
        <HeaderButton
          title={step === 'help' ? 'Finish' : 'Next'}
          onPress={handleNext}
          disabled={!canGoNext}
          emphasis
        />
      </View>
    );
  };

  const renderIntro = () => (
    <ScrollView contentContainerStyle={styles.introContent}>
      <Text style={styles.introHeadline}>Let’s get you ready to vibe.</Text>

      <View style={styles.introRoadmap}>
        <Text style={styles.introStepTitle}>Onboarding is quick and easy</Text>
        <View style={styles.introStepRow}>
          <View style={styles.introStepBadge}>
            <Text style={styles.introStepBadgeText}>1</Text>
          </View>
          <View style={styles.introStepContent}>
            <Text style={styles.introStepLabel}>🔐 Add Your OpenAI API Key</Text>
            <Text style={styles.introStepDescription}>
              Currently requires OpenAI Realtime Speech API.  Future versions will allow self-hosted.
            </Text>
          </View>
        </View>
        <View style={styles.introStepRow}>
          <View style={styles.introStepBadge}>
            <Text style={styles.introStepBadgeText}>2</Text>
          </View>
          <View style={styles.introStepContent}>
            <Text style={styles.introStepLabel}>📂 Connect Google Drive</Text>
            <Text style={styles.introStepDescription}>
              Full access to your Google Drive.  No files or auth keys leave your device.
            </Text>
          </View>
        </View>

        <View style={styles.introStepRow}>
          <View style={styles.introStepBadge}>
            <Text style={styles.introStepBadgeText}>3</Text>
          </View>
          <View style={styles.introStepContent}>
            <Text style={styles.introStepLabel}>🎙️ Access your data via voice</Text>
            <Text style={styles.introStepDescription}>
              Access your data in a natural conversational way.  Switch to text mode in loud environments.
            </Text>
          </View>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={handleNext}
        style={({ pressed }) => [
          styles.introNextPromptButton,
          pressed ? styles.introNextPromptButtonPressed : null,
        ]}
      >
        <Text style={styles.introNextPrompt}>Tap Next to continue</Text>
      </Pressable>
    </ScrollView>
  );

  const renderApiKeyStep = () => (
    <ConfigureApiKeyCore
      isVisible={step === 'apiKey'}
      primaryActionLabel="Save"
      showSuccessAlert={false}
      onSaveSuccess={handleApiKeySaveSuccess}
      renderHeader={() => null}
      renderFooter={(actionState: ConfigureApiKeyActionState) => (
        <ApiKeyActionBridge actionState={actionState} />
      )}
    />
  );

  const renderGdriveStep = () => (
    <GDriveConnectorConfigCore
      isVisible={step === 'gdrive'}
      renderHeader={() => null}
      renderFooter={() => null}
      onConnectionStatusChange={handleGdriveStatusChange}
      showSuccessAlert={false}
      successAlertMessage=""
    />
  );

  const renderHelpStep = () => (
    <ScrollView contentContainerStyle={styles.helpContent}>
      <Text style={styles.helpHeadline}>Onboarding complete! 🙌</Text>
      <Text style={styles.helpBody}>How to get started:</Text>

      <View style={styles.helpStepsCard}>
        <View style={styles.helpStepRow}>
          <View style={styles.introStepBadge}>
            <Text style={styles.introStepBadgeText}>1</Text>
          </View>
          <View style={styles.helpStepContent}>
            <Text style={styles.helpStepLabel}>🎙️ Start a voice chat</Text>
            <Text style={styles.helpStepDescription}>
              Tap Start Voice Mode to jump into a hands-free session.
            </Text>
          </View>
        </View>

        <View style={styles.helpStepDivider} />

        <View style={styles.helpStepRow}>
          <View style={styles.introStepBadge}>
            <Text style={styles.introStepBadgeText}>2</Text>
          </View>
          <View style={styles.helpStepContent}>
            <Text style={styles.helpStepLabel}>🔎 Ask about Drive files</Text>
            <Text style={styles.helpStepDescription}>
              Say things like "Find my project plan" or "Open the meeting notes folder."
            </Text>
          </View>
        </View>

        <View style={styles.helpStepDivider} />

        <View style={styles.helpStepRow}>
          <View style={styles.introStepBadge}>
            <Text style={styles.introStepBadgeText}>3</Text>
          </View>
          <View style={styles.helpStepContent}>
            <Text style={styles.helpStepLabel}>🗣️ Hear quick summaries</Text>
            <Text style={styles.helpStepDescription}>
              Have Vibemachine read or summarize docs so you stay in the flow.
            </Text>
          </View>
        </View>

        <View style={styles.helpStepDivider} />

        <View style={styles.helpStepRow}>
          <View style={styles.introStepBadge}>
            <Text style={styles.introStepBadgeText}>4</Text>
          </View>
          <View style={styles.helpStepContent}>
            <Text style={styles.helpStepLabel}>📝 Create and edit Google Docs</Text>
            <Text style={styles.helpStepDescription}>
              Spin up new docs or update existing ones without leaving the conversation.
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.helpBody}>
        🔇 When you are in a loud environment, open the hamburger menu and choose{' '}
        <Text style={styles.helpBodyEmphasis}>Configure Chat Mode</Text> to switch to text.
      </Text>
      <Text style={styles.helpBody}>
        🔌 Ready for more integrations? Add connectors like GitHub from{' '}
        <Text style={styles.helpBodyEmphasis}>Configure Connectors</Text> whenever you are ready. 🚀
      </Text>
    </ScrollView>
  );

  const renderContent = () => {
    if (step === 'intro') return renderIntro();
    if (step === 'apiKey') return renderApiKeyStep();
    if (step === 'gdrive') return renderGdriveStep();
    return renderHelpStep();
  };

  const triggerNode = renderTrigger ? (
    renderTrigger(openWizard)
  ) : (
    <Pressable
      accessibilityRole="button"
      onPress={openWizard}
      style={({ pressed }) => [
        styles.launchButton,
        pressed ? styles.launchButtonPressed : null,
      ]}
    >
      <Text style={styles.launchButtonText}>{triggerLabel}</Text>
    </Pressable>
  );

  return (
    <>
      {triggerNode}

      <Modal
        visible={wizardVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        supportedOrientations={['portrait']}
        onRequestClose={handleCancel}
      >
        <SafeAreaView style={styles.container}>
          {renderHeader()}
          <View style={styles.content}>{renderContent()}</View>
        </SafeAreaView>
      </Modal>
    </>
  );
};

export default OnboardingWizard;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  content: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D1D6',
  },
  headerSpacer: {
    width: 68,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  headerButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  headerButtonPressed: {
    backgroundColor: 'rgba(0,122,255,0.1)',
  },
  headerButtonDisabled: {
    opacity: 0.5,
  },
  headerButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  headerButtonTextEmphasis: {
    fontWeight: '700',
  },
  headerButtonTextDisabled: {
    color: '#9CA3AF',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D1D1D6',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    backgroundColor: '#005FCC',
  },
  primaryButtonDisabled: {
    backgroundColor: '#D0D4DA',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  linkText: {
    color: '#007AFF',
    textDecorationLine: 'underline',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  introContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },
  introHeadline: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  introBody: {
    fontSize: 16,
    color: '#3A3A3C',
    lineHeight: 22,
    marginBottom: 16,
  },
  introStepTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  introRoadmap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    marginBottom: 32,
  },
  introStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    marginTop: 16,

  },
  introStepBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0A84FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  introStepBadgeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  introStepContent: {
    flex: 1,
  },
  introStepLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  introStepDescription: {
    fontSize: 14,
    color: '#636366',
    lineHeight: 20,
  },
  introStepConnector: {
    alignSelf: 'center',
    width: 2,
    height: 28,
    backgroundColor: '#0A84FF',
    borderRadius: 1,
    marginVertical: 16,
  },
  introNextPromptButton: {
    marginTop: 20,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(10,132,255,0.08)',
  },
  introNextPromptButtonPressed: {
    backgroundColor: 'rgba(10,132,255,0.16)',
  },
  introNextPrompt: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0A84FF',
    textAlign: 'center',
  },
  helpContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },
  helpHeadline: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  helpBody: {
    fontSize: 16,
    color: '#3A3A3C',
    lineHeight: 22,
    marginBottom: 16,
  },
  helpBodyEmphasis: {
    fontWeight: '600',
    color: '#0A84FF',
  },
  helpStepsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    marginBottom: 24,
  },
  helpStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  helpStepContent: {
    flex: 1,
    paddingLeft: 12,
  },
  helpStepLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  helpStepDescription: {
    fontSize: 14,
    color: '#636366',
    lineHeight: 20,
  },
  helpStepDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E5EA',
    marginVertical: 16,
  },
  launchButton: {
    backgroundColor: '#0A84FF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  launchButtonPressed: {
    backgroundColor: '#0060DF',
  },
  launchButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { log } from '../lib/logger';
import { deleteApiKey, getApiKey, isValidApiKey, saveApiKey } from '../lib/secure-storage';

export interface ConfigureApiKeyActionState {
  canSubmit: boolean;
  isSubmitting: boolean;
  isDirty: boolean;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
}

interface ConfigureApiKeyCoreProps {
  isVisible?: boolean;
  renderHeader?: (actionState: ConfigureApiKeyActionState) => React.ReactNode;
  renderFooter?: (actionState: ConfigureApiKeyActionState) => React.ReactNode;
  onSaveSuccess?: (savedKey: string) => void;
  onDeleteSuccess?: () => void;
  onRequestClose?: () => void;
  primaryActionLabel?: string;
  showSuccessAlert?: boolean;
  successAlertMessage?: string;
}

export const ConfigureApiKeyCore: React.FC<ConfigureApiKeyCoreProps> = ({
  isVisible = true,
  renderHeader,
  renderFooter,
  onSaveSuccess,
  onDeleteSuccess,
  onRequestClose,
  primaryActionLabel = 'Save',
  showSuccessAlert = true,
  successAlertMessage = 'API key has been saved securely',
}) => {
  const [apiKey, setApiKey] = useState('');
  const [currentApiKey, setCurrentApiKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);
  const [isShowingAlert, setIsShowingAlert] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [showNewKey, setShowNewKey] = useState(false);

  const resetInputState = useCallback(() => {
    setApiKey('');
    setShowNewKey(false);
  }, []);

  const loadCurrentApiKey = useCallback(async () => {
    try {
      setIsLoading(true);
      log.info('🔄 ConfigureApiKeyCore: Loading current API key...');
      const savedKey = await getApiKey({ forceSecureStore: true });
      setCurrentApiKey(savedKey);
      log.info(
        '🔄 ConfigureApiKeyCore: API key loaded result:',
        {},
        savedKey ? 'exists' : 'not found'
      );
    } catch (error) {
      log.error('❌ ConfigureApiKeyCore: Failed to load current API key:', {}, error);
      Alert.alert('Error', 'Failed to load current API key');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      resetInputState();
      loadCurrentApiKey();
    }
  }, [isVisible, loadCurrentApiKey, resetInputState]);

  useEffect(() => {
    if (!scannerVisible) {
      scanningRef.current = false;
      const t = setTimeout(() => setScanning(false), 150);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [scannerVisible]);

  const showAlert = useCallback(
    (title: string, message: string) => {
      if (isShowingAlert) return;
      setIsShowingAlert(true);
      requestAnimationFrame(() => {
        setTimeout(() => {
          Alert.alert(title, message, [
            {
              text: 'OK',
              onPress: () => {
                setIsShowingAlert(false);
              },
            },
          ]);
        }, 80);
      });
    },
    [isShowingAlert]
  );

  const openScanner = useCallback(async () => {
    try {
      if (!permission || !permission.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          Alert.alert('Permission Required', 'Camera permission is needed to scan a QR code.');
          return;
        }
      }
      scanningRef.current = false;
      setScanning(false);
      setScannerVisible(true);
    } catch {
      Alert.alert('Error', 'Failed to access camera.');
    }
  }, [permission, requestPermission]);

  const getKeySnippet = useCallback((keyValue: string) => {
    if (!keyValue) return '';
    if (keyValue.length <= 10) return keyValue;
    return `${keyValue.slice(0, 4)}...${keyValue.slice(-6)}`;
  }, []);

  const handleBarcodeScanned = useCallback(
    ({ data }: { type: string; data: string }) => {
      if (scanningRef.current) return;
      scanningRef.current = true;
      setScanning(true);
      setScannerVisible(false);

      const candidate = (data || '').trim();
      if (!candidate) {
        showAlert('Scan Failed', 'QR code did not contain text.');
        return;
      }
      const snippet = getKeySnippet(candidate);

      if (!isValidApiKey(candidate)) {
        setApiKey(candidate);
        showAlert(
          'Invalid Key Format',
          `Scanned: ${snippet}\nDoes not look like a valid OpenAI API key. You can edit it manually.`
        );
        return;
      }

      setApiKey(candidate);
      showAlert('Scanned', `Scanned: ${snippet}\nAPI key captured. Review and tap Save.`);
    },
    [getKeySnippet, showAlert]
  );

  const formatApiKeyForDisplay = useCallback((keyValue: string) => {
    if (keyValue.length < 10) return keyValue;
    return `${keyValue.substring(0, 7)}...${keyValue.substring(keyValue.length - 4)}`;
  }, []);

  const handlePasteNewKey = useCallback(async () => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) {
        Alert.alert('Clipboard Empty', 'No text found to paste.');
        return;
      }
      setApiKey(text);
      if (!isValidApiKey(text)) {
        Alert.alert(
          'Pasted Key Notice',
          'Pasted text does not look like a valid OpenAI API key. You can edit it.'
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to read clipboard.');
    }
  }, []);

  const handleCopyNewKey = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(apiKey);
      Alert.alert('Copied', 'New API key text copied to clipboard.');
    } catch {
      Alert.alert('Error', 'Failed to copy key.');
    }
  }, [apiKey]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete API Key',
      'Are you sure you want to delete your saved API key? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteApiKey();
              setCurrentApiKey(null);
              Alert.alert('Success', 'API key has been deleted');
              onDeleteSuccess?.();
            } catch (error) {
              log.error('Failed to delete API key:', {}, error);
              Alert.alert('Error', 'Failed to delete API key. Please try again.');
            }
          },
        },
      ]
    );
  }, [onDeleteSuccess]);

  const handleSave = useCallback(async () => {
    const trimmedKey = apiKey.trim();

    if (!trimmedKey) {
      Alert.alert('Invalid Input', 'Please enter an API key');
      return;
    }

    if (!isValidApiKey(trimmedKey)) {
      Alert.alert(
        'Invalid API Key',
        'Please enter a valid OpenAI API key. It should start with "sk-" and be at least 20 characters long.'
      );
      return;
    }

    try {
      setIsSaving(true);
      await saveApiKey(trimmedKey);

      const verificationKey = await getApiKey({ forceSecureStore: true });
      if (verificationKey) {
        setCurrentApiKey(verificationKey);
        log.info('✅ API key verified after save:', {}, verificationKey ? 'exists' : 'missing');
        onSaveSuccess?.(verificationKey);
      } else {
        log.error('❌ API key verification failed after save');
      }

      resetInputState();

      if (showSuccessAlert) {
        Alert.alert('Success', successAlertMessage, [
          {
            text: 'OK',
            onPress: () => {
              if (onRequestClose) {
                onRequestClose();
              }
            },
          },
        ]);
      } else if (onRequestClose) {
        onRequestClose();
      }
    } catch (error) {
      log.error('Failed to save API key:', {}, error);
      Alert.alert('Error', 'Failed to save API key. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [apiKey, onRequestClose, onSaveSuccess, resetInputState, showSuccessAlert, successAlertMessage]);

  const actionState = useMemo<ConfigureApiKeyActionState>(
    () => ({
      canSubmit: Boolean(apiKey.trim()) && !isSaving,
      isSubmitting: isSaving,
      isDirty: Boolean(apiKey),
      submitLabel: primaryActionLabel,
      onSubmit: handleSave,
      onCancel: onRequestClose,
    }),
    [apiKey, handleSave, isSaving, onRequestClose, primaryActionLabel]
  );

  const visibilityToggleLabel = showNewKey ? 'Hide' : 'Show';
  const scanButtonLabel = scanning ? '📷 Scanning…' : '📷 Scan QR';
  const isScanActionDisabled = scanning || isSaving;

  return (
    <View style={styles.container}>
      {scannerVisible && (
        <View style={styles.scannerOverlay}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            onBarcodeScanned={scanningRef.current ? undefined : handleBarcodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            facing="back"
          />
          <View style={styles.scannerMask}>
            <View style={styles.scanFrame} />
            <Text style={styles.scanInstruction}>
              Align QR code within frame (Simulator camera unavailable)
            </Text>
            <TouchableOpacity
              style={styles.closeScannerButton}
              onPress={() => {
                setScannerVisible(false);
                scanningRef.current = false;
                setScanning(false);
              }}
            >
              <Text style={styles.closeScannerText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {renderHeader?.(actionState)}

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔑 OpenAI API Key</Text>
          <Text style={styles.sectionSubtitle}>
            An OpenAI API key is required. Create one at{' '}
            <Text
              style={styles.sectionSubtitleLink}
              onPress={() => Linking.openURL('https://platform.openai.com/api-keys')}
            >
              https://platform.openai.com/api-keys
            </Text>
            .
          </Text>
        </View>


        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>Add API Key</Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk-..."
            placeholderTextColor="#8E8E93"
            secureTextEntry={!showNewKey}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="default"
            returnKeyType="done"
            onSubmitEditing={handleSave}
            editable={!isSaving}
          />
          <View style={styles.inputActionsRow}>
            <TouchableOpacity
              style={styles.inputActionButton}
              onPress={() => setShowNewKey((value) => !value)}
            >
              <Text style={styles.inputActionButtonText}>{visibilityToggleLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.inputActionButton, !apiKey && styles.inputActionButtonDisabled]}
              disabled={!apiKey}
              onPress={handleCopyNewKey}
            >
              <Text
                style={[
                  styles.inputActionButtonText,
                  !apiKey && styles.inputActionButtonTextDisabled,
                ]}
              >
                Copy
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputActionButton} onPress={handlePasteNewKey}>
              <Text style={styles.inputActionButtonText}>📋 Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.inputActionButton,
                isScanActionDisabled && styles.inputActionButtonDisabled,
              ]}
              onPress={openScanner}
              disabled={isScanActionDisabled}
            >
              <Text
                style={[
                  styles.inputActionButtonText,
                  isScanActionDisabled && styles.inputActionButtonTextDisabled,
                ]}
              >
                {scanButtonLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statusSection}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusTitle}>Current Status</Text>
            {isLoading && <ActivityIndicator size="small" color="#007AFF" />}
          </View>

          {!isLoading && (
            <View
              style={[
                styles.statusCard,
                currentApiKey ? styles.statusCardActive : styles.statusCardInactive,
              ]}
            >
              <Text style={styles.statusLabel}>
                {currentApiKey ? '✅ API Key Configured' : '❌ No API Key'}
              </Text>
              {currentApiKey && (
                <>
                  <Text style={styles.statusValue}>{formatApiKeyForDisplay(currentApiKey)}</Text>
                  <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
                    <Text style={styles.deleteButtonText}>Delete Key</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>

        <View style={styles.securitySection}>
          <Text style={styles.securityTitle}>🔒 Security</Text>
          <Text style={styles.securityText}>
            Your API key is encrypted and stored locally on your device using the secure Keychain. It&apos;s never transmitted to any
            third-party servers except OpenAI&apos;s official APIs.
          </Text>
        </View>

      </ScrollView>

      {renderFooter?.(actionState)}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    lineHeight: 22,
  },
  sectionSubtitleLink: {
    color: '#007AFF',
    fontWeight: '600',
  },
  statusSection: {
    marginBottom: 30,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  statusCardActive: {
    borderLeftColor: '#34C759',
  },
  statusCardInactive: {
    borderLeftColor: '#FF3B30',
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  statusValue: {
    fontSize: 14,
    color: '#8E8E93',
    fontFamily: 'Menlo',
    marginBottom: 12,
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  inputSection: {
    marginBottom: 30,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#000000',
    fontFamily: 'Menlo',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  inputActionsRow: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 8,
  },
  inputActionButton: {
    backgroundColor: '#EFEFF4',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputActionButtonDisabled: {
    opacity: 0.5,
  },
  inputActionButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  inputActionButtonTextDisabled: {
    color: '#8E8E93',
  },
  scannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  scanFrame: {
    width: 260,
    height: 260,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  scanInstruction: {
    marginTop: 24,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  closeScannerButton: {
    position: 'absolute',
    top: 50,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  closeScannerText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  infoSection: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976D2',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#1976D2',
    lineHeight: 20,
    marginBottom: 6,
  },
  securitySection: {
    backgroundColor: '#E8F5E8',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  securityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 8,
  },
  securityText: {
    fontSize: 14,
    color: '#2E7D32',
    lineHeight: 20,
  },
});

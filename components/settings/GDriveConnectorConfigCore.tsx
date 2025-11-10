import * as AuthSession from "expo-auth-session";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  deleteGDriveClientIdOverride,
  getGDriveClientId,
  getGDriveClientIdOverride,
  hasGDriveTokens,
  saveGDriveAccessToken,
  saveGDriveClientIdOverride,
  saveGDriveRefreshToken,
} from "../../lib/secure-storage";
import { revokeGDriveAccess } from "../../modules/vm-webrtc/src/ToolGDriveConnector";

const DEFAULT_CLIENT_ID_HINT =
  process.env.EXPO_PUBLIC_GOOGLE_API_CLIENT_ID || "xxxx-yyyy.apps.googleusercontent.com";

const CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];
const GOOGLE_DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
} as const;

type ButtonCardVariant = "primary" | "destructive" | "secondary";

export interface GDriveConnectorActionState {
  canSubmit: boolean;
  isSubmitting: boolean;
  isDirty: boolean;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
}

export interface GDriveConnectorConfigCoreProps {
  isVisible?: boolean;
  renderHeader?: (state: GDriveConnectorActionState) => React.ReactNode;
  renderFooter?: (state: GDriveConnectorActionState) => React.ReactNode;
  onSaveSuccess?: () => void;
  onRequestClose?: () => void;
  primaryActionLabel?: string;
  showSuccessAlert?: boolean;
  successAlertMessage?: string;
  onConnectionStatusChange?: (connected: boolean) => void;
}

async function signInWithGoogleDrive() {
  const clientId = await getGDriveClientId();
  if (!clientId) {
    throw new Error("Missing Google Client ID. Set EXPO_PUBLIC_GOOGLE_API_CLIENT_ID or provide an override.");
  }

  const core = clientId.endsWith(CLIENT_ID_SUFFIX)
    ? clientId.slice(0, -CLIENT_ID_SUFFIX.length)
    : clientId;
  const nativeRedirect = core ? `com.googleusercontent.apps.${core}:/oauthredirect` : undefined;

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "vibemachine",
    path: "oauthredirect",
    native: nativeRedirect,
  });

  const request = new AuthSession.AuthRequest({
    clientId,
    responseType: AuthSession.ResponseType.Code,
    redirectUri,
    scopes: SCOPES,
    usePKCE: true,
    extraParams: {
      access_type: "offline",
      prompt: "consent",
    },
  });

  await request.makeAuthUrlAsync(GOOGLE_DISCOVERY);

  const result = await request.promptAsync(GOOGLE_DISCOVERY);

  if (result.type !== "success" || !result.params.code) {
    throw new Error("Google sign-in was cancelled or failed.");
  }

  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      code: result.params.code,
      clientId,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier || "" },
    },
    { tokenEndpoint: GOOGLE_DISCOVERY.tokenEndpoint }
  );

  if (tokenResponse.accessToken) {
    await saveGDriveAccessToken(tokenResponse.accessToken);
  }
  if (tokenResponse.refreshToken) {
    await saveGDriveRefreshToken(tokenResponse.refreshToken);
  }

  return {
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
  };
}

const ButtonCard = ({
  title,
  subtitle,
  note,
  variant = "primary",
  disabled,
  icon,
  onPress,
  onLongPress,
  suppressOnPressAfterLongPress = false,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  variant?: ButtonCardVariant;
  disabled?: boolean;
  icon?: string;
  onPress: () => void;
  onLongPress?: () => void;
  suppressOnPressAfterLongPress?: boolean;
}) => {
  const { width: windowWidth } = useWindowDimensions();

  const cardWidth = useMemo(() => {
    const availableWidth = Math.max(windowWidth - 48, 0);
    const preferredWidth = Math.min(availableWidth, 360);
    if (availableWidth <= 240) {
      return availableWidth;
    }
    return Math.max(preferredWidth, 240);
  }, [windowWidth]);

  const baseStyle =
    variant === "destructive"
      ? styles.cardDestructive
      : variant === "secondary"
      ? styles.cardSecondary
      : styles.cardPrimary;

  const longPressFiredRef = useRef(false);

  const handlePress = useCallback(() => {
    if (suppressOnPressAfterLongPress && longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    onPress();
  }, [onPress, suppressOnPressAfterLongPress]);

  const handleLongPress = useCallback(() => {
    longPressFiredRef.current = true;
    onLongPress?.();
  }, [onLongPress]);

  return (
    <View style={styles.actionWrapper}>
      <Pressable
        accessibilityRole="button"
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        disabled={disabled}
        style={({ pressed }) => [
          styles.actionCard,
          baseStyle,
          { width: cardWidth },
          pressed && !disabled ? styles.actionCardPressed : null,
          disabled ? styles.actionCardDisabled : null,
        ]}
      >
        <View style={styles.actionCardRow}>
          {icon ? <Text style={styles.actionIcon}>{icon}</Text> : null}
          <View style={styles.actionTexts}>
            <Text
              style={[
                styles.actionTitle,
                variant === "primary" ? styles.actionTitlePrimary : null,
                variant === "destructive" ? styles.actionTitleDestructive : null,
              ]}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={[
                  styles.actionSubtitle,
                  variant === "primary" ? styles.actionSubtitlePrimary : null,
                  variant === "destructive" ? styles.actionSubtitleDestructive : null,
                ]}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      {note ? (
        <Text style={[styles.buttonNote, { width: cardWidth }]}>{note}</Text>
      ) : null}
    </View>
  );
};

export const GDriveConnectorConfigCore: React.FC<GDriveConnectorConfigCoreProps> = ({
  isVisible = true,
  renderHeader,
  renderFooter,
  onSaveSuccess,
  onRequestClose,
  primaryActionLabel = "Save",
  showSuccessAlert = true,
  successAlertMessage = "Google Client ID override has been updated.",
  onConnectionStatusChange,
}) => {
  const [clientIdOverride, setClientIdOverride] = useState("");
  const [initialClientIdOverride, setInitialClientIdOverride] = useState("");
  const [hasAuthTokens, setHasAuthTokens] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdvancedVisible, setIsAdvancedVisible] = useState(false);

  useEffect(() => {
    if (!isVisible) return;

    const load = async () => {
      try {
        const [override, tokens] = await Promise.all([
          getGDriveClientIdOverride(),
          hasGDriveTokens(),
        ]);
        const overrideValue = override ?? "";
        setClientIdOverride(overrideValue);
        setInitialClientIdOverride(overrideValue);
        setHasAuthTokens(Boolean(tokens));
      } catch {
        // ignore load errors; alerts will surface on interaction
      }
    };

    load();
  }, [isVisible]);

  useEffect(() => {
    onConnectionStatusChange?.(hasAuthTokens);
  }, [hasAuthTokens, onConnectionStatusChange]);

  const handleSave = useCallback(async () => {
    setIsLoading(true);
    try {
      const value = clientIdOverride.trim();
      if (value.length === 0) {
        await deleteGDriveClientIdOverride();
      } else {
        await saveGDriveClientIdOverride(value);
      }
      setInitialClientIdOverride(value);
      Alert.alert("Saved", "Google Client ID override has been updated.", [
        {
          text: "OK",
        },
      ]);
      onSaveSuccess?.();
    } catch {
      Alert.alert("Error", "Failed to save the Client ID override. Try again.");
    } finally {
      setIsLoading(false);
    }
  }, [clientIdOverride, onSaveSuccess]);

  const handleConnect = useCallback(async () => {
    setIsLoading(true);
    try {
      await signInWithGoogleDrive();
      setHasAuthTokens(true);
      Alert.alert("Connected", "Google Drive is now connected.");
    } catch (error: any) {
      Alert.alert("Error", error?.message ?? "Failed to sign in to Google Drive.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    Alert.alert("Disconnect Google Drive", "This will sign you out and clear stored tokens.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          setIsLoading(true);
          try {
            await revokeGDriveAccess();
            setHasAuthTokens(false);
            Alert.alert("Disconnected", "Google Drive access has been revoked.");
          } catch {
            Alert.alert("Error", "Failed to clear tokens. Try again.");
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  }, []);

  const handleDisconnectLongPress = useCallback(async () => {
    try {
      const randomToken = await generateSecureRandomToken();
      await saveGDriveAccessToken(randomToken);
      Alert.alert("access token randomized");
    } catch {
      Alert.alert("Error", "Failed to randomize access token.");
    }
  }, []);


  // Helper to generate a secure random "ya29." token (with 32-byte hex string)
  async function generateSecureRandomToken(): Promise<string> {
    // Use expo-random for cryptographically secure PRNG in React Native/Expo
    // Generates 32 random bytes and encodes as hex
    const { getRandomBytesAsync } = await import('expo-random');
    const bytes = await getRandomBytesAsync(32);
    // Convert bytes to hex string
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `ya29.${hex}`;
  }

  const handleToggleAdvanced = useCallback(() => {
    setIsAdvancedVisible((prev) => !prev);
  }, []);

  const handleCancel = useCallback(() => {
    setClientIdOverride(initialClientIdOverride);
  }, [initialClientIdOverride]);

  const actionState = useMemo<GDriveConnectorActionState>(
    () => ({
      canSubmit: !isLoading,
      isSubmitting: isLoading,
      isDirty: clientIdOverride.trim() !== initialClientIdOverride,
      submitLabel: primaryActionLabel,
      onSubmit: handleSave,
      onCancel: onRequestClose,
    }),
    [clientIdOverride, handleSave, initialClientIdOverride, isLoading, onRequestClose, primaryActionLabel]
  );

  return (
    <View style={styles.wrapper}>
      {renderHeader?.(actionState)}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
        bounces={true}
      >
        {hasAuthTokens ? (
          <View style={styles.statusBannerConnected}>
            <Text style={styles.statusIcon}>✓</Text>
            <Text style={styles.statusTextConnected}>Connected to Google Drive</Text>
          </View>
        ) : (
          <View style={styles.statusBannerDisconnected}>
            <Text style={styles.statusIcon}>•</Text>
            <Text style={styles.statusTextDisconnected}>Status: Not connected yet</Text>
          </View>
        )}

        <View style={styles.actionsGroup}>
          <ButtonCard
            icon="🔗"
            title="Connect with Google Drive"
            note={'⚠️ Tap "Advanced" during Google sign-in and continue despite the unverified app warning.'}
            variant="primary"
            disabled={isLoading || hasAuthTokens}
            onPress={handleConnect}
          />
          <ButtonCard
            icon="🧹"
            title="Disconnect"
            note="Disconnects and clears stored auth tokens."
            variant="destructive"
            disabled={!hasAuthTokens || isLoading}
            onPress={handleDisconnect}
            onLongPress={handleDisconnectLongPress}
            suppressOnPressAfterLongPress
          />
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Security</Text>
          <Text style={styles.infoText}>
            🔒 Your auth tokens will not leave the device, and are stored in Expo Secure Store. On iOS it uses the OS Keychain.
          </Text>
        </View>

        <View style={styles.advancedSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: isAdvancedVisible }}
            onPress={handleToggleAdvanced}
            style={({ pressed }) => [
              styles.advancedHeader,
              pressed ? styles.advancedHeaderPressed : null,
            ]}
          >
            <Text style={styles.advancedTitle}>Advanced Options</Text>
            <Text style={styles.advancedChevron}>{isAdvancedVisible ? "^" : "v"}</Text>
          </Pressable>
          {isAdvancedVisible ? (
            <View style={styles.advancedContent}>
              <Text style={styles.advancedHeading}>Google Drive Connector</Text>
              <Text style={styles.advancedDescription}>You can use your own Client ID for maximum internal control. You will need to confgure it with all required permissions. Documentation still pending.</Text>

              <View style={styles.inputSection}>
                <Text style={styles.label}>Client ID Override</Text>
                <TextInput
                  style={styles.input}
                  value={clientIdOverride}
                  onChangeText={setClientIdOverride}
                  placeholder={DEFAULT_CLIENT_ID_HINT}
                  placeholderTextColor="#C7C7CC"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  keyboardType="default"
                  editable={!isLoading}
                  returnKeyType="done"
                />
                <Text style={styles.hint}>
                  Leave blank to use the default bundled Client ID. Override if you have your own Google
                  OAuth 2.0 client ID you would like to use.
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save Client ID override"
                onPress={handleSave}
                disabled={!actionState.isDirty || isLoading}
                style={({ pressed }) => [
                  styles.saveButton,
                  (!actionState.isDirty || isLoading) && styles.saveButtonDisabled,
                  pressed && actionState.isDirty && !isLoading && styles.saveButtonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.saveButtonText,
                    (!actionState.isDirty || isLoading) && styles.saveButtonTextDisabled,
                  ]}
                >
                  {isLoading ? "Saving..." : "Save Changes"}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel changes"
                onPress={handleCancel}
                disabled={!actionState.isDirty || isLoading}
                style={({ pressed }) => [
                  styles.cancelButton,
                  (!actionState.isDirty || isLoading) && styles.cancelButtonDisabled,
                  pressed && actionState.isDirty && !isLoading && styles.cancelButtonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.cancelButtonText,
                    (!actionState.isDirty || isLoading) && styles.cancelButtonTextDisabled,
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
      {renderFooter?.(actionState)}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: "#F5F5F7",
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 16,
    flexGrow: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
  },
  icon: { fontSize: 28 },
  inputSection: { marginBottom: 20 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#C7C7CC",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#1C1C1E",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  hint: { fontSize: 13, color: "#8E8E93", marginTop: 8 },
  statusBannerConnected: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F5E9",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  statusBannerDisconnected: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F2F2F7",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  statusIcon: { fontSize: 16, marginRight: 8 },
  statusTextConnected: { fontSize: 15, fontWeight: "600", color: "#2E7D32" },
  statusTextDisconnected: { fontSize: 15, fontWeight: "600", color: "#6E6E73" },
  actionsGroup: {
    gap: 12,
    marginTop: 8,
    marginBottom: 14,
    alignItems: "center",
  },
  actionWrapper: {
    width: "100%",
    alignItems: "center",
  },
  actionCard: {
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignSelf: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  actionCardPressed: { opacity: 0.9 },
  actionCardDisabled: { opacity: 0.5 },
  cardPrimary: { backgroundColor: "#0A84FF" },
  cardSecondary: {
    backgroundColor: "#F2F2F7",
    borderColor: "#E5E5EA",
    borderWidth: 1,
  },
  cardDestructive: { backgroundColor: "#FF3B30" },
  actionCardRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  actionIcon: { fontSize: 24 },
  actionTexts: { flexShrink: 1 },
  actionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1C1C1E",
    lineHeight: 24,
  },
  actionTitlePrimary: { color: "#FFFFFF" },
  actionTitleDestructive: { color: "#FFFFFF" },
  actionSubtitle: { fontSize: 14, color: "#6E6E73", marginTop: 4, lineHeight: 20 },
  actionSubtitlePrimary: { color: "#E5F2FF" },
  actionSubtitleDestructive: { color: "#FFE5E5" },
  buttonNote: {
    marginTop: 8,
    color: "#6E6E73",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  infoBox: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16, marginTop: 12 },
  infoTitle: { fontSize: 15, fontWeight: "600", color: "#1C1C1E", marginBottom: 8 },
  infoText: { fontSize: 14, color: "#636366", lineHeight: 20 },
  advancedSection: {
    marginTop: 24,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    overflow: "hidden",
  },
  advancedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "#FFFFFF",
  },
  advancedHeaderPressed: {
    backgroundColor: "#F2F2F7",
  },
  advancedTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  advancedChevron: {
    fontSize: 16,
    color: "#1C1C1E",
  },
  advancedContent: {
    borderTopWidth: 1,
    borderTopColor: "#E5E5EA",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  advancedHeading: { fontSize: 16, fontWeight: "600", color: "#1C1C1E", marginBottom: 6 },
  advancedDescription: {
    fontSize: 14,
    color: "#636366",
    lineHeight: 20,
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: "#0A84FF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  saveButtonPressed: {
    backgroundColor: "#0060DF",
  },
  saveButtonDisabled: {
    backgroundColor: "#E5E5EA",
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  saveButtonTextDisabled: {
    color: "#8E8E93",
  },
  cancelButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  cancelButtonPressed: {
    backgroundColor: "#F2F2F7",
  },
  cancelButtonDisabled: {
    backgroundColor: "#F9F9F9",
    borderColor: "#E5E5EA",
  },
  cancelButtonText: {
    color: "#1C1C1E",
    fontSize: 16,
    fontWeight: "600",
  },
  cancelButtonTextDisabled: {
    color: "#C7C7CC",
  },
});

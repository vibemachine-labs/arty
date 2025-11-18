import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type AppStateStatus,
} from "react-native";
import { MiniVisualizer } from "../components/AudioVisualizer";
import { VoiceSpeedCustomization } from "../components/VoiceSpeedCustomization";
import { loadShowRealtimeErrorAlerts } from "../lib/developerSettings";
import { log } from "../lib/logger";
import { composeMainPrompt } from "../lib/mainPrompt";
import { TokenUsageTracker } from "../lib/tokenUsageTracker";
import type { VadMode } from "../lib/vadPreference";
import { loadTranscriptionPreference } from "../lib/transcriptionPreference";
import toolManager from "../modules/vm-webrtc/src/ToolManager";
import VmWebrtcModule, {
  closeOpenAIConnectionAsync,
  muteUnmuteOutgoingAudio,
  openOpenAIConnectionAsync,
  type AudioMetricsEventPayload,
  type BaseOpenAIConnectionOptions,
  type IdleTimeoutEventPayload,
  type OpenAIConnectionOptions,
  type OpenAIConnectionState,
  type RealtimeErrorEventPayload,
  type TokenUsageEventPayload,
  type TranscriptEventPayload,
  type OutboundAudioStatsEventPayload,
} from "../modules/vm-webrtc";

export type AudioOutput = "handset" | "speakerphone";

const DEFAULT_VOICE_SPEED = 1.0;

type VoiceChatProps = {
  baseConnectionOptions: BaseOpenAIConnectionOptions | null;
  hasMicPermission: boolean;
  permissionError: string | null;
  selectedVoice: string;
  selectedVadMode: VadMode;
  mainPromptAddition: string;
  retentionRatio: number;
  maxConversationTurns: number;
};

export function VoiceChat({
  baseConnectionOptions,
  hasMicPermission,
  permissionError,
  selectedVoice,
  selectedVadMode,
  mainPromptAddition,
  retentionRatio,
  maxConversationTurns,
}: VoiceChatProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [audioOutput, setAudioOutput] = useState<AudioOutput>("handset");
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);
  const [voiceSpeed, setVoiceSpeed] = useState(DEFAULT_VOICE_SPEED);
  const [isMuted, setIsMuted] = useState(false);
  const [isRecordingEnabled, setIsRecordingEnabled] = useState(false);
  const tokenUsageTracker = useRef(new TokenUsageTracker("gpt-realtime"));
  const [sessionCostUsd, setSessionCostUsd] = useState(0);
  const [frequencyBins, setFrequencyBins] = useState<number[]>([]);

  useEffect(() => {
    if (!VmWebrtcModule?.addListener) {
      return undefined;
    }

    const subscription = VmWebrtcModule.addListener(
      "onIdleTimeout",
      (payload: IdleTimeoutEventPayload) => {
        log.warn("Voice session ended due to inactivity", {}, payload);
        Alert.alert("Session Ended", "Disconnected due to inactivity.");
        setIsSessionActive(false);
        setIsStopping(false);
        setIsConnecting(false);
        setFrequencyBins([]);
      }
    );

    return () => {
      subscription.remove?.();
    };
  }, [setIsConnecting, setIsSessionActive, setIsStopping]);

  useEffect(() => {
    if (!VmWebrtcModule?.addListener) {
      return undefined;
    }

    const subscription = VmWebrtcModule.addListener(
      "onTokenUsage",
      (payload: TokenUsageEventPayload) => {
        const totals = tokenUsageTracker.current.addUsage({
          inputText: payload.inputText ?? 0,
          inputAudio: payload.inputAudio ?? 0,
          outputText: payload.outputText ?? 0,
          outputAudio: payload.outputAudio ?? 0,
          cachedInput: payload.cachedInput ?? 0,
        });

        log.info("💵 Token usage event", {}, {
          event: payload,
          totals,
        });
        setSessionCostUsd(totals.totalUSD);
      }
    );

    return () => {
      subscription.remove?.();
    };
  }, []);

  useEffect(() => {
    if (!VmWebrtcModule?.addListener) {
      return undefined;
    }

    const subscription = VmWebrtcModule.addListener(
      "onRealtimeError",
      async (payload: RealtimeErrorEventPayload) => {
        log.error("Realtime voice session error", {}, {
          errorType: payload?.error?.type,
          errorCode: payload?.error?.code,
          errorMessage: payload?.error?.message,
          errorEventId: payload?.error?.event_id,
          fullPayload: payload,
        });
        const message =
          typeof payload?.error?.message === "string" && payload.error.message.trim().length > 0
            ? payload.error.message.trim()
            : "The voice session encountered an unexpected error.";

        // Only show alert if developer setting is enabled
        const shouldShowAlert = await loadShowRealtimeErrorAlerts();
        if (shouldShowAlert) {
          Alert.alert("Session Error", message);
        }
      }
    );

    return () => {
      subscription.remove?.();
    };
  }, []);

  useEffect(() => {
    if (!VmWebrtcModule?.addListener) {
      return undefined;
    }

    const subscription = VmWebrtcModule.addListener(
      "onAudioMetrics",
      (payload: AudioMetricsEventPayload) => {
        // Convert dB bins to 0..1 range for visualizer
        if (Array.isArray(payload.fftBins)) {
          const normalized = (payload.fftBins as number[]).map((db) => {
            // Map dB range: -120 dB (silence) to +30 dB (very loud) → 0..1
            // Expanded upper range so normal speech doesn't max out
            const clamped = Math.max(-120, Math.min(30, db));
            const normalized = (clamped + 120) / 150; // -120..30 → 0..1
            // Apply power curve to compress loud sounds (1.5 makes it less sensitive)
            return Math.pow(normalized, 1.5);
          });
          setFrequencyBins(normalized);
        }
      }
    );

    return () => {
      subscription.remove?.();
    };
  }, []);

  useEffect(() => {
    if (!VmWebrtcModule?.addListener) {
      return undefined;
    }

    const subscription = VmWebrtcModule.addListener(
      "onTranscript",
      (payload: TranscriptEventPayload) => {
        if (payload.isDone && payload.transcript) {
          // Log complete transcript
          log.info("Model response transcript", {}, {
            transcript: payload.transcript,
            type: payload.type,
            transcriptLength: payload.transcript.length,
            responseId: payload.responseId,
            itemId: payload.itemId,
          });
        } else if (payload.delta) {
          // Log transcript delta for debugging
          log.debug("Model response transcript delta", {}, {
            type: payload.type,
            delta: payload.delta,
            responseId: payload.responseId,
          });
        }
      }
    );

    return () => {
      subscription.remove?.();
    };
  }, []);

  useEffect(() => {
    if (!VmWebrtcModule?.addListener) {
      return undefined;
    }

    const subscription = VmWebrtcModule.addListener(
      "onOutboundAudioStats",
      (payload: OutboundAudioStatsEventPayload) => {
        log.debug("Outbound audio stats", {}, {
          localSpeaking: payload.localSpeaking,
          audioLevel: payload.audioLevel,
          energyDelta: payload.energyDelta,
          samplesDelta: payload.samplesDelta,
          totalAudioEnergy: payload.totalAudioEnergy,
          totalSamplesSent: payload.totalSamplesSent,
          trackIdentifier: payload.trackIdentifier,
          statsId: payload.statsId,
          timestampUs: payload.timestampUs,
        });
      }
    );

    return () => {
      subscription.remove?.();
    };
  }, []);

  // Monitor app state changes to log background behavior during active sessions
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState: AppStateStatus) => {
      log.info("App state changed", {}, {
        newState: nextAppState,
        isSessionActive,
        platform: Platform.OS,
      });

      if (nextAppState === "background" && isSessionActive) {
        log.info("App moved to background during active voice session", {}, {
          note: "Background audio mode enabled, session should continue",
        });
      } else if (nextAppState === "active" && isSessionActive) {
        log.info("App returned to foreground with active voice session", {});
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isSessionActive]);

  const handleStartVoiceSession = useCallback(async () => {
    if (isSessionActive || isConnecting) {
      log.debug("Start voice session pressed while busy", {}, {
        isSessionActive,
        isConnecting,
      });
      return;
    }

    if (Platform.OS !== "ios") {
      log.warn("Attempted to start a voice session on an unsupported platform", {}, { platform: Platform.OS });
      Alert.alert("VmWebrtc", "Voice sessions are currently limited to iOS.");
      return;
    }

    if (!hasMicPermission) {
      log.error("Microphone permission missing. Aborting voice session.", {});
      Alert.alert("VmWebrtc", "Please enable microphone access to start a voice session.");
      return;
    }

    if (!baseConnectionOptions) {
      log.error("Missing OpenAI connection options. API key must be configured before connecting.", {});
      Alert.alert("VmWebrtc", "Missing EXPO_PUBLIC_OPENAI_API_KEY environment variable.");
      return;
    }

    try {
      // Reset token usage tracker for new session
      tokenUsageTracker.current.reset();

      const canonicalToolDefinitions = toolManager.getCanonicalToolDefinitions();
      const voiceToolNames = toolManager.getToolNames(canonicalToolDefinitions);

      const resolvedPrompt = composeMainPrompt(mainPromptAddition);

      // Load transcription preference from storage
      const transcriptionEnabled = await loadTranscriptionPreference();

      log.info("Starting OpenAI voice session", {}, {
        hasBaseUrl: Boolean(baseConnectionOptions.baseUrl),
        hasModel: Boolean(baseConnectionOptions.model),
        audioOutput,
        voice: selectedVoice,
        hasInstructions: resolvedPrompt.trim().length > 0,
        hasCustomAddition: mainPromptAddition.trim().length > 0,
        toolNames: voiceToolNames,
        transcriptionEnabled,
      });
      setIsConnecting(true);
      setIsSessionActive(false);
      setSessionCostUsd(0);
      const customConnectionOptions: OpenAIConnectionOptions = {
        ...baseConnectionOptions,
        voice: selectedVoice,
        audioOutput,
        instructions: resolvedPrompt,
        vadMode: selectedVadMode,
        audioSpeed: voiceSpeed,
        enableRecording: isRecordingEnabled,
        maxConversationTurns,
        retentionRatio,
        transcriptionEnabled,
        toolDefinitions: canonicalToolDefinitions,
      };

      // Retry logic with exponential backoff for 503 errors
      const maxRetries = 3;
      const retryDelays = [1000, 3000, 5000]; // 1s, 3s, 5s in milliseconds
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          log.info("Attempting to connect to OpenAI", {}, { attempt: attempt + 1, maxRetries });
          const state: OpenAIConnectionState = await openOpenAIConnectionAsync(customConnectionOptions);
          log.info("OpenAI voice session resolved", {}, { state, attempt: attempt + 1 });
          const connected = state === "connected" || state === "completed";
          setIsSessionActive(connected);
          if (!connected) {
            log.warn("Voice session resolved without reaching a connected state", {}, { state });
            setFrequencyBins([]);
          }
          // Success - break out of retry loop
          lastError = null;
          break;
        } catch (error) {
          lastError = error as Error;
          const is503Error = error instanceof Error && error.message.includes("503");

          if (is503Error && attempt < maxRetries - 1) {
            const delay = retryDelays[attempt];
            log.warn("OpenAI connection failed with 503, retrying", {}, {
              attempt: attempt + 1,
              maxRetries,
              retryDelayMs: delay,
              errorMessage: lastError.message,
            });
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            // Either not a 503 error, or we've exhausted all retries
            log.error("OpenAI connection attempt failed", {}, {
              attempt: attempt + 1,
              maxRetries,
              is503Error,
              errorMessage: lastError.message,
            });
            throw error;
          }
        }
      }

      // If we still have an error after all retries, throw it
      if (lastError) {
        throw lastError;
      }
    } catch (error) {
      log.error("Failed to start OpenAI voice session", {}, {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      }, error);
      const message = error instanceof Error ? error.message : "Unexpected error";
      Alert.alert("VmWebrtc", message);
      setIsSessionActive(false);
      setFrequencyBins([]);
    } finally {
      log.debug("OpenAI voice session connect flow finished", {});
      setIsConnecting(false);
    }
  }, [
    audioOutput,
    baseConnectionOptions,
    hasMicPermission,
    isConnecting,
    isSessionActive,
    mainPromptAddition,
    selectedVoice,
    selectedVadMode,
    voiceSpeed,
    isRecordingEnabled,
    maxConversationTurns,
    retentionRatio,
  ]);

  const handleStopVoiceSession = useCallback(async () => {
    if (!isSessionActive || isStopping) {
      log.debug("Stop voice session pressed without an active session", {}, {
        isSessionActive,
        isStopping,
      });
      return;
    }

    setIsStopping(true);

    try {
      const state: OpenAIConnectionState = await closeOpenAIConnectionAsync();
      log.info("OpenAI voice session closed", {}, { state });
      if (state !== "closed") {
        log.warn("Voice session reported a non-closed state after stop", {}, { state });
      }
    } catch (error) {
      log.error("Failed to stop OpenAI voice session", {}, {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      }, error);
      const message = error instanceof Error ? error.message : "Unexpected error";
      Alert.alert("VmWebrtc", message);
    } finally {
      setIsStopping(false);
      setIsSessionActive(false);
      setIsConnecting(false);
      setFrequencyBins([]);
    }
  }, [isSessionActive, isStopping]);

  const handleToggleAdvanced = useCallback(() => {
    setIsAdvancedExpanded((prev) => {
      const next = !prev;
      log.debug("Advanced customization toggled", {}, { isExpanded: next });
      return next;
    });
  }, []);

  const handleToggleSpeakerphone = useCallback((nextValue: boolean) => {
    const next: AudioOutput = nextValue ? "speakerphone" : "handset";
    setAudioOutput(next);
    log.info("Audio output preference updated", {}, { value: next });
  }, []);

  const handleToggleMute = useCallback((nextValue: boolean) => {
    setIsMuted(nextValue);
    muteUnmuteOutgoingAudio(nextValue);
    log.info("Microphone mute status updated", {}, { muted: nextValue });
  }, []);

  const handleToggleRecording = useCallback((nextValue: boolean) => {
    setIsRecordingEnabled(nextValue);
    log.info("Recording preference updated", {}, { enabled: nextValue });
  }, []);

  const handleVoiceSpeedChange = useCallback((value: number) => {
    if (value !== DEFAULT_VOICE_SPEED) {
      setVoiceSpeed(DEFAULT_VOICE_SPEED);
    }
  }, []);

  const handleVoiceSpeedCommit = useCallback((value: number) => {
    if (value === DEFAULT_VOICE_SPEED) {
      return;
    }

    log.info("Voice speed adjustment attempted but not supported yet", {}, {
      attempted: Number(value.toFixed(2)),
    });
    Alert.alert(
      "Voice Speed Coming Soon",
      "Voice speed adjustments aren't available yet. We'll enable this once OpenAI's realtime API fully supports it."
    );
    setVoiceSpeed(DEFAULT_VOICE_SPEED);
  }, []);

  const isSpeakerphone = audioOutput === "speakerphone";

  const isSessionButtonDisabled = useMemo(
    () => (isSessionActive ? isStopping : isConnecting || !hasMicPermission),
    [isConnecting, isSessionActive, isStopping, hasMicPermission],
  );

  const sessionButtonLabel = useMemo(() => {
    if (isStopping) {
      return "Stopping…";
    }
    if (isConnecting) {
      return "Connecting…";
    }
    return isSessionActive ? "⏹️ Stop Chatting" : "🎙️ Start Chatting";
  }, [isConnecting, isSessionActive, isStopping]);

  const sessionButtonAccessibilityLabel = useMemo(() => {
    if (isSessionActive) {
      return isStopping ? "Stopping chat" : "Stop chatting";
    }
    return isConnecting ? "Connecting chat" : "Start chatting";
  }, [isConnecting, isSessionActive, isStopping]);

  const sessionButtonTextStyles = useMemo(() => {
    const base = [styles.buttonText, isSessionActive ? styles.stopButtonText : styles.startButtonText];
    if (isSessionButtonDisabled) {
      base.push(styles.disabledButtonText);
    }
    return base;
  }, [isSessionActive, isSessionButtonDisabled]);

  const formattedSessionCost = useMemo(() => {
    const roundedUp = Math.ceil(sessionCostUsd * 100) / 100;
    return roundedUp.toFixed(2);
  }, [sessionCostUsd]);

  const shouldShowSessionCost = useMemo(() => {
    return isSessionActive || sessionCostUsd > 0;
  }, [isSessionActive, sessionCostUsd]);

  return (
    <View style={styles.content}>
      {/* Audio Visualizer */}
      <View style={styles.visualizerContainer}>
        <MiniVisualizer
          active={isSessionActive || frequencyBins.length > 0}
          mode="user"
          barCount={8}
          height={80}
          mirror={false}
          gap={6}
          radius={4}
          smooth={0.75}
          samples={frequencyBins}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sessionButtonAccessibilityLabel}
        style={({ pressed }) => {
          const baseStyles: any[] = [styles.buttonBase];

          if (isSessionActive) {
            baseStyles.push(styles.stopButton);
          } else {
            baseStyles.push(styles.startButton);
          }

          if (isSessionButtonDisabled) {
            baseStyles.push(styles.disabledButton);
          } else {
            baseStyles.push(styles.buttonShadow);
            if (pressed) {
              baseStyles.push(isSessionActive ? styles.stopButtonPressed : styles.startButtonPressed);
            }
          }

          return baseStyles;
        }}
        onPress={isSessionActive ? handleStopVoiceSession : handleStartVoiceSession}
        disabled={isSessionButtonDisabled}
      >
        <Text style={sessionButtonTextStyles}>{sessionButtonLabel}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle advanced customization"
        onPress={handleToggleAdvanced}
        style={({ pressed }) => [styles.advancedToggle, pressed && styles.advancedTogglePressed]}
      >
        <Text style={styles.advancedToggleText}>Advanced</Text>
        <Text style={styles.advancedToggleChevron}>{isAdvancedExpanded ? "⌃" : "⌄"}</Text>
      </Pressable>

      {isAdvancedExpanded ? (
        <View style={styles.advancedPanel}>
          <View style={styles.advancedRow}>
            <View style={styles.advancedRowCopy}>
              <Text style={styles.advancedRowLabel}>Speaker Mode</Text>
            </View>
            <View style={styles.advancedRowControl}>
              <Text style={styles.advancedRowIcon}>{isSpeakerphone ? "🔊" : "🔈"}</Text>
              <Switch
                accessibilityLabel="Toggle speakerphone output"
                value={isSpeakerphone}
                onValueChange={handleToggleSpeakerphone}
                ios_backgroundColor="#D1D1D6"
                trackColor={{ false: "#D1D1D6", true: "#34C759" }}
              />
            </View>
          </View>
          <View style={styles.advancedRow}>
            <View style={styles.advancedRowCopy}>
              <Text style={styles.advancedRowLabel}>Mute</Text>
            </View>
            <View style={styles.advancedRowControl}>
              <Text style={styles.advancedRowIcon}>{isMuted ? "🔇" : "🎤"}</Text>
              <Switch
                accessibilityLabel="Toggle microphone mute"
                value={isMuted}
                onValueChange={handleToggleMute}
                ios_backgroundColor="#D1D1D6"
                trackColor={{ false: "#D1D1D6", true: "#34C759" }}
              />
            </View>
          </View>
          <View style={styles.advancedRow}>
            <View style={styles.advancedRowCopy}>
              <Text style={styles.advancedRowLabel}>Record Voice Session</Text>
              <Text style={styles.advancedRowSubtitle}>Recordings available in settings / developer</Text>
            </View>
            <View style={styles.advancedRowControl}>
              <Text style={styles.advancedRowIcon}>📼</Text>
              <Switch
                accessibilityLabel="Toggle voice session recording"
                value={isRecordingEnabled}
                onValueChange={handleToggleRecording}
                ios_backgroundColor="#D1D1D6"
                trackColor={{ false: "#D1D1D6", true: "#34C759" }}
              />
            </View>
          </View>
          {/* Voice Speed - Hidden until fully functional */}
          {false && (
            <VoiceSpeedCustomization
              voiceSpeed={voiceSpeed}
              onVoiceSpeedChange={handleVoiceSpeedChange}
              onVoiceSpeedCommit={handleVoiceSpeedCommit}
            />
          )}
        </View>
      ) : null}

      {!hasMicPermission && permissionError ? (
        <Text style={styles.permissionWarning}>{permissionError}</Text>
      ) : null}

      {shouldShowSessionCost ? (
        <View pointerEvents="none" style={styles.sessionCostContainer}>
          <Text style={styles.sessionCostText}>{`💸 $${formattedSessionCost}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default VoiceChat;

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  visualizerContainer: {
    width: "85%",
    maxWidth: 280,
    marginBottom: 40,
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
    // Increase tap target ~25% for Start state only
    paddingVertical: 18,
    paddingHorizontal: 30,
    minWidth: 275,
    minHeight: 55,
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
    // Make Start CTA a bit bolder
    fontWeight: "700",
  },
  stopButtonText: {
    color: "#D32F2F",
  },
  disabledButtonText: {
    color: "#8E8E93",
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    backgroundColor: "#F8F8F8",
    marginTop: 32,
  },
  advancedTogglePressed: {
    backgroundColor: "#EFEFF4",
  },
  advancedToggleText: {
    // De-emphasize secondary control per HIG
    fontSize: 15,
    fontWeight: "500",
    color: "#1C1C1E",
    opacity: 0.7,
  },
  advancedToggleChevron: {
    fontSize: 18,
    color: "#8E8E93",
  },
  advancedPanel: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    backgroundColor: "#FFFFFF",
    gap: 16,
    alignItems: "flex-start",
  },
  advancedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  advancedRowCopy: {
    flex: 1,
  },
  advancedRowLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1C1C1E",
  },
  advancedRowSubtitle: {
    fontSize: 12,
    color: "#8E8E93",
    marginTop: 2,
  },
  advancedRowControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  advancedRowIcon: {
    fontSize: 20,
  },
  permissionWarning: {
    marginTop: 12,
    color: "#D0021B",
    fontSize: 14,
    textAlign: "center",
  },
  sessionCostContainer: {
    position: "absolute",
    bottom: 32,
    left: 16,
    right: 16,
    alignItems: "center",
  },
  sessionCostText: {
    fontSize: 24,
    fontWeight: "600",
    color: "#1C1C1E",
    textAlign: "center",
  },
});

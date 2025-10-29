import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { Audio } from "expo-av";
import * as Sharing from "expo-sharing";

import { log } from "../../lib/logger";

export interface RecordingScreenProps {
  visible: boolean;
  onClose: () => void;
}

interface RecordingItem {
  id: string;
  name: string;
  uri: string;
  size: number | null;
  createdAt?: number;
}

const RECORDINGS_DIRECTORY = `${
  FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""
}voice_session_recordings`;

export const RecordingScreen: React.FC<RecordingScreenProps> = ({ visible, onClose }) => {
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentRecordingId, setCurrentRecordingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const stopPlayback = useCallback(async () => {
    const activeSound = soundRef.current;
    soundRef.current = null;

    if (!activeSound) {
      setCurrentRecordingId(null);
      return;
    }

    try {
      const status = await activeSound.getStatusAsync();
      if (status.isLoaded) {
        if (status.isPlaying) {
          await activeSound.stopAsync();
        }
        await activeSound.unloadAsync();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not loaded")) {
        log.error("RecordingScreen: Failed to stop playback", {}, error);
      }
    } finally {
      setCurrentRecordingId(null);
    }
  }, []);

  const loadRecordings = useCallback(async () => {
    setIsLoading(true);
    try {
      const info = await FileSystem.getInfoAsync(RECORDINGS_DIRECTORY);
      if (!info.exists) {
        setRecordings([]);
        return;
      }

      const entries = await FileSystem.readDirectoryAsync(RECORDINGS_DIRECTORY);
      const items = await Promise.all(
        entries.map(async (entry) => {
          const path = `${RECORDINGS_DIRECTORY}/${entry}`;
          try {
            const fileInfo = await FileSystem.getInfoAsync(path);
            if (!fileInfo.exists) {
              return null;
            }
            return {
              id: path,
              name: entry,
              uri: fileInfo.uri,
              size: fileInfo.size ?? null,
              createdAt: fileInfo.modificationTime,
            } as RecordingItem;
          } catch (error) {
            log.error("RecordingScreen: Failed to get file info", {}, error);
            return null;
          }
        })
      );

      const validItems = items.filter((item): item is RecordingItem => item !== null);
      validItems.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setRecordings(validItems);
    } catch (error) {
      log.error("RecordingScreen: Failed to load recordings", {}, error);
      Alert.alert("Error", "Failed to load recordings from local storage.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      void loadRecordings();
      // Configure audio mode to play through speaker
      void Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
      });
    } else {
      void stopPlayback();
    }

    return () => {
      void stopPlayback();
    };
  }, [loadRecordings, stopPlayback, visible]);

  const handlePlayRecording = useCallback(
    async (item: RecordingItem) => {
      try {
        if (currentRecordingId === item.id) {
          await stopPlayback();
          return;
        }

        await stopPlayback();

        // Ensure audio plays through speaker, not earpiece
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
        });

        const { sound } = await Audio.Sound.createAsync(
          { uri: item.uri },
          { shouldPlay: true },
          (status) => {
            if (!status.isLoaded) {
              if (status.error) {
                log.error("RecordingScreen: Playback error", {}, status.error);
              }
              void stopPlayback();
              return;
            }

            if (status.didJustFinish) {
              void stopPlayback();
            }
          }
        );
        soundRef.current = sound;
        setCurrentRecordingId(item.id);

        log.info("Started playing recording", {}, { name: item.name });
      } catch (error) {
        log.error("RecordingScreen: Failed to play recording", {}, error);
        Alert.alert("Playback Error", "Unable to play this recording.");
        await stopPlayback();
      }
    },
    [currentRecordingId, stopPlayback]
  );

  const handleShareRecording = useCallback(async (item: RecordingItem) => {
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Share Not Available", "Sharing is not available on this device.");
        return;
      }

      await Sharing.shareAsync(item.uri, {
        mimeType: "audio/m4a",
        dialogTitle: "Share Recording",
        UTI: "public.audio",
      });

      log.info("Recording shared", {}, { name: item.name });
    } catch (error) {
      log.error("RecordingScreen: Failed to share recording", {}, error);
      Alert.alert("Share Error", "Unable to share this recording.");
    }
  }, []);

  const formatSize = (size: number | null) => {
    if (size === null) return "Unknown size";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return "Unknown date";
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  };

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void loadRecordings();
  }, [loadRecordings]);

  const renderItem = ({ item }: { item: RecordingItem }) => (
    <View style={styles.recordingItem}>
      <TouchableOpacity
        style={styles.recordingInfo}
        onPress={() => void handleShareRecording(item)}
        accessibilityRole="button"
        accessibilityLabel={`Share recording ${item.name}`}
      >
        <Text style={styles.recordingName}>{item.name}</Text>
        <Text style={styles.recordingMeta}>
          {formatSize(item.size)} • {formatDate(item.createdAt)}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.playButton}
        onPress={() => void handlePlayRecording(item)}
        accessibilityRole="button"
        accessibilityLabel={currentRecordingId === item.id ? "Stop playback" : "Play recording"}
      >
        <Text
          style={[
            styles.playIndicator,
            currentRecordingId === item.id && styles.playIndicatorActive,
          ]}
        >
          {currentRecordingId === item.id ? "⏹" : "▶"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      supportedOrientations={["portrait"]}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Close recordings"
          >
            <Text style={styles.headerButtonText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Voice Session Recordings</Text>
          <TouchableOpacity
            onPress={handleRefresh}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Refresh recordings list"
          >
            <Text style={styles.headerButtonText}>
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Loading recordings…</Text>
            </View>
          ) : recordings.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎧</Text>
              <Text style={styles.emptyTitle}>No recordings yet</Text>
              <Text style={styles.emptySubtitle}>
                Once you enable local recording, voice session audio files will appear here.
              </Text>
            </View>
          ) : (
            <FlatList
              data={recordings}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

export default RecordingScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 17,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#C6C6C8",
  },
  headerButton: {
    minWidth: 60,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  headerButtonText: {
    fontSize: 16,
    color: "#007AFF",
    fontWeight: "500",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: "#000000",
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666666",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    textAlign: "center",
    color: "#8E8E93",
  },
  listContent: {
    paddingVertical: 12,
  },
  recordingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#FFFFFF",
    gap: 12,
  },
  recordingInfo: {
    flex: 1,
  },
  recordingName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 4,
  },
  recordingMeta: {
    fontSize: 14,
    color: "#8E8E93",
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F2F2F7",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  playIndicator: {
    fontSize: 20,
    color: "#007AFF",
  },
  playIndicatorActive: {
    color: "#FF3B30",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E0E0E0",
    marginLeft: 20,
  },
});

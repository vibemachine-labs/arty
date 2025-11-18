import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import VmWebrtcModule from '../modules/vm-webrtc';

export type VoiceSessionStatusEvent = {
  status_update: string;
};

export default function VoiceSessionStatus() {
  const [statusUpdate, setStatusUpdate] = useState<string>('');

  useEffect(() => {
    if (!VmWebrtcModule?.addListener) {
      return undefined;
    }

    const subscription = VmWebrtcModule.addListener(
      'onVoiceSessionStatus',
      (payload: VoiceSessionStatusEvent) => {
        setStatusUpdate(payload.status_update);
      }
    );

    return () => {
      subscription.remove?.();
    };
  }, []);

  if (!statusUpdate) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>{statusUpdate}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
  },
});

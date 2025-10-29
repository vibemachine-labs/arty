import React, { useCallback } from 'react';
import { Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  ConfigureApiKeyActionState,
  ConfigureApiKeyCore,
} from './ConfigureApiKeyCore';

interface ConfigureApiKeyScreenProps {
  visible: boolean;
  onClose: () => void;
}

export const ConfigureApiKeyScreen: React.FC<ConfigureApiKeyScreenProps> = ({
  visible,
  onClose,
}) => {
  const renderHeader = useCallback(
    (actionState: ConfigureApiKeyActionState) => (
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.headerButton}>
          <Text style={styles.cancelButton}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Configure API Key</Text>
        <TouchableOpacity
          onPress={actionState.onSubmit}
          style={[
            styles.headerButton,
            (!actionState.canSubmit || actionState.isSubmitting) && styles.disabledButton,
          ]}
          disabled={!actionState.canSubmit || actionState.isSubmitting}
        >
          <Text
            style={[
              styles.saveButton,
              (!actionState.canSubmit || actionState.isSubmitting) && styles.disabledButtonText,
            ]}
          >
            {actionState.isSubmitting ? 'Saving...' : actionState.submitLabel}
          </Text>
        </TouchableOpacity>
      </View>
    ),
    [onClose]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      supportedOrientations={['portrait']}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <ConfigureApiKeyCore
          isVisible={visible}
          onRequestClose={onClose}
          renderHeader={renderHeader}
          primaryActionLabel="Save"
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 17,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  headerButton: {
    minWidth: 60,
    minHeight: 44,
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
    flex: 1,
  },
  cancelButton: {
    fontSize: 17,
    color: '#007AFF',
    fontWeight: '400',
  },
  saveButton: {
    fontSize: 17,
    color: '#007AFF',
    fontWeight: '600',
    textAlign: 'right',
  },
  disabledButton: {
    opacity: 0.5,
  },
  disabledButtonText: {
    color: '#8E8E93',
  },
});

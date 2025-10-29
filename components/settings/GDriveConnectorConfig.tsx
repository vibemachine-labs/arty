import React, { useCallback } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GDriveConnectorActionState,
  GDriveConnectorConfigCore,
} from "./GDriveConnectorConfigCore";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSave?: () => void;
};

const HeaderAction = ({
  title,
  disabled,
  emphasis = false,
  onPress,
}: {
  title: string;
  disabled?: boolean;
  emphasis?: boolean;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      styles.headerAction,
      pressed && !disabled ? styles.headerActionPressed : null,
    ]}
  >
    <Text
      style={[
        styles.headerActionText,
        emphasis ? styles.saveText : null,
        disabled ? styles.disabledText : null,
      ]}
    >
      {title}
    </Text>
  </Pressable>
);

export const GDriveConnectorConfig: React.FC<Props> = ({ visible, onClose, onSave }) => {
  const insets = useSafeAreaInsets();

  const handleRequestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSaveSuccess = useCallback(() => {
    onSave?.();
  }, [onSave]);

  const renderHeader = useCallback(
    (actionState: GDriveConnectorActionState) => (
      <View style={styles.header}>
        <View style={styles.headerAction} />
        <Text style={styles.headerTitle}>Google Drive</Text>
        <HeaderAction
          title="Done"
          onPress={handleRequestClose}
          disabled={actionState.isSubmitting}
          emphasis
        />
      </View>
    ),
    [handleRequestClose]
  );

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={handleRequestClose}
      supportedOrientations={["portrait"]}
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.keyboardAvoider}
          keyboardVerticalOffset={insets.top}
        >
          <GDriveConnectorConfigCore
            isVisible={visible}
            onRequestClose={handleRequestClose}
            onSaveSuccess={handleSaveSuccess}
            renderHeader={renderHeader}
            primaryActionLabel="Save"
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#F5F5F7" },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
    backgroundColor: "#FFFFFF",
  },
  headerAction: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    minWidth: 60,
  },
  headerActionPressed: { backgroundColor: "rgba(10, 132, 255, 0.08)" },
  headerActionText: { color: "#0A84FF", fontSize: 16, fontWeight: "600" },
  saveText: { fontWeight: "700" },
  disabledText: { color: "#C7C7CC" },
  headerTitle: { fontSize: 16, fontWeight: "600", color: "#1C1C1E" },
});

export default GDriveConnectorConfig;

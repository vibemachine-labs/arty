import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

export interface HamburgerButtonProps {
  onPress: () => void;
  accessibilityLabel?: string;
}

export const HamburgerButton: React.FC<HamburgerButtonProps> = ({
  onPress,
  accessibilityLabel = "Open settings",
}) => {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <View style={styles.bar} />
      <View style={styles.bar} />
      <View style={styles.bar} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F2F2F7",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  buttonPressed: {
    backgroundColor: "#E5E5EA",
  },
  bar: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#1C1C1E",
    marginVertical: 2,
  },
});

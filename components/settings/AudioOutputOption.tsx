import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export interface AudioOutputOptionProps {
  label: string;
  value: string;
  selected: boolean;
  onSelect: (value: string) => void;
  description?: string;
}

export const AudioOutputOption: React.FC<AudioOutputOptionProps> = ({
  label,
  value,
  selected,
  onSelect,
  description,
}) => {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.option, selected && styles.optionSelected]}
      onPress={() => onSelect(value)}
    >
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.label}>{label}</Text>
        {description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    backgroundColor: "#FFFFFF",
    marginBottom: 12,
  },
  optionSelected: {
    borderColor: "#0A84FF",
    backgroundColor: "#F0F6FF",
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#C7C7CC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  radioOuterSelected: {
    borderColor: "#0A84FF",
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#0A84FF",
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  description: {
    marginTop: 4,
    fontSize: 14,
    color: "#6C6C70",
  },
});

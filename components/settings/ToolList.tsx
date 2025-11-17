import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

export interface Tool {
  name: string;
  description: string;
  group: string;
}

export interface ToolListProps {
  tools: Tool[];
  groupName: string;
  onToolPress: (tool: Tool) => void;
  onBack: () => void;
}

export const ToolList: React.FC<ToolListProps> = ({
  tools,
  groupName,
  onToolPress,
  onBack,
}) => {
  const handleToolPress = (tool: Tool) => {
    onToolPress(tool);
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back to tool groups"
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          pressed ? styles.backButtonPressed : null,
        ]}
      >
        <Text style={styles.backIcon}>‹</Text>
        <Text style={styles.backText}>Tool Groups</Text>
      </Pressable>

      <Text style={styles.lead}>
        Configure individual tools in the {groupName} group. Tap a tool to
        customize its prompt.
      </Text>

      <View style={styles.toolList}>
        {tools.map((tool, index) => (
          <Pressable
            key={`${tool.group}-${tool.name}-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Configure ${tool.name}`}
            onPress={() => handleToolPress(tool)}
            style={({ pressed }) => [
              styles.toolButton,
              pressed ? styles.toolButtonPressed : null,
            ]}
          >
            <View style={styles.toolInfo}>
              <Text style={styles.toolName}>{tool.name}</Text>
              <Text style={styles.toolDescription} numberOfLines={2}>
                {tool.description}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingBottom: 16,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backIcon: {
    fontSize: 24,
    color: "#0A84FF",
    marginRight: 4,
  },
  backText: {
    fontSize: 16,
    color: "#0A84FF",
    fontWeight: "600",
  },
  lead: {
    fontSize: 15,
    lineHeight: 20,
    color: "#3A3A3C",
  },
  toolList: {
    gap: 12,
  },
  toolButton: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D1D1D6",
  },
  toolButtonPressed: {
    backgroundColor: "#F2F2F7",
  },
  toolInfo: {
    flex: 1,
    gap: 4,
    marginRight: 12,
  },
  toolName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  toolDescription: {
    fontSize: 14,
    color: "#8E8E93",
    lineHeight: 18,
  },
  chevron: {
    fontSize: 18,
    color: "#8E8E93",
  },
});

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export interface ToolGroup {
  id: string;
  name: string;
  icon: string;
  backgroundColor: string;
  iconBackgroundColor: string;
  toolCount: number;
  isRemoteMcp: boolean;
}

export interface ToolGroupListProps {
  toolGroups: ToolGroup[];
  onToolGroupPress: (groupId: string) => void;
}

export const ToolGroupList: React.FC<ToolGroupListProps> = ({
  toolGroups,
  onToolGroupPress,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.lead}>
        Choose a tool group to configure its tools. Each tool group contains one
        or more tools that enhance the assistant's capabilities.
      </Text>
      <View style={styles.groupList}>
        {toolGroups.map((group) => (
          <Pressable
            key={group.id}
            accessibilityRole="button"
            accessibilityLabel={`View ${group.name} tools`}
            onPress={() => onToolGroupPress(group.id)}
            style={({ pressed }) => [
              styles.groupButton,
              { backgroundColor: group.backgroundColor },
              pressed ? styles.groupButtonPressed : null,
            ]}
          >
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: group.iconBackgroundColor },
              ]}
            >
              <Text style={styles.icon}>{group.icon}</Text>
            </View>
            <View style={styles.groupInfo}>
              <Text style={styles.groupName}>{group.name}</Text>
              <Text style={styles.toolCount}>
                {group.isRemoteMcp
                  ? "Remote MCP Server"
                  : `${group.toolCount} ${group.toolCount === 1 ? "tool" : "tools"}`}
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
  lead: {
    fontSize: 15,
    lineHeight: 20,
    color: "#3A3A3C",
  },
  groupList: {
    gap: 12,
  },
  groupButton: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D1D1D6",
  },
  groupButtonPressed: {
    opacity: 0.7,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  icon: {
    fontSize: 22,
  },
  groupInfo: {
    flex: 1,
    gap: 2,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  toolCount: {
    fontSize: 13,
    color: "#8E8E93",
  },
  chevron: {
    fontSize: 18,
    color: "#8E8E93",
    marginLeft: 12,
  },
});

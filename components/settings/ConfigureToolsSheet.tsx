import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { BottomSheet } from "../ui/BottomSheet";
import { ConfigurePromptModal } from "./ConfigurePromptModal";
import { LanguageLessonConfigModal } from "./LanguageLessonConfigModal";
import { ToolGroupList, type ToolGroup } from "./ToolGroupList";
import { ToolList, type Tool } from "./ToolList";
import { CONNECTOR_OPTIONS, type ConnectorOption } from "./connectorOptions";
import {
  loadToolPromptAddition,
  saveToolPromptAddition,
} from "../../lib/toolPrompts";
import toolkitGroupsData from "../../modules/vm-webrtc/toolkits/toolkitGroups.json";
import { getMcpToolsForGroup } from "../../modules/vm-webrtc/src/ToolkitManager";

export interface ConfigureToolsSheetProps {
  visible: boolean;
  onClose: () => void;
}

type ViewMode = "groups" | "tools";

type GroupDisplayOption = Pick<
  ConnectorOption,
  "name" | "icon" | "backgroundColor" | "iconBackgroundColor"
>;

const DEFAULT_GROUP_OPTION: GroupDisplayOption = {
  name: "",
  icon: "🛠️",
  backgroundColor: "#F5F5F7",
  iconBackgroundColor: "#ECECF0",
};

const GROUP_OPTION_OVERRIDES: Record<string, Partial<GroupDisplayOption>> = {
  language_lesson: {
    name: "Language Lesson",
    icon: "🧠",
    backgroundColor: "#ECF6FF",
    iconBackgroundColor: "#D7EAFF",
  },
};

function humanizeGroupName(groupId: string): string {
  return groupId
    .split("_")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export const ConfigureToolsSheet: React.FC<ConfigureToolsSheetProps> = ({
  visible,
  onClose,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>("groups");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [promptModalVisible, setPromptModalVisible] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [isGroupPrompt, setIsGroupPrompt] = useState(false);
  const [languageLessonConfigVisible, setLanguageLessonConfigVisible] =
    useState(false);

  // Build tool groups from toolkitGroups.json
  const toolGroups = useMemo(() => {
    const groups: ToolGroup[] = [];
    const toolkitGroups = toolkitGroupsData.byName;

    Object.keys(toolkitGroups).forEach((groupKey) => {
      const group = toolkitGroups[groupKey as keyof typeof toolkitGroups];
      const connectorOption = CONNECTOR_OPTIONS.find(
        (opt) => opt.id === groupKey,
      );
      const overrideOption = GROUP_OPTION_OVERRIDES[groupKey] || {};
      const mergedOption: GroupDisplayOption = {
        ...DEFAULT_GROUP_OPTION,
        ...connectorOption,
        ...overrideOption,
      };

      const toolkits = group.toolkits || [];
      const isRemoteMcp = toolkits.some(
        (t: any) => t.type === "remote_mcp_server",
      );

      groups.push({
        id: groupKey,
        name:
          mergedOption.name && mergedOption.name.length > 0
            ? mergedOption.name
            : humanizeGroupName(groupKey),
        icon: mergedOption.icon,
        backgroundColor: mergedOption.backgroundColor,
        iconBackgroundColor: mergedOption.iconBackgroundColor,
        toolCount: isRemoteMcp ? 0 : toolkits.length,
        isRemoteMcp,
      });
    });

    return groups;
  }, []);

  // Get tools for selected group (static tools from JSON)
  const staticToolsForSelectedGroup = useMemo(() => {
    if (!selectedGroupId) {
      return [];
    }

    const toolkitGroups = toolkitGroupsData.byName;
    const group = toolkitGroups[selectedGroupId as keyof typeof toolkitGroups];

    if (!group || !group.toolkits) {
      return [];
    }

    const tools: Tool[] = [];
    group.toolkits.forEach((toolkit: any) => {
      if (toolkit.type === "function") {
        tools.push({
          name: toolkit.name,
          description: toolkit.description || "",
          group: toolkit.group || selectedGroupId,
        });
      }
    });

    return tools;
  }, [selectedGroupId]);

  // State for MCP tools (loaded dynamically)
  const [mcpTools, setMcpTools] = useState<Tool[]>([]);
  const [loadingMcpTools, setLoadingMcpTools] = useState(false);

  // Load MCP tools when group is selected
  React.useEffect(() => {
    if (!selectedGroupId) {
      setMcpTools([]);
      return;
    }

    const group = toolGroups.find((g) => g.id === selectedGroupId);
    if (!group?.isRemoteMcp) {
      setMcpTools([]);
      return;
    }

    // Load MCP tools
    setLoadingMcpTools(true);
    getMcpToolsForGroup(selectedGroupId)
      .then((tools) => {
        setMcpTools(
          tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            group: selectedGroupId,
          })),
        );
      })
      .catch((error) => {
        console.error("Failed to load MCP tools:", error);
        setMcpTools([]);
      })
      .finally(() => {
        setLoadingMcpTools(false);
      });
  }, [selectedGroupId, toolGroups]);

  // Combine static and MCP tools
  const toolsForSelectedGroup = useMemo(() => {
    return [...staticToolsForSelectedGroup, ...mcpTools];
  }, [staticToolsForSelectedGroup, mcpTools]);

  const selectedGroupName = useMemo(() => {
    const group = toolGroups.find((g) => g.id === selectedGroupId);
    return group?.name || "";
  }, [selectedGroupId, toolGroups]);

  const handleToolGroupPress = async (groupId: string) => {
    const group = toolGroups.find((g) => g.id === groupId);

    if (!group) {
      return;
    }

    setSelectedGroupId(groupId);
    setViewMode("tools");
  };

  const handleBackToGroups = () => {
    setViewMode("groups");
    setSelectedGroupId(null);
  };

  const handleToolPress = (tool: Tool) => {
    if (
      tool.group === "language_lesson" &&
      tool.name === "get_next_language_exercise"
    ) {
      onClose();
      requestAnimationFrame(() => {
        setLanguageLessonConfigVisible(true);
      });
      return;
    }

    onClose();
    requestAnimationFrame(() => {
      setActiveTool(tool);
      setIsGroupPrompt(false);
      setPromptModalVisible(true);
    });
  };

  const handleCustomizeGroupPrompt = () => {
    if (!selectedGroupId) return;

    onClose();
    requestAnimationFrame(() => {
      // Create a pseudo-tool to represent the group
      setActiveTool({
        name: selectedGroupId,
        description: "",
        group: selectedGroupId,
      });
      setIsGroupPrompt(true);
      setPromptModalVisible(true);
    });
  };

  const closePromptModal = useCallback(() => {
    setPromptModalVisible(false);
    setActiveTool(null);
  }, []);

  const getPromptKey = useCallback(() => {
    if (!activeTool) return "";
    return isGroupPrompt
      ? `_group_.${activeTool.group}`
      : `${activeTool.group}.${activeTool.name}`;
  }, [activeTool, isGroupPrompt]);

  const activeToolValue = activeTool
    ? (promptDrafts[getPromptKey()] ?? "")
    : "";

  const handleActivePromptChange = useCallback(
    (text: string) => {
      if (!activeTool) {
        return;
      }
      setPromptDrafts((prev) => ({
        ...prev,
        [getPromptKey()]: text,
      }));
    },
    [activeTool, getPromptKey],
  );

  const loadActiveToolPrompt = useCallback(() => {
    if (!activeTool) {
      return Promise.resolve("");
    }
    return loadToolPromptAddition(getPromptKey());
  }, [activeTool, getPromptKey]);

  const saveActiveToolPrompt = useCallback(
    (text: string) => {
      if (!activeTool) {
        return Promise.resolve();
      }
      return saveToolPromptAddition(getPromptKey(), text);
    },
    [activeTool, getPromptKey],
  );

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title="Configure Tools">
        <View style={styles.body}>
          {viewMode === "groups" ? (
            <ToolGroupList
              toolGroups={toolGroups}
              onToolGroupPress={handleToolGroupPress}
            />
          ) : (
            <ToolList
              tools={toolsForSelectedGroup}
              groupName={selectedGroupName}
              onToolPress={handleToolPress}
              onBack={handleBackToGroups}
              onCustomizeGroupPrompt={handleCustomizeGroupPrompt}
              loading={loadingMcpTools}
            />
          )}
        </View>
      </BottomSheet>

      {activeTool ? (
        <ConfigurePromptModal
          visible={promptModalVisible}
          value={activeToolValue}
          onChange={handleActivePromptChange}
          onClose={closePromptModal}
          onSaveSuccess={() => {
            setPromptDrafts((prev) => ({
              ...prev,
              [getPromptKey()]: activeToolValue.trim(),
            }));
            closePromptModal();
          }}
          loadPromptAddition={loadActiveToolPrompt}
          savePromptAddition={saveActiveToolPrompt}
          basePrompt={activeTool.description.trim()}
          title={
            isGroupPrompt
              ? `Customize ${selectedGroupName} Group`
              : `Configure ${activeTool.name}`
          }
        />
      ) : null}

      <LanguageLessonConfigModal
        visible={languageLessonConfigVisible}
        onClose={() => setLanguageLessonConfigVisible(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: 16,
    paddingBottom: 16,
  },
});

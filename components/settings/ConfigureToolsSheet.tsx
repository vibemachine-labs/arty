import React, { useCallback, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { BottomSheet } from "../ui/BottomSheet";
import { ConfigurePromptModal } from "./ConfigurePromptModal";
import { ToolGroupList, type ToolGroup } from "./ToolGroupList";
import { ToolList, type Tool } from "./ToolList";
import {
  CONNECTOR_OPTIONS,
  type ConnectorId,
  type ConnectorOption,
} from "./connectorOptions";
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

export const ConfigureToolsSheet: React.FC<ConfigureToolsSheetProps> = ({
  visible,
  onClose,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>("groups");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [promptModalVisible, setPromptModalVisible] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});

  // Build tool groups from toolkitGroups.json
  const toolGroups = useMemo(() => {
    const groups: ToolGroup[] = [];
    const toolkitGroups = toolkitGroupsData.byName;

    Object.keys(toolkitGroups).forEach((groupKey) => {
      const group = toolkitGroups[groupKey as keyof typeof toolkitGroups];
      const connectorOption = CONNECTOR_OPTIONS.find((opt) => opt.id === groupKey as ConnectorId);

      if (!connectorOption) {
        return;
      }

      const toolkits = group.toolkits || [];
      const isRemoteMcp = toolkits.some((t: any) => t.type === "remote_mcp_server");

      groups.push({
        id: groupKey,
        name: connectorOption.name,
        icon: connectorOption.icon,
        backgroundColor: connectorOption.backgroundColor,
        iconBackgroundColor: connectorOption.iconBackgroundColor,
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
          }))
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
    onClose();
    requestAnimationFrame(() => {
      setActiveTool(tool);
      setPromptModalVisible(true);
    });
  };

  const closePromptModal = useCallback(() => {
    setPromptModalVisible(false);
    setActiveTool(null);
  }, []);

  const activeToolValue = activeTool
    ? promptDrafts[`${activeTool.group}.${activeTool.name}`] ?? ""
    : "";

  const handleActivePromptChange = useCallback(
    (text: string) => {
      if (!activeTool) {
        return;
      }
      setPromptDrafts((prev) => ({
        ...prev,
        [`${activeTool.group}.${activeTool.name}`]: text,
      }));
    },
    [activeTool]
  );

  const loadActiveToolPrompt = useCallback(() => {
    if (!activeTool) {
      return Promise.resolve("");
    }
    return loadToolPromptAddition(`${activeTool.group}.${activeTool.name}`);
  }, [activeTool]);

  const saveActiveToolPrompt = useCallback(
    (text: string) => {
      if (!activeTool) {
        return Promise.resolve();
      }
      return saveToolPromptAddition(`${activeTool.group}.${activeTool.name}`, text);
    },
    [activeTool]
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
              [`${activeTool.group}.${activeTool.name}`]: activeToolValue.trim(),
            }));
            closePromptModal();
          }}
          loadPromptAddition={loadActiveToolPrompt}
          savePromptAddition={saveActiveToolPrompt}
          basePrompt={activeTool.description.trim()}
          title={`Configure ${activeTool.name}`}
        />
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: 16,
    paddingBottom: 16,
  },
});

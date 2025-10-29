import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "../ui/BottomSheet";
import { ConfigurePromptModal } from "./ConfigurePromptModal";
import {
  CONNECTOR_OPTIONS,
  type ConnectorId,
  type ConnectorOption,
} from "./connectorOptions";
import {
  loadToolPromptAddition,
  saveToolPromptAddition,
} from "../../lib/toolPrompts";
import {
  githubConnectorDefinition,
  gdriveConnectorDefinition,
  type ToolDefinition,
} from "../../modules/vm-webrtc";

export interface ConfigureToolsSheetProps {
  visible: boolean;
  onClose: () => void;
}

const SUPPORTED_TOOL_IDS: ConnectorId[] = ["github", "gdrive"];

type SupportedTool = ConnectorOption & {
  definition: ToolDefinition;
};

export const ConfigureToolsSheet: React.FC<ConfigureToolsSheetProps> = ({
  visible,
  onClose,
}) => {
  const [promptModalVisible, setPromptModalVisible] = useState(false);
  const [activeToolId, setActiveToolId] = useState<ConnectorId | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});

  const tools = useMemo(
    () =>
      CONNECTOR_OPTIONS.filter((option: ConnectorOption) =>
        SUPPORTED_TOOL_IDS.includes(option.id),
      ).map((option) => {
        let definition: ToolDefinition | null = null;
        if (option.id === "github") {
          definition = githubConnectorDefinition;
        } else if (option.id === "gdrive") {
          definition = gdriveConnectorDefinition;
        }
        if (!definition) {
          return null;
        }
        return {
          ...option,
          definition,
        } as SupportedTool;
      }).filter((tool): tool is SupportedTool => tool !== null),
    [],
  );

  const handleToolPress = (toolId: ConnectorId) => {
    onClose();
    requestAnimationFrame(() => {
      setActiveToolId(toolId);
      setPromptModalVisible(true);
    });
  };

  const closePromptModal = useCallback(() => {
    setPromptModalVisible(false);
    setActiveToolId(null);
  }, []);

  const activeTool = useMemo(
    () => tools.find((tool) => tool.id === activeToolId) ?? null,
    [activeToolId, tools]
  );

  const activeToolValue = activeTool
    ? promptDrafts[activeTool.id] ?? ""
    : "";

  const handleActivePromptChange = useCallback(
    (text: string) => {
      if (!activeTool) {
        return;
      }
      setPromptDrafts((prev) => ({
        ...prev,
        [activeTool.id]: text,
      }));
    },
    [activeTool]
  );

  const activeToolDefinitionName = activeTool?.definition.name ?? null;

  const loadActiveToolPrompt = useCallback(() => {
    if (!activeToolDefinitionName) {
      return Promise.resolve("");
    }
    return loadToolPromptAddition(activeToolDefinitionName);
  }, [activeToolDefinitionName]);

  const saveActiveToolPrompt = useCallback(
    (text: string) => {
      if (!activeToolDefinitionName) {
        return Promise.resolve();
      }
      return saveToolPromptAddition(activeToolDefinitionName, text);
    },
    [activeToolDefinitionName]
  );

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title="Configure Tools">
        <View style={styles.body}>
          <Text style={styles.lead}>
            Choose a tool to adjust its configuration. Each tool refines how the
            assistant collaborates with your iOS workflow.
          </Text>
          <View style={styles.toolList}>
            {tools.map((tool) => (
              <Pressable
                key={tool.id}
                accessibilityRole="button"
                accessibilityLabel={`Configure ${tool.name}`}
                onPress={() => handleToolPress(tool.id)}
                style={({ pressed }) => [
                  styles.toolButton,
                  { backgroundColor: tool.backgroundColor },
                  pressed ? styles.toolButtonPressed : null,
                ]}
              >
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: tool.iconBackgroundColor },
                  ]}
                >
                  <Text style={styles.icon}>{tool.icon}</Text>
                </View>
                <Text style={styles.toolName}>{tool.name}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
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
              [activeTool.id]: activeToolValue.trim(),
            }));
            closePromptModal();
          }}
          loadPromptAddition={loadActiveToolPrompt}
          savePromptAddition={saveActiveToolPrompt}
          basePrompt={activeTool.definition.description.trim()}
          title={`Configure ${activeTool.name} Prompt`}
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
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#D1D1D6",
  },
  toolButtonPressed: {
    backgroundColor: "#E5F1FF",
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
  toolName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  chevron: {
    fontSize: 18,
    color: "#8E8E93",
    marginLeft: 12,
  },
});

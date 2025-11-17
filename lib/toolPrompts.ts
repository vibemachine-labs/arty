import { DeviceEventEmitter } from "react-native";

import { loadPromptAddition, savePromptAddition } from "./promptStorage";
import { clearToolkitDefinitionsCache } from "../modules/vm-webrtc/src/ToolkitManager";
import { log } from "./logger";

const TOOL_PROMPT_STORAGE_PREFIX = "@vibemachine/toolPrompt/";

export const getToolPromptStorageKey = (toolName: string): string =>
  `${TOOL_PROMPT_STORAGE_PREFIX}${toolName}`;

export const loadToolPromptAddition = (toolName: string): Promise<string> =>
  loadPromptAddition(getToolPromptStorageKey(toolName));

export const saveToolPromptAddition = async (
  toolName: string,
  addition: string
): Promise<void> => {
  await savePromptAddition(getToolPromptStorageKey(toolName), addition);

  log.info('[ToolPrompts] Prompt addition saved, clearing toolkit definitions cache', {}, {
    toolName,
    additionLength: addition.trim().length,
  });

  // Clear toolkit definitions cache to force reload with updated prompts
  // This clears both in-memory cache and disk cache for MCP tools
  await clearToolkitDefinitionsCache();

  log.info('[ToolPrompts] Toolkit definitions cache cleared, prompts will be applied on next load', {}, {
    toolName,
  });
};

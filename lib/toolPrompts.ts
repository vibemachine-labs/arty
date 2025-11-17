import { DeviceEventEmitter } from "react-native";

import { loadPromptAddition, savePromptAddition } from "./promptStorage";
import { clearToolkitDefinitionsCache, getToolkitDefinitions } from "../modules/vm-webrtc/src/ToolkitManager";
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

  log.info('[ToolPrompts] Toolkit definitions cache cleared, rebuilding cache', {}, {
    toolName,
  });

  // Rebuild the cache immediately so the user doesn't wait later when using the LLM
  const startTime = Date.now();
  await getToolkitDefinitions();
  const rebuildDurationMs = Date.now() - startTime;

  log.info('[ToolPrompts] Toolkit definitions cache rebuilt with updated prompts', {}, {
    toolName,
    rebuildDurationMs,
  });
};

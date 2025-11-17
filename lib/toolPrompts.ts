import { DeviceEventEmitter } from "react-native";

import { loadPromptAddition, savePromptAddition } from "./promptStorage";
import { CONNECTOR_SETTINGS_CHANGED_EVENT } from "../modules/vm-webrtc/src/ToolkitManager";

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

  // Emit event to reload toolkit definitions cache
  DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
};

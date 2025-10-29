import { loadPromptAddition, savePromptAddition } from "./promptStorage";

const TOOL_PROMPT_STORAGE_PREFIX = "@vibemachine/toolPrompt/";

export const getToolPromptStorageKey = (toolName: string): string =>
  `${TOOL_PROMPT_STORAGE_PREFIX}${toolName}`;

export const loadToolPromptAddition = (toolName: string): Promise<string> =>
  loadPromptAddition(getToolPromptStorageKey(toolName));

export const saveToolPromptAddition = (
  toolName: string,
  addition: string
): Promise<void> =>
  savePromptAddition(getToolPromptStorageKey(toolName), addition);

import { composePrompt, loadPromptAddition, savePromptAddition } from "./promptStorage";

export const MAIN_PROMPT_STORAGE_KEY = "@vibemachine/mainPrompt";

export const BASE_MAIN_PROMPT = [
  "You are a helpful assistant named Arty, which stands for A RealTime assistant for You (A.R.T.Y).",
  "Greet the user with a friendly tone, and very briefly mention your capabilities. ",
  "When telling the user results from tool calls, mention the tool name if it's available",
  "in the response so the user knows that the information is reliable and up to date.",
].join(" ");

export const composeMainPrompt = (addition: string): string =>
  composePrompt(BASE_MAIN_PROMPT, addition);

export const loadMainPromptAddition = async (): Promise<string> =>
  loadPromptAddition(MAIN_PROMPT_STORAGE_KEY);

export const saveMainPromptAddition = async (addition: string): Promise<void> =>
  savePromptAddition(MAIN_PROMPT_STORAGE_KEY, addition);

export const loadComposedMainPrompt = async (): Promise<string> => {
  const addition = await loadMainPromptAddition();
  return composeMainPrompt(addition);
};

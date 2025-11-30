import AsyncStorage from "@react-native-async-storage/async-storage";

const RETENTION_RATIO_KEY = "@vibemachine/retentionRatio";
const MAX_CONVERSATION_TURNS_KEY = "@vibemachine/maxConversationTurns";

export const DEFAULT_RETENTION_RATIO = 0.8;
export const DEFAULT_MAX_CONVERSATION_TURNS = 10;

export interface ContextWindowPreferences {
  retentionRatio: number;
  maxConversationTurns: number;
}

export const loadRetentionRatio = async (): Promise<number> => {
  try {
    const stored = await AsyncStorage.getItem(RETENTION_RATIO_KEY);
    if (!stored) {
      return DEFAULT_RETENTION_RATIO;
    }
    const parsed = parseFloat(stored);
    if (isNaN(parsed) || parsed < 0.5 || parsed > 1.0) {
      return DEFAULT_RETENTION_RATIO;
    }
    return parsed;
  } catch {
    return DEFAULT_RETENTION_RATIO;
  }
};

export const saveRetentionRatio = async (ratio: number): Promise<void> => {
  try {
    await AsyncStorage.setItem(RETENTION_RATIO_KEY, ratio.toString());
  } catch {
    // Ignore persistence errors for now; UI will fall back to default.
  }
};

export const loadMaxConversationTurns = async (): Promise<number> => {
  try {
    const stored = await AsyncStorage.getItem(MAX_CONVERSATION_TURNS_KEY);
    if (!stored) {
      return DEFAULT_MAX_CONVERSATION_TURNS;
    }
    const parsed = parseInt(stored, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 20) {
      return DEFAULT_MAX_CONVERSATION_TURNS;
    }
    return parsed;
  } catch {
    return DEFAULT_MAX_CONVERSATION_TURNS;
  }
};

export const saveMaxConversationTurns = async (turns: number): Promise<void> => {
  try {
    await AsyncStorage.setItem(MAX_CONVERSATION_TURNS_KEY, turns.toString());
  } catch {
    // Ignore persistence errors for now; UI will fall back to default.
  }
};

export const loadContextWindowPreferences = async (): Promise<ContextWindowPreferences> => {
  const [retentionRatio, maxConversationTurns] = await Promise.all([
    loadRetentionRatio(),
    loadMaxConversationTurns(),
  ]);
  return { retentionRatio, maxConversationTurns };
};

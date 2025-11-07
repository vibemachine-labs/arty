import { requireOptionalNativeModule } from 'expo';

import { log } from '../../../lib/logger';
import { type ToolNativeModule } from './ToolHelper';
import { type ToolDefinition } from './VmWebrtc.types';

const BASE_URL = 'https://hacker-news.firebaseio.com/v0';
const DEFAULT_COUNT = 5;
const MAX_COUNT = 30;

const STORY_ENDPOINTS = {
  hackerNews_topstories: 'topstories',
  hackerNews_beststories: 'beststories',
  hackerNews_newstories: 'newstories',
  hackerNews_showstories: 'showstories',
  hackerNews_askstories: 'askstories',
  hackerNews_jobstories: 'jobstories',
} as const;

export const HACKER_NEWS_TOOL_NAMES = [
  'hackerNews_item',
  'hackerNews_user',
  'hackerNews_topstories',
  'hackerNews_beststories',
  'hackerNews_newstories',
  'hackerNews_showstories',
  'hackerNews_askstories',
  'hackerNews_jobstories',
  'hackerNews_updates',
] as const;

export type HackerNewsToolName = (typeof HACKER_NEWS_TOOL_NAMES)[number];

export const isHackerNewsToolName = (name: string): name is HackerNewsToolName =>
  HACKER_NEWS_TOOL_NAMES.includes(name as HackerNewsToolName);

const baseCountProperty = {
  type: 'integer',
  description: 'Number of stories to fetch (default: 5, max: 30)',
};

const storyToolDescription = (kind: string) =>
  `Fetch ${kind} stories from Hacker News. Results are read-only and include summaries of each item.`;

export const hackerNewsToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    name: 'hackerNews_item',
    description: 'Fetch a Hacker News item by its numeric item_id.',
    parameters: {
      type: 'object',
      properties: {
        item_id: {
          type: 'integer',
          description: 'The item identifier (e.g., 8863).',
        },
      },
      required: ['item_id'],
    },
  },
  {
    type: 'function',
    name: 'hackerNews_user',
    description: 'Fetch a Hacker News user profile by username.',
    parameters: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: "The user handle (e.g., 'pg').",
        },
      },
      required: ['username'],
    },
  },
  ...Object.entries(STORY_ENDPOINTS).map<ToolDefinition>(([name, endpoint]) => ({
    type: 'function',
    name,
    description: storyToolDescription(endpoint.replace('stories', ' stories')),
    parameters: {
      type: 'object',
      properties: {
        count: baseCountProperty,
      },
      required: [],
    },
  })),
  {
    type: 'function',
    name: 'hackerNews_updates',
    description: 'Fetch the most recent Hacker News updates, including items and profile handles.',
    parameters: {
      type: 'object',
      properties: {
        count: baseCountProperty,
      },
      required: [],
    },
  },
];

type StoryEndpointName = keyof typeof STORY_ENDPOINTS;

type StoryListName = (typeof STORY_ENDPOINTS)[StoryEndpointName];

type HackerNewsArguments = Record<string, unknown> | undefined;

type HackerNewsOperationResult =
  | Record<string, unknown>
  | Record<string, unknown>[]
  | { error: string };

export interface HackerNewsNativeModule extends ToolNativeModule {
  hackerNewsOperationFromSwift?(payloadJson: string): Promise<string>;
  sendHackerNewsToolResponse(requestId: string, toolName: string, result: string): void;
}

type HackerNewsToolRequestEvent = {
  requestId: string;
  toolName: HackerNewsToolName;
  arguments?: HackerNewsArguments;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sanitizeCount = (value: unknown): number => {
  const parsed = toNumber(value);
  if (!parsed) {
    return DEFAULT_COUNT;
  }
  return Math.min(Math.max(parsed, 1), MAX_COUNT);
};

const fetchJson = async <T>(endpoint: string): Promise<T> => {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Hacker News request failed (${response.status})`);
  }
  return (await response.json()) as T;
};

const fetchItem = (itemId: number) => fetchJson<Record<string, unknown>>(`/item/${itemId}.json`);

const fetchUser = (username: string) => fetchJson<Record<string, unknown>>(`/user/${username}.json`);

const fetchStoryIds = (list: StoryListName) => fetchJson<number[]>(`/${list}.json`);

const fetchStoryList = async (list: StoryListName, count: number) => {
  const ids = await fetchStoryIds(list);
  const selected = ids.slice(0, count);
  const stories = await Promise.all(selected.map(fetchItem));
  return stories;
};

const fetchUpdates = async (count: number) => {
  const updates = await fetchJson<{ items?: number[]; profiles?: string[] }>('/updates.json');
  const itemIds = Array.isArray(updates.items) ? updates.items : [];
  const profileIds = Array.isArray(updates.profiles) ? updates.profiles : [];
  const items = await Promise.all(itemIds.slice(0, count).map(fetchItem));
  return {
    items,
    profiles: profileIds.slice(0, count),
  };
};

export class ToolHackerNewsSuite {
  private readonly requestEventName = 'onHackerNewsToolRequest';
  private readonly module: HackerNewsNativeModule | null;

  constructor(nativeModule: HackerNewsNativeModule | null) {
    this.module = nativeModule;
    if (!this.module) {
      log.info('[ToolHackerNews] Native module unavailable; suite disabled.', {});
      return;
    }

    this.module.addListener(this.requestEventName, this.handleRequest.bind(this));
    log.info('[ToolHackerNews] Registered native event listener', {});
  }

  private async handleRequest(event: HackerNewsToolRequestEvent) {
    const { requestId, toolName, arguments: args } = event;
    log.info('[ToolHackerNews] 📥 Request from Swift', {}, {
      requestId,
      toolName,
      hasArgs: Boolean(args),
    });

    if (!isHackerNewsToolName(toolName)) {
      const payload = JSON.stringify({ error: `Unsupported tool ${toolName}` });
      this.module?.sendHackerNewsToolResponse(requestId, toolName, payload);
      return;
    }

    try {
      const result = await this.performOperation(toolName, args);
      this.module?.sendHackerNewsToolResponse(requestId, toolName, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('[ToolHackerNews] ❌ Native request failed', {}, {
        requestId,
        toolName,
        errorMessage: message,
      }, error);
      this.module?.sendHackerNewsToolResponse(
        requestId,
        toolName,
        JSON.stringify({ error: message, tool: toolName })
      );
    }
  }

  private async performOperation(
    toolName: HackerNewsToolName,
    rawArgs: HackerNewsArguments
  ): Promise<string> {
    const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
    log.info('[ToolHackerNews] 🔧 performOperation', {}, { toolName });

    let payload: HackerNewsOperationResult;

    switch (toolName) {
      case 'hackerNews_item': {
        const itemId = toNumber(args.item_id);
        if (!itemId) {
          throw new Error('Missing required parameter: item_id');
        }
        const item = await fetchItem(itemId);
        payload = { item };
        break;
      }
      case 'hackerNews_user': {
        const username = typeof args.username === 'string' ? args.username.trim() : '';
        if (!username) {
          throw new Error('Missing required parameter: username');
        }
        const user = await fetchUser(username);
        payload = { user };
        break;
      }
      case 'hackerNews_updates': {
        const count = sanitizeCount(args.count);
        const updates = await fetchUpdates(count);
        payload = {
          requestedCount: count,
          items: updates.items,
          profiles: updates.profiles,
        };
        break;
      }
      default: {
        if (!isHackerNewsToolName(toolName)) {
          payload = { error: `Unsupported tool ${toolName}` };
          break;
        }
        const endpoint = STORY_ENDPOINTS[toolName as StoryEndpointName];
        const count = sanitizeCount(args.count);
        const stories = await fetchStoryList(endpoint, count);
        payload = {
          requestedCount: count,
          retrievedCount: stories.length,
          stories,
          list: endpoint,
        };
        break;
      }
    }

    const response = JSON.stringify({
      tool: toolName,
      fetchedAt: new Date().toISOString(),
      ...payload,
    });

    log.info('[ToolHackerNews] ✅ Operation complete', {}, {
      toolName,
      responseLength: response.length,
    });

    return response;
  }

  async execute(call: { toolName: HackerNewsToolName; args?: Record<string, unknown> }): Promise<string> {
    return this.performOperation(call.toolName, call.args);
  }
}

let sharedInstance: ToolHackerNewsSuite | null = null;

const ensureSharedInstance = (): ToolHackerNewsSuite | null => {
  if (sharedInstance) {
    return sharedInstance;
  }
  const nativeModule = requireOptionalNativeModule<HackerNewsNativeModule>('VmWebrtc');
  if (!nativeModule) {
    log.info('[ToolHackerNews] Native module not available at initialization', {});
    return null;
  }
  sharedInstance = new ToolHackerNewsSuite(nativeModule);
  return sharedInstance;
};

ensureSharedInstance();

export const getSharedHackerNewsTool = (): ToolHackerNewsSuite | null => ensureSharedInstance();

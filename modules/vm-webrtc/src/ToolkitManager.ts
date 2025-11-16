import { Paths, File, Directory } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

import toolkitGroupsData from '../toolkits/toolkitGroups.json';

import type {
  ToolDefinition,
  ToolkitDefinition,
  ToolkitGroup,
  ToolkitGroups,
  RemoteMcpToolkitDefinition,
} from './VmWebrtc.types';
import { exportToolDefinition } from './VmWebrtc.types';
import { MCPClient, type RequestOptions } from './mcp_client/client';
import { log } from '../../../lib/logger';
import type { Tool } from './mcp_client/types';
import { registerMcpTool } from './toolkit_functions/index';

// Mapping from toolkit group names to AsyncStorage connector keys
const TOOLKIT_GROUP_TO_CONNECTOR_KEY: Record<string, string> = {
  'web': 'web_connector_enabled',
  'google_drive': 'gdrive_connector_enabled',
  'hacker_news': 'web_connector_enabled', // Hacker News is part of web toolkit
};

/**
 * Check if a toolkit group is enabled based on stored settings.
 * Returns true by default if no setting is found.
 */
async function isToolkitGroupEnabled(groupName: string): Promise<boolean> {
  const storageKey = TOOLKIT_GROUP_TO_CONNECTOR_KEY[groupName];

  // If no mapping exists, default to enabled
  if (!storageKey) {
    log.debug('[ToolkitManager] No storage key mapping for toolkit group, defaulting to enabled', {}, {
      groupName,
    });
    return true;
  }

  try {
    const enabledValue = await AsyncStorage.getItem(storageKey);
    // Default to true if not set (backward compatibility)
    const isEnabled = enabledValue === null ? true : enabledValue === 'true';

    log.debug('[ToolkitManager] Toolkit group enabled status loaded', {}, {
      groupName,
      storageKey,
      enabledValue,
      isEnabled,
    });

    return isEnabled;
  } catch (error) {
    log.error('[ToolkitManager] Failed to load toolkit group enabled status, defaulting to enabled', {}, {
      groupName,
      storageKey,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : new Error(String(error)));
    return true;
  }
}

const buildToolkitGroups = async (): Promise<ToolkitGroups> => {
  const data = toolkitGroupsData as unknown as ToolkitGroups;
  const byName = data.byName ?? {};
  const allGroups = Array.isArray(data.list) ? data.list : Object.values(byName);

  // Filter groups based on enabled settings
  const enabledGroups: ToolkitGroup[] = [];
  const filteredByName: Record<string, ToolkitGroup> = {};

  for (const group of allGroups) {
    const isEnabled = await isToolkitGroupEnabled(group.name);

    if (isEnabled) {
      log.info('[ToolkitManager] Toolkit group enabled, adding to available groups', {}, {
        groupName: group.name,
        toolkitCount: group.toolkits.length,
      });
      enabledGroups.push(group);
      filteredByName[group.name] = group;
    } else {
      log.debug('[ToolkitManager] Toolkit group disabled, skipping', {}, {
        groupName: group.name,
      });
    }
  }

  return {
    byName: filteredByName,
    list: enabledGroups,
  };
};

// Cache for toolkit groups
let toolkitGroupsCache: ToolkitGroups | null = null;
let toolkitGroupsPromise: Promise<ToolkitGroups> | null = null;

/**
 * Get filtered toolkit groups based on enabled settings.
 * This function caches the result to avoid repeated AsyncStorage reads.
 */
async function getFilteredToolkitGroups(): Promise<ToolkitGroups> {
  // Return cached result if available
  if (toolkitGroupsCache) {
    return toolkitGroupsCache;
  }

  // If a fetch is already in progress, return that promise
  if (toolkitGroupsPromise) {
    return toolkitGroupsPromise;
  }

  // Start fetching and cache the promise
  toolkitGroupsPromise = buildToolkitGroups();

  try {
    const result = await toolkitGroupsPromise;
    toolkitGroupsCache = result;
    return result;
  } finally {
    toolkitGroupsPromise = null;
  }
}

async function buildStaticToolkitDefinitions(): Promise<ToolDefinition[]> {
  const staticTools: ToolDefinition[] = [];
  const groups = await getFilteredToolkitGroups();

  for (const group of groups.list) {
    for (const toolkit of group.toolkits) {
      if (toolkit.type !== 'remote_mcp_server') {
        staticTools.push(exportToolDefinition(toolkit, true));
      }
    }
  }

  return staticTools;
}

// Cache for static toolkit definitions
let staticToolkitDefinitionsCache: ToolDefinition[] | null = null;

// Use a simple subdirectory in the app cache for toolkit caching
const REMOTE_TOOLKIT_CACHE_DIR = new Directory(Paths.cache, 'remote-toolkit-definitions');
const REMOTE_TOOLKIT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REMOTE_TOOLKIT_DISCOVERY_OPTIONS: RequestOptions = { timeout: 30000 };

type RemoteToolkitCacheEntry = {
  lastFetched: number;
  tools: Array<{
    name: string;
    definition: ToolDefinition;
  }>;
};

const dynamicToolkitDefinitionsByServer = new Map<string, ToolDefinition[]>();
const remoteCacheRefreshPromises = new Map<string, Promise<void>>();

/**
 * Get toolkit groups, filtered by enabled settings.
 * This is an async function that loads settings from AsyncStorage.
 */
export const getToolkitGroups = async (): Promise<ToolkitGroups> => {
  return getFilteredToolkitGroups();
};

async function getRemoteToolkitCacheFile(serverUrl: string): Promise<File> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    serverUrl
  );
  const fileName = `${digest}.json`;
  return new File(REMOTE_TOOLKIT_CACHE_DIR, fileName);
}

async function ensureCacheDirectoryExists(): Promise<void> {
  try {
    if (await REMOTE_TOOLKIT_CACHE_DIR.exists) {
      return;
    }

    // Create directory with intermediates to ensure parent directories exist
    await REMOTE_TOOLKIT_CACHE_DIR.create({ intermediates: true, idempotent: true });
    log.debug('[ToolkitManager] Cache directory created successfully', {}, {
      uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
    });
  } catch (error: unknown) {
    log.error('[ToolkitManager] Failed to create cache directory', {}, {
      error: error instanceof Error ? error.message : String(error),
      uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
    }, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

async function readRemoteToolkitCache(serverUrl: string): Promise<RemoteToolkitCacheEntry | null> {
  const cacheFile = await getRemoteToolkitCacheFile(serverUrl);
  try {
    if (!(await cacheFile.exists)) {
      return null;
    }

    const contents = await cacheFile.text();
    const parsed = JSON.parse(contents) as RemoteToolkitCacheEntry;

    // Validate cache structure - lastFetched must be a finite number (including 0), tools must be an array
    if (
      typeof parsed.lastFetched !== 'number' ||
      !Number.isFinite(parsed.lastFetched) ||
      !Array.isArray(parsed.tools)
    ) {
      log.warn('[ToolkitManager] Invalid cache structure, ignoring', {}, {
        serverUrl,
        uri: cacheFile.uri,
        hasLastFetched: typeof parsed.lastFetched,
        isFinite: Number.isFinite(parsed.lastFetched),
        hasTools: Array.isArray(parsed.tools),
      });
      return null;
    }

    return parsed;
  } catch (error: unknown) {
    log.warn('[ToolkitManager] Failed to read toolkit cache file', {}, {
      serverUrl,
      uri: cacheFile.uri,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeRemoteToolkitCache(serverUrl: string, entry: RemoteToolkitCacheEntry): Promise<void> {
  try {
    await ensureCacheDirectoryExists();
    const cacheFile = await getRemoteToolkitCacheFile(serverUrl);

    const cacheContent = JSON.stringify(entry, null, 2);
    await cacheFile.write(cacheContent);

    log.debug('[ToolkitManager] Remote toolkit cache written to disk', {}, {
      serverUrl,
      uri: cacheFile.uri,
      toolCount: entry.tools.length,
      sizeBytes: cacheContent.length,
    });
  } catch (error: unknown) {
    log.error('[ToolkitManager] Failed to write toolkit cache file', {}, {
      serverUrl,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : new Error(String(error)));
    // Don't throw - cache write failures shouldn't break the application
  }
}

async function clearRemoteToolkitCacheFiles(): Promise<void> {
  try {
    if (!(await REMOTE_TOOLKIT_CACHE_DIR.exists)) {
      log.debug('[ToolkitManager] Cache directory does not exist, nothing to clear', {}, {
        uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
      });
      return;
    }

    const entries = await REMOTE_TOOLKIT_CACHE_DIR.list();
    const deletePromises = entries.map(async (entry) => {
      try {
        await entry.delete();
      } catch (err: unknown) {
        log.warn('[ToolkitManager] Failed to delete cache file', {}, {
          uri: entry.uri,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await Promise.all(deletePromises);

    log.debug('[ToolkitManager] Remote toolkit cache directory cleared', {}, {
      uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
      entryCount: entries.length,
    });
  } catch (error: unknown) {
    log.error('[ToolkitManager] Failed to clear remote toolkit cache', {}, {
      uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : new Error(String(error)));
  }
}

// Cache for toolkit definitions to avoid repeated MCP server calls
let toolkitDefinitionsCache: ToolDefinition[] | null = null;
let toolkitDefinitionsPromise: Promise<ToolDefinition[]> | null = null;

/**
 * Convert MCP Tool to ToolDefinition format
 */
function mcpToolToToolDefinition(tool: Tool, groupName: string): ToolDefinition {
  // Convert MCP input schema properties to our format
  const properties: Record<string, { type: string; description: string }> = {};
  const mcpProperties = tool.inputSchema?.properties || {};

  for (const [key, value] of Object.entries(mcpProperties)) {
    properties[key] = {
      type: (value as any)?.type || 'string',
      description: (value as any)?.description || '',
    };
  }

  return {
    type: 'function',
    name: `${groupName}__${tool.name}`,
    description: tool.description || '',
    parameters: {
      type: 'object',
      properties,
      required: tool.inputSchema?.required || [],
    },
  };
}

/**
 * Gets all toolkit definitions and converts them to tool definitions with
 * fully qualified names (group:name format, e.g., "hacker_news:showTopStories").
 *
 * For remote MCP servers, this fetches the actual tools dynamically from the server
 * on the first call, then caches them for subsequent calls.
 */
export const getToolkitDefinitions = async (): Promise<ToolDefinition[]> => {
  // Return cached result if available
  if (toolkitDefinitionsCache) {
    log.info('[ToolkitManager] Returning cached toolkit definitions', {}, {
      count: toolkitDefinitionsCache.length,
    });
    return toolkitDefinitionsCache;
  }

  // If a fetch is already in progress, return that promise
  if (toolkitDefinitionsPromise) {
    log.info('[ToolkitManager] Toolkit definitions fetch already in progress, awaiting...', {}, {});
    return toolkitDefinitionsPromise;
  }

  // Start fetching and cache the promise
  toolkitDefinitionsPromise = fetchToolkitDefinitions();

  try {
    const result = await toolkitDefinitionsPromise;
    toolkitDefinitionsCache = result;
    return result;
  } catch (error) {
    // Reset promise on error so next call can retry
    toolkitDefinitionsPromise = null;
    throw error;
  }
};

/**
 * Internal function that actually fetches toolkit definitions.
 */
async function fetchToolkitDefinitions(): Promise<ToolDefinition[]> {
  dynamicToolkitDefinitionsByServer.clear();

  // Build static toolkit definitions if not cached
  if (!staticToolkitDefinitionsCache) {
    staticToolkitDefinitionsCache = await buildStaticToolkitDefinitions();
  }

  const rawToolkits = await getRawToolkitDefinitions();
  const remoteMcpToolkits = rawToolkits.filter(
    (toolkit): toolkit is RemoteMcpToolkitDefinition => toolkit.type === 'remote_mcp_server'
  );

  let dynamicCount = 0;
  for (const toolkit of remoteMcpToolkits) {
    const definitions = await loadRemoteToolkitDefinitions(toolkit);
    dynamicCount += definitions.length;
  }

  const allTools = rebuildToolkitDefinitionsCache();
  log.info('[ToolkitManager] Total toolkit definitions loaded', {}, {
    staticCount: staticToolkitDefinitionsCache.length,
    dynamicCount,
    totalCount: allTools.length,
  });

  return allTools;
}

function rebuildToolkitDefinitionsCache(): ToolDefinition[] {
  if (!staticToolkitDefinitionsCache) {
    log.warn('[ToolkitManager] Static toolkit definitions not yet loaded, returning empty array', {}, {});
    return [];
  }

  const dynamicDefinitions = Array.from(dynamicToolkitDefinitionsByServer.values()).flat();
  const aggregated = [...staticToolkitDefinitionsCache, ...dynamicDefinitions];
  toolkitDefinitionsCache = aggregated;
  return aggregated;
}

function setDynamicToolkitDefinitionsForServer(serverUrl: string, definitions: ToolDefinition[]): void {
  dynamicToolkitDefinitionsByServer.set(serverUrl, definitions);
  rebuildToolkitDefinitionsCache();
}

function registerMcpToolsForServer(
  toolkitGroup: string,
  serverUrl: string,
  tools: RemoteToolkitCacheEntry['tools'],
  client: MCPClient,
  discoveryOptions: RequestOptions
): void {
  for (const tool of tools) {
    registerMcpTool(toolkitGroup, tool.name, async (args: any) => {
      log.info('[ToolkitManager] Executing cached MCP tool', {}, {
        group: toolkitGroup,
        toolName: tool.name,
        serverUrl,
      });

      const result = await client.callTool({
        name: tool.name,
        arguments: args,
      }, discoveryOptions);

      return JSON.stringify(result, null, 2);
    });
  }
}

function convertToolsForCache(tools: Tool[], groupName: string): RemoteToolkitCacheEntry['tools'] {
  return tools.map((tool) => ({
    name: tool.name,
    definition: mcpToolToToolDefinition(tool, groupName),
  }));
}

async function fetchAndCacheRemoteToolkitDefinitions(
  toolkit: RemoteMcpToolkitDefinition,
  serverUrl: string,
  discoveryOptions: RequestOptions
): Promise<ToolDefinition[]> {
  const client = new MCPClient(serverUrl);

  log.info('[ToolkitManager] Fetching tools from remote MCP server for toolkit definitions', {}, {
    name: toolkit.name,
    group: toolkit.group,
    url: serverUrl,
  });

  const result = await client.listTools(undefined, discoveryOptions);
  if (!result.tools || result.tools.length === 0) {
    log.warn('[ToolkitManager] Remote MCP server returned no tools', {}, {
      name: toolkit.name,
      group: toolkit.group,
      url: serverUrl,
    });
    setDynamicToolkitDefinitionsForServer(serverUrl, []);
    return [];
  }

  const cachedTools = convertToolsForCache(result.tools, toolkit.group);
  registerMcpToolsForServer(toolkit.group, serverUrl, cachedTools, client, discoveryOptions);
  setDynamicToolkitDefinitionsForServer(
    serverUrl,
    cachedTools.map((entry) => entry.definition)
  );

  const cacheEntry: RemoteToolkitCacheEntry = {
    lastFetched: Date.now(),
    tools: cachedTools,
  };

  await writeRemoteToolkitCache(serverUrl, cacheEntry);

  log.info('[ToolkitManager] Successfully loaded and cached MCP tools', {}, {
    group: toolkit.group,
    toolCount: cachedTools.length,
    tools: cachedTools.map((t) => t.definition.name),
  });

  return cachedTools.map((entry) => entry.definition);
}

function scheduleRemoteToolkitRefresh(toolkit: RemoteMcpToolkitDefinition, serverUrl: string): void {
  if (remoteCacheRefreshPromises.has(serverUrl)) {
    log.debug('[ToolkitManager] Remote toolkit cache refresh already scheduled', {}, {
      group: toolkit.group,
      url: serverUrl,
    });
    return;
  }

  log.info('[ToolkitManager] Cache expired, scheduling background refresh', {}, {
    group: toolkit.group,
    url: serverUrl,
    ttlMs: REMOTE_TOOLKIT_CACHE_TTL_MS,
  });

  const refreshPromise = (async () => {
    try {
      const newDefinitions = await fetchAndCacheRemoteToolkitDefinitions(
        toolkit,
        serverUrl,
        REMOTE_TOOLKIT_DISCOVERY_OPTIONS
      );

      log.info('[ToolkitManager] Background cache refresh completed successfully', {}, {
        group: toolkit.group,
        url: serverUrl,
        toolCount: newDefinitions.length,
      });

      // Trigger a rebuild of the toolkit definitions cache with fresh data
      rebuildToolkitDefinitionsCache();
    } catch (error: unknown) {
      log.error('[ToolkitManager] Background cache refresh failed, continuing with stale cache', {}, {
        group: toolkit.group,
        url: serverUrl,
        error: error instanceof Error ? error.message : String(error),
      }, error instanceof Error ? error : new Error(String(error)));
    }
  })();

  remoteCacheRefreshPromises.set(serverUrl, refreshPromise);
  refreshPromise.finally(() => {
    remoteCacheRefreshPromises.delete(serverUrl);
  });
}

async function loadRemoteToolkitDefinitions(toolkit: RemoteMcpToolkitDefinition): Promise<ToolDefinition[]> {
  const serverUrl = toolkit.remote_mcp_server?.url;
  if (!serverUrl) {
    log.warn('[ToolkitManager] Skipping remote MCP toolkit without URL', {}, {
      name: toolkit.name,
      group: toolkit.group,
    });
    return [];
  }

  const cached = await readRemoteToolkitCache(serverUrl);
  const client = new MCPClient(serverUrl);

  if (cached && cached.tools.length > 0) {
    const cacheAgeMs = Date.now() - cached.lastFetched;
    const isCacheStale = cacheAgeMs > REMOTE_TOOLKIT_CACHE_TTL_MS;

    log.debug('[ToolkitManager] Loaded toolkit definitions from disk cache', {}, {
      group: toolkit.group,
      url: serverUrl,
      cacheAgeMs,
      toolCount: cached.tools.length,
      isStale: isCacheStale,
    });

    // Register tools and update cache
    registerMcpToolsForServer(toolkit.group, serverUrl, cached.tools, client, REMOTE_TOOLKIT_DISCOVERY_OPTIONS);
    const definitions = cached.tools.map((entry) => entry.definition);
    setDynamicToolkitDefinitionsForServer(serverUrl, definitions);

    // Schedule background refresh if cache is stale
    if (isCacheStale) {
      scheduleRemoteToolkitRefresh(toolkit, serverUrl);
    }

    return definitions;
  }

  // No valid cache - fetch directly
  log.debug('[ToolkitManager] No valid cache found, fetching from MCP server', {}, {
    group: toolkit.group,
    url: serverUrl,
  });

  try {
    return await fetchAndCacheRemoteToolkitDefinitions(toolkit, serverUrl, REMOTE_TOOLKIT_DISCOVERY_OPTIONS);
  } catch (error: unknown) {
    log.error('[ToolkitManager] Failed to fetch tools from MCP server for toolkit definitions', {}, {
      name: toolkit.name,
      group: toolkit.group,
      url: serverUrl,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}


/**
 * Gets raw toolkit definitions without conversion (for internal use).
 */
export const getRawToolkitDefinitions = async (): Promise<ToolkitDefinition[]> => {
  const groups = await getFilteredToolkitGroups();
  return groups.list.flatMap((group) => group.toolkits);
};

/**
 * Preload toolkit definitions so that remote MCP discovery runs eagerly.
 */
export const preloadToolkitDefinitions = async (): Promise<void> => {
  try {
    log.info('[ToolkitManager] Preloading toolkit definitions cache (fetching remote MCP tools)');
    await getToolkitDefinitions();
    const definitionCount = toolkitDefinitionsCache ? toolkitDefinitionsCache.length : 0;
    log.info('[ToolkitManager] Toolkit definitions preload completed', {}, {
      definitionCount,
      source: 'preload',
    });
  } catch (error) {
    log.error('[ToolkitManager] Preloading toolkit definitions failed', {}, {
      errorMessage: error instanceof Error ? error.message : String(error),
    }, error);
  }
};

/**
 * Clears the toolkit definitions cache, forcing a fresh fetch on next call.
 * Useful for testing or when MCP servers are updated.
 *
 * @returns Promise that resolves when cache files have been cleared
 */
export const clearToolkitDefinitionsCache = async (): Promise<void> => {
  log.info('[ToolkitManager] Clearing toolkit definitions cache', {}, {});

  // Collect all in-flight promises before clearing anything
  const pendingPromises: Promise<any>[] = [];

  // Include the main toolkit definitions fetch if in progress
  if (toolkitDefinitionsPromise) {
    pendingPromises.push(toolkitDefinitionsPromise);
  }

  // Include all background refresh promises
  const pendingRefreshes = Array.from(remoteCacheRefreshPromises.values());
  pendingPromises.push(...pendingRefreshes);

  // Wait for all in-flight promises to settle before clearing cache state
  if (pendingPromises.length > 0) {
    log.debug('[ToolkitManager] Waiting for in-flight promises to complete', {}, {
      count: pendingPromises.length,
      hasMainFetch: toolkitDefinitionsPromise !== null,
      refreshCount: pendingRefreshes.length,
    });
    await Promise.allSettled(pendingPromises);
  }

  // Now it's safe to clear all cache state
  toolkitDefinitionsCache = null;
  toolkitDefinitionsPromise = null;
  toolkitGroupsCache = null;
  staticToolkitDefinitionsCache = null;
  dynamicToolkitDefinitionsByServer.clear();
  remoteCacheRefreshPromises.clear();

  // Clear disk cache files
  await clearRemoteToolkitCacheFiles();

  log.info('[ToolkitManager] Toolkit definitions cache cleared successfully', {}, {});
};

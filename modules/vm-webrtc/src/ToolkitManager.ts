import { Paths, File, Directory } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

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

const buildToolkitGroups = (): ToolkitGroups => {
  const data = toolkitGroupsData as unknown as ToolkitGroups;
  const byName = data.byName ?? {};
  const list = Array.isArray(data.list) ? data.list : Object.values(byName);

  return {
    byName,
    list,
  };
};

const toolkitGroups = buildToolkitGroups();
const staticToolkitDefinitions = buildStaticToolkitDefinitions();

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

export const getToolkitGroups = (): ToolkitGroups => toolkitGroups;

function buildStaticToolkitDefinitions(): ToolDefinition[] {
  const staticTools: ToolDefinition[] = [];

  for (const group of toolkitGroups.list) {
    for (const toolkit of group.toolkits) {
      if (toolkit.type !== 'remote_mcp_server') {
        staticTools.push(exportToolDefinition(toolkit, true));
      }
    }
  }

  return staticTools;
}

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

    // Validate cache structure
    if (!parsed.lastFetched || !Array.isArray(parsed.tools)) {
      log.warn('[ToolkitManager] Invalid cache structure, ignoring', {}, {
        serverUrl,
        uri: cacheFile.uri,
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
  const remoteMcpToolkits = getRawToolkitDefinitions().filter(
    (toolkit): toolkit is RemoteMcpToolkitDefinition => toolkit.type === 'remote_mcp_server'
  );

  let dynamicCount = 0;
  for (const toolkit of remoteMcpToolkits) {
    const definitions = await loadRemoteToolkitDefinitions(toolkit);
    dynamicCount += definitions.length;
  }

  const allTools = rebuildToolkitDefinitionsCache();
  log.info('[ToolkitManager] Total toolkit definitions loaded', {}, {
    staticCount: staticToolkitDefinitions.length,
    dynamicCount,
    totalCount: allTools.length,
  });

  return allTools;
}

function rebuildToolkitDefinitionsCache(): ToolDefinition[] {
  const dynamicDefinitions = Array.from(dynamicToolkitDefinitionsByServer.values()).flat();
  const aggregated = [...staticToolkitDefinitions, ...dynamicDefinitions];
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
export const getRawToolkitDefinitions = (): ToolkitDefinition[] => {
  return toolkitGroups.list.flatMap((group) => group.toolkits);
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

  // Clear in-memory caches
  toolkitDefinitionsCache = null;
  toolkitDefinitionsPromise = null;
  dynamicToolkitDefinitionsByServer.clear();

  // Wait for any in-progress refreshes to complete before clearing
  const pendingRefreshes = Array.from(remoteCacheRefreshPromises.values());
  if (pendingRefreshes.length > 0) {
    log.debug('[ToolkitManager] Waiting for pending cache refreshes to complete', {}, {
      count: pendingRefreshes.length,
    });
    await Promise.allSettled(pendingRefreshes);
  }
  remoteCacheRefreshPromises.clear();

  // Clear disk cache files
  await clearRemoteToolkitCacheFiles();

  log.info('[ToolkitManager] Toolkit definitions cache cleared successfully', {}, {});
};

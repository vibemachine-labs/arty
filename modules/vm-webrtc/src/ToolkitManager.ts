import * as FileSystem from 'expo-file-system';
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

const ensureTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`);
const REMOTE_TOOLKIT_CACHE_DIR = `${
  ensureTrailingSlash(FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '')
}modules/vm-webrtc/remote-toolkit-definitions/`;
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

async function getRemoteToolkitCachePath(serverUrl: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    serverUrl
  );
  const fileName = `${digest}.json`;
  return `${REMOTE_TOOLKIT_CACHE_DIR}${fileName}`;
}

async function ensureCacheDirectoryExists(): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(REMOTE_TOOLKIT_CACHE_DIR, { intermediates: true });
  } catch (error) {
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'EEXIST') {
      log.debug('[ToolkitManager] Cache directory already exists', {}, {
        path: REMOTE_TOOLKIT_CACHE_DIR,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    log.error('[ToolkitManager] Failed to create cache directory', {}, {
      error: error instanceof Error ? error.message : String(error),
      path: REMOTE_TOOLKIT_CACHE_DIR,
    }, error as Error);
  }
}

async function readRemoteToolkitCache(serverUrl: string): Promise<RemoteToolkitCacheEntry | null> {
  const cachePath = await getRemoteToolkitCachePath(serverUrl);
  try {
    const contents = await FileSystem.readAsStringAsync(cachePath, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return JSON.parse(contents) as RemoteToolkitCacheEntry;
  } catch (error) {
    const errorCode = (error as { code?: string })?.code;
    if (errorCode && errorCode !== 'ENOENT') {
      log.debug('[ToolkitManager] Failed to read toolkit cache file', {}, {
        serverUrl,
        cachePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

async function writeRemoteToolkitCache(serverUrl: string, entry: RemoteToolkitCacheEntry): Promise<void> {
  await ensureCacheDirectoryExists();
  const cachePath = await getRemoteToolkitCachePath(serverUrl);
  try {
    await FileSystem.writeAsStringAsync(cachePath, JSON.stringify(entry, null, 2), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    log.debug('[ToolkitManager] Remote toolkit cache written to disk', {}, {
      serverUrl,
      cachePath,
      toolCount: entry.tools.length,
    });
  } catch (error) {
    log.error('[ToolkitManager] Failed to write toolkit cache file', {}, {
      serverUrl,
      cachePath,
      error: error instanceof Error ? error.message : String(error),
    }, error);
  }
}

async function clearRemoteToolkitCacheFiles(): Promise<void> {
  try {
    const entries = await FileSystem.readDirectoryAsync(REMOTE_TOOLKIT_CACHE_DIR);
    await Promise.all(
      entries.map((entry) =>
        FileSystem.deleteAsync(`${REMOTE_TOOLKIT_CACHE_DIR}${entry}`, { idempotent: true })
      )
    );
    log.debug('[ToolkitManager] Remote toolkit cache directory cleared', {}, {
      path: REMOTE_TOOLKIT_CACHE_DIR,
      entryCount: entries.length,
    });
  } catch (error) {
    const errorCode = (error as { code?: string })?.code;
    if (errorCode && errorCode !== 'ENOENT') {
      log.error('[ToolkitManager] Failed to clear remote toolkit cache', {}, {
        path: REMOTE_TOOLKIT_CACHE_DIR,
        error: error instanceof Error ? error.message : String(error),
      }, error);
    }
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

  log.debug('[ToolkitManager] Remote toolkit cache expired, scheduling background refresh', {}, {
    group: toolkit.group,
    url: serverUrl,
    ttlMs: REMOTE_TOOLKIT_CACHE_TTL_MS,
  });

  const refreshPromise = (async () => {
    try {
      await fetchAndCacheRemoteToolkitDefinitions(toolkit, serverUrl, REMOTE_TOOLKIT_DISCOVERY_OPTIONS);
      log.debug('[ToolkitManager] Remote toolkit cache refresh completed', {}, {
        group: toolkit.group,
        url: serverUrl,
      });
    } catch (error) {
      log.error('[ToolkitManager] Remote toolkit cache refresh failed', {}, {
        group: toolkit.group,
        url: serverUrl,
        error: error instanceof Error ? error.message : String(error),
      }, error);
    }
  })();

  remoteCacheRefreshPromises.set(serverUrl, refreshPromise);
  refreshPromise.finally(() => remoteCacheRefreshPromises.delete(serverUrl));
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
    log.debug('[ToolkitManager] Loaded toolkit definitions from disk cache', {}, {
      group: toolkit.group,
      url: serverUrl,
      cacheAgeMs,
      toolCount: cached.tools.length,
    });

    registerMcpToolsForServer(toolkit.group, serverUrl, cached.tools, client, REMOTE_TOOLKIT_DISCOVERY_OPTIONS);
    const definitions = cached.tools.map((entry) => entry.definition);
    setDynamicToolkitDefinitionsForServer(serverUrl, definitions);

    if (cacheAgeMs > REMOTE_TOOLKIT_CACHE_TTL_MS) {
      scheduleRemoteToolkitRefresh(toolkit, serverUrl);
    }

    return definitions;
  }

  try {
    return await fetchAndCacheRemoteToolkitDefinitions(toolkit, serverUrl, REMOTE_TOOLKIT_DISCOVERY_OPTIONS);
  } catch (error) {
    log.error('[ToolkitManager] Failed to fetch tools from MCP server for toolkit definitions', {}, {
      name: toolkit.name,
      group: toolkit.group,
      url: serverUrl,
      error: error instanceof Error ? error.message : String(error),
    }, error);
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
 */
export const clearToolkitDefinitionsCache = (): void => {
  log.info('[ToolkitManager] Clearing toolkit definitions cache', {}, {});
  toolkitDefinitionsCache = null;
  toolkitDefinitionsPromise = null;
  dynamicToolkitDefinitionsByServer.clear();
  remoteCacheRefreshPromises.clear();
  void clearRemoteToolkitCacheFiles();
};

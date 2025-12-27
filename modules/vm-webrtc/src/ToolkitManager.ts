import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { DeviceEventEmitter } from "react-native";

import toolkitGroupsData from "../toolkits/toolkitGroups.json";

import { log } from "../../../lib/logger";
import { getContext7ApiKey } from "../../../lib/secure-storage";
import type {
  RemoteMcpToolkitDefinition,
  ToolDefinition,
  ToolkitDefinition,
  ToolkitGroup,
  ToolkitGroups,
} from "./VmWebrtc.types";
import { exportToolDefinition } from "./VmWebrtc.types";
import { MCPClient, type RequestOptions } from "./mcp_client/client";
import type { Tool } from "./mcp_client/types";
import {
  registerMcpTool,
  type ToolSessionContext,
} from "./toolkit_functions/toolkit_functions";
import { getWrapperForGroup } from "./toolkit_functions/wrappers/ToolkitFunctionWrapper";

// Event emitted when connector settings change
export const CONNECTOR_SETTINGS_CHANGED_EVENT = "connector_settings_changed";

/**
 * Get the AsyncStorage key for a toolkit group using convention:
 * {toolkit_group_name}_connector_enabled
 * Special case: 'google_drive' -> 'gdrive_connector_enabled' for backwards compatibility
 */
function getConnectorStorageKey(groupName: string): string {
  // Special case for backwards compatibility with existing storage key
  if (groupName === "google_drive") {
    return "gdrive_connector_enabled";
  }
  return `${groupName}_connector_enabled`;
}

/**
 * Check if a toolkit group is enabled based on stored settings.
 * Returns true by default if no setting is found, except for legacy connectors which default to false.
 */
async function isToolkitGroupEnabled(groupName: string): Promise<boolean> {
  const storageKey = getConnectorStorageKey(groupName);

  // Legacy connectors default to disabled
  const isLegacyConnector =
    groupName === "github_legacy" || groupName === "gdrive_legacy";
  const defaultEnabled = !isLegacyConnector;

  try {
    const enabledValue = await AsyncStorage.getItem(storageKey);
    // Use default based on connector type if not set
    const isEnabled =
      enabledValue === null ? defaultEnabled : enabledValue === "true";

    log.debug(
      "[ToolkitManager] Toolkit group enabled status loaded",
      {},
      {
        groupName,
        storageKey,
        enabledValue,
        isEnabled,
        isLegacyConnector,
        defaultEnabled,
      },
    );

    return isEnabled;
  } catch (error) {
    log.error(
      "[ToolkitManager] Failed to load toolkit group enabled status, using default",
      {},
      {
        groupName,
        storageKey,
        defaultEnabled,
        error: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : new Error(String(error)),
    );
    return defaultEnabled;
  }
}

const buildToolkitGroups = async (): Promise<ToolkitGroups> => {
  const data = toolkitGroupsData as unknown as ToolkitGroups;
  const byName = data.byName ?? {};
  const allGroups = Array.isArray(data.list)
    ? data.list
    : Object.values(byName);

  // Filter groups based on enabled settings
  const enabledGroups: ToolkitGroup[] = [];
  const filteredByName: Record<string, ToolkitGroup> = {};

  for (const group of allGroups) {
    const isEnabled = await isToolkitGroupEnabled(group.name);

    if (isEnabled) {
      log.info(
        "[ToolkitManager] Toolkit group enabled, adding to available groups",
        {},
        {
          groupName: group.name,
          toolkitCount: group.toolkits.length,
        },
      );
      enabledGroups.push(group);
      filteredByName[group.name] = group;
    } else {
      log.debug(
        "[ToolkitManager] Toolkit group disabled, skipping",
        {},
        {
          groupName: group.name,
        },
      );
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
 * Reload toolkit groups by clearing all caches and rebuilding from scratch.
 * This should be called when connector settings change.
 */
async function reloadToolkitGroups(): Promise<void> {
  const startTime = Date.now();
  log.info(
    "[ToolkitManager] Reloading toolkit groups due to connector settings change",
    {},
    {},
  );

  // Clear all caches
  toolkitGroupsCache = null;
  toolkitGroupsPromise = null;
  staticToolkitDefinitionsCache = null;
  toolkitDefinitionsCache = null;
  toolkitDefinitionsPromise = null;

  // Rebuild toolkit groups cache
  const groups = await getFilteredToolkitGroups();

  // Rebuild toolkit definitions cache (this includes static tools based on new groups)
  const definitions = await getToolkitDefinitions();

  const reloadDurationMs = Date.now() - startTime;

  // Count tools by type
  const staticCount = (staticToolkitDefinitionsCache || []).length;
  const dynamicDefinitionArrays: ToolDefinition[][] = Array.from(
    dynamicToolkitDefinitionsByServer.values(),
  );
  const dynamicCount = dynamicDefinitionArrays.reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  // Get enabled group names
  const enabledGroupNames = groups.list.map((g) => g.name);

  log.info(
    "[ToolkitManager] Toolkit groups reloaded successfully",
    {},
    {
      reloadDurationMs,
      totalGroups: groups.list.length,
      enabledGroups: enabledGroupNames,
      totalToolsLoaded: definitions.length,
      staticToolCount: staticCount,
      dynamicToolCount: dynamicCount,
      toolNames: definitions.map((t) => t.name),
    },
  );
}

// Set up event listener for connector settings changes
DeviceEventEmitter.addListener(CONNECTOR_SETTINGS_CHANGED_EVENT, () => {
  log.info(
    "[ToolkitManager] Received connector settings changed event",
    {},
    {},
  );
  reloadToolkitGroups().catch((error) => {
    log.error(
      "[ToolkitManager] Failed to reload toolkit groups after settings change",
      {},
      {
        error: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : new Error(String(error)),
    );
  });
});

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
      if (toolkit.type === "function") {
        const toolDefinition = await exportToolDefinition(toolkit, true);
        staticTools.push(toolDefinition);
      } else if (toolkit.type === "legacy_connector") {
        // Import legacy connector definitions dynamically
        const legacyToolDef = await getLegacyConnectorDefinition(toolkit.name);
        if (legacyToolDef) {
          staticTools.push(legacyToolDef);
        }
      }
    }
  }

  return staticTools;
}

async function getLegacyConnectorDefinition(
  toolName: string,
): Promise<ToolDefinition | null> {
  if (toolName === "github_connector") {
    const { githubConnectorDefinition } = await import("./ToolGithubConnector");
    return githubConnectorDefinition;
  } else if (toolName === "gdrive_connector") {
    const { gdriveConnectorDefinition } = await import("./ToolGDriveConnector");
    return gdriveConnectorDefinition;
  }
  return null;
}

// Cache for static toolkit definitions
let staticToolkitDefinitionsCache: ToolDefinition[] | null = null;

// Use a simple subdirectory in the app cache for toolkit caching
const REMOTE_TOOLKIT_CACHE_DIR = new Directory(
  Paths.cache,
  "remote-toolkit-definitions",
);
const REMOTE_TOOLKIT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REMOTE_TOOLKIT_DISCOVERY_OPTIONS: RequestOptions = { timeout: 45000 };

/**
 * Build RequestOptions with Authorization header if the toolkit requires it.
 * Currently supports Context7 API key from secure storage.
 */
async function buildRequestOptions(
  toolkit: RemoteMcpToolkitDefinition,
): Promise<RequestOptions> {
  const options: RequestOptions = { ...REMOTE_TOOLKIT_DISCOVERY_OPTIONS };

  // Check if this toolkit requires an auth header
  if (toolkit.remote_mcp_server?.requires_auth_header) {
    // Context7 specific: get API key from secure storage
    if (toolkit.group === "context7") {
      try {
        const apiKey = await getContext7ApiKey();
        if (apiKey) {
          options.headers = {
            Authorization: `Bearer ${apiKey}`,
          };
          log.debug(
            "[ToolkitManager] Added Context7 Authorization header",
            {},
            {
              group: toolkit.group,
            },
          );
        } else {
          log.debug(
            "[ToolkitManager] No Context7 API key found, proceeding without auth",
            {},
            {
              group: toolkit.group,
            },
          );
        }
      } catch (error) {
        log.warn(
          "[ToolkitManager] Failed to retrieve Context7 API key",
          {},
          {
            group: toolkit.group,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  return options;
}

type RemoteToolkitCacheEntry = {
  lastFetched: number;
  tools: {
    name: string;
    definition: ToolDefinition;
  }[];
};

const dynamicToolkitDefinitionsByServer = new Map<string, ToolDefinition[]>();
const remoteCacheRefreshPromises = new Map<string, Promise<void>>();
const mcpClientsByServerUrl = new Map<string, MCPClient>();

/**
 * Get or create a cached MCP client for the given server URL.
 * Clients are reused across all operations to maintain session state.
 */
function getOrCreateMcpClient(serverUrl: string): MCPClient {
  let client = mcpClientsByServerUrl.get(serverUrl);
  if (!client) {
    log.debug(
      "[ToolkitManager] Creating new MCP client for server",
      {},
      {
        serverUrl,
      },
    );
    client = new MCPClient(serverUrl);
    mcpClientsByServerUrl.set(serverUrl, client);
  }
  return client;
}

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
    serverUrl,
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
    await REMOTE_TOOLKIT_CACHE_DIR.create({
      intermediates: true,
      idempotent: true,
    });
    log.debug(
      "[ToolkitManager] Cache directory created successfully",
      {},
      {
        uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
      },
    );
  } catch (error: unknown) {
    log.error(
      "[ToolkitManager] Failed to create cache directory",
      {},
      {
        error: error instanceof Error ? error.message : String(error),
        uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
      },
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

async function readRemoteToolkitCache(
  serverUrl: string,
): Promise<RemoteToolkitCacheEntry | null> {
  const cacheFile = await getRemoteToolkitCacheFile(serverUrl);
  try {
    if (!(await cacheFile.exists)) {
      return null;
    }

    const contents = await cacheFile.text();
    const parsed = JSON.parse(contents) as RemoteToolkitCacheEntry;

    // Validate cache structure - lastFetched must be a finite number (including 0), tools must be an array
    if (
      typeof parsed.lastFetched !== "number" ||
      !Number.isFinite(parsed.lastFetched) ||
      !Array.isArray(parsed.tools)
    ) {
      log.warn(
        "[ToolkitManager] Invalid cache structure, ignoring",
        {},
        {
          serverUrl,
          uri: cacheFile.uri,
          hasLastFetched: typeof parsed.lastFetched,
          isFinite: Number.isFinite(parsed.lastFetched),
          hasTools: Array.isArray(parsed.tools),
        },
      );
      return null;
    }

    return parsed;
  } catch (error: unknown) {
    log.warn(
      "[ToolkitManager] Failed to read toolkit cache file",
      {},
      {
        serverUrl,
        uri: cacheFile.uri,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}

async function writeRemoteToolkitCache(
  serverUrl: string,
  entry: RemoteToolkitCacheEntry,
): Promise<void> {
  try {
    await ensureCacheDirectoryExists();
    const cacheFile = await getRemoteToolkitCacheFile(serverUrl);

    const cacheContent = JSON.stringify(entry, null, 2);
    await cacheFile.write(cacheContent);

    log.debug(
      "[ToolkitManager] Remote toolkit cache written to disk",
      {},
      {
        serverUrl,
        uri: cacheFile.uri,
        toolCount: entry.tools.length,
        sizeBytes: cacheContent.length,
      },
    );
  } catch (error: unknown) {
    log.error(
      "[ToolkitManager] Failed to write toolkit cache file",
      {},
      {
        serverUrl,
        error: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : new Error(String(error)),
    );
    // Don't throw - cache write failures shouldn't break the application
  }
}

async function clearRemoteToolkitCacheFiles(): Promise<void> {
  try {
    if (!(await REMOTE_TOOLKIT_CACHE_DIR.exists)) {
      log.debug(
        "[ToolkitManager] Cache directory does not exist, nothing to clear",
        {},
        {
          uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
        },
      );
      return;
    }

    const entries = await REMOTE_TOOLKIT_CACHE_DIR.list();
    const deletePromises = entries.map(async (entry) => {
      try {
        await entry.delete();
      } catch (err: unknown) {
        log.warn(
          "[ToolkitManager] Failed to delete cache file",
          {},
          {
            uri: entry.uri,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    });

    await Promise.all(deletePromises);

    log.debug(
      "[ToolkitManager] Remote toolkit cache directory cleared",
      {},
      {
        uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
        entryCount: entries.length,
      },
    );
  } catch (error: unknown) {
    log.error(
      "[ToolkitManager] Failed to clear remote toolkit cache",
      {},
      {
        uri: REMOTE_TOOLKIT_CACHE_DIR.uri,
        error: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

// Cache for toolkit definitions to avoid repeated MCP server calls
let toolkitDefinitionsCache: ToolDefinition[] | null = null;
let toolkitDefinitionsPromise: Promise<ToolDefinition[]> | null = null;

/**
 * Convert MCP Tool to ToolDefinition format
 */
async function mcpToolToToolDefinition(
  tool: Tool,
  groupName: string,
): Promise<ToolDefinition> {
  // Convert MCP input schema properties to our format
  const properties: Record<string, { type: string; description: string }> = {};
  const mcpProperties = tool.inputSchema?.properties || {};

  for (const [key, value] of Object.entries(mcpProperties)) {
    properties[key] = {
      type: (value as any)?.type || "string",
      description: (value as any)?.description || "",
    };
  }

  // Load user-configured prompt addition
  const { loadToolPromptAddition } = await import("../../../lib/toolPrompts");
  const promptAdditionKey = `${groupName}.${tool.name}`;
  let description = tool.description || "";

  try {
    const promptAddition = await loadToolPromptAddition(promptAdditionKey);
    if (promptAddition && promptAddition.trim().length > 0) {
      // Append the prompt addition at the end so users can "correct" the base prompt
      description = `${tool.description || ""}\n\n${promptAddition.trim()}`;
    }
  } catch (error) {
    // If loading fails, just use the base description
    console.warn(
      `Failed to load prompt addition for MCP tool ${promptAdditionKey}:`,
      error,
    );
  }

  return {
    type: "function",
    name: `${groupName}__${tool.name}`,
    description,
    parameters: {
      type: "object",
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
    log.info(
      "[ToolkitManager] Returning cached toolkit definitions",
      {},
      {
        count: toolkitDefinitionsCache.length,
      },
    );
    return toolkitDefinitionsCache;
  }

  // If a fetch is already in progress, return that promise
  if (toolkitDefinitionsPromise) {
    log.info(
      "[ToolkitManager] Toolkit definitions fetch already in progress, awaiting...",
      {},
      {},
    );
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
    (toolkit): toolkit is RemoteMcpToolkitDefinition =>
      toolkit.type === "remote_mcp_server",
  );

  let dynamicCount = 0;
  const mcpServerDetails: { group: string; url: string; toolCount: number }[] =
    [];

  for (const toolkit of remoteMcpToolkits) {
    const definitions = await loadRemoteToolkitDefinitions(toolkit);
    dynamicCount += definitions.length;
    mcpServerDetails.push({
      group: toolkit.group,
      url: toolkit.remote_mcp_server?.url || "unknown",
      toolCount: definitions.length,
    });
  }

  const allTools = rebuildToolkitDefinitionsCache();

  // Get list of static tool groups
  const groups = await getFilteredToolkitGroups();
  const staticGroups = groups.list
    .filter((g) => g.toolkits.some((t) => t.type === "function"))
    .map((g) => ({
      name: g.name,
      toolCount: g.toolkits.filter((t) => t.type === "function").length,
    }));

  log.info(
    "[ToolkitManager] Total toolkit definitions loaded",
    {},
    {
      staticCount: staticToolkitDefinitionsCache.length,
      staticGroups,
      dynamicCount,
      mcpServers: mcpServerDetails,
      totalCount: allTools.length,
      toolNames: allTools.map((t) => t.name),
    },
  );

  return allTools;
}

function rebuildToolkitDefinitionsCache(): ToolDefinition[] {
  if (!staticToolkitDefinitionsCache) {
    log.warn(
      "[ToolkitManager] Static toolkit definitions not yet loaded, returning empty array",
      {},
      {},
    );
    return [];
  }

  const dynamicDefinitions = Array.from(
    dynamicToolkitDefinitionsByServer.values(),
  ).flat();
  const aggregated = [...staticToolkitDefinitionsCache, ...dynamicDefinitions];
  toolkitDefinitionsCache = aggregated;
  return aggregated;
}

function setDynamicToolkitDefinitionsForServer(
  serverUrl: string,
  definitions: ToolDefinition[],
): void {
  dynamicToolkitDefinitionsByServer.set(serverUrl, definitions);
  rebuildToolkitDefinitionsCache();
}

async function registerMcpToolsForServer(
  toolkit: RemoteMcpToolkitDefinition,
  serverUrl: string,
  tools: RemoteToolkitCacheEntry["tools"],
  client: MCPClient,
): Promise<void> {
  const toolkitGroup = toolkit.group;

  // Get wrapper if configured
  const wrapper = toolkit.function_call_wrapper
    ? getWrapperForGroup(toolkitGroup)
    : null;

  for (const tool of tools) {
    // Create the base tool function
    const baseToolFunction = async (
      args: any,
      context_params?: any,
      toolSessionContext?: ToolSessionContext,
    ) => {
      log.info(
        "[ToolkitManager] Executing cached MCP tool",
        {},
        {
          group: toolkitGroup,
          toolName: tool.name,
          serverUrl,
          sessionContextKeys: toolSessionContext
            ? Object.keys(toolSessionContext)
            : [],
        },
      );

      // Build request options with auth headers if needed
      const discoveryOptions = await buildRequestOptions(toolkit);

      const result = await client.callTool(
        {
          name: tool.name,
          arguments: args,
        },
        discoveryOptions,
        toolkitGroup,
      );

      // MCP tools don't yet support session context, so return empty context for now
      return {
        result: JSON.stringify(result, null, 2),
        updatedToolSessionContext: {},
      };
    };

    // Apply wrapper if configured
    const finalToolFunction = wrapper
      ? wrapper.wrap(toolkitGroup, tool.name, baseToolFunction)
      : baseToolFunction;

    registerMcpTool(toolkitGroup, tool.name, finalToolFunction);

    if (wrapper) {
      log.info(
        "[ToolkitManager] Registered MCP tool with wrapper",
        {},
        {
          group: toolkitGroup,
          toolName: tool.name,
          wrapperName: toolkit.function_call_wrapper,
        },
      );
    }
  }
}

async function convertToolsForCache(
  tools: Tool[],
  groupName: string,
): Promise<RemoteToolkitCacheEntry["tools"]> {
  const converted = await Promise.all(
    tools.map(async (tool) => ({
      name: tool.name,
      definition: await mcpToolToToolDefinition(tool, groupName),
    })),
  );
  return converted;
}

async function fetchAndCacheRemoteToolkitDefinitions(
  toolkit: RemoteMcpToolkitDefinition,
  serverUrl: string,
): Promise<ToolDefinition[]> {
  const client = getOrCreateMcpClient(serverUrl);
  const discoveryOptions = await buildRequestOptions(toolkit);

  log.info(
    "[ToolkitManager] Fetching tools from remote MCP server for toolkit definitions",
    {},
    {
      name: toolkit.name,
      group: toolkit.group,
      url: serverUrl,
    },
  );

  const result = await client.listTools(undefined, discoveryOptions);
  if (!result.tools || result.tools.length === 0) {
    log.warn(
      "[ToolkitManager] Remote MCP server returned no tools",
      {},
      {
        name: toolkit.name,
        group: toolkit.group,
        url: serverUrl,
      },
    );
    setDynamicToolkitDefinitionsForServer(serverUrl, []);
    return [];
  }

  const cachedTools = await convertToolsForCache(result.tools, toolkit.group);
  await registerMcpToolsForServer(toolkit, serverUrl, cachedTools, client);
  setDynamicToolkitDefinitionsForServer(
    serverUrl,
    cachedTools.map((entry) => entry.definition),
  );

  const cacheEntry: RemoteToolkitCacheEntry = {
    lastFetched: Date.now(),
    tools: cachedTools,
  };

  await writeRemoteToolkitCache(serverUrl, cacheEntry);

  log.info(
    "[ToolkitManager] Successfully loaded and cached MCP tools",
    {},
    {
      group: toolkit.group,
      toolCount: cachedTools.length,
      tools: cachedTools.map((t) => t.definition.name),
    },
  );

  return cachedTools.map((entry) => entry.definition);
}

function scheduleRemoteToolkitRefresh(
  toolkit: RemoteMcpToolkitDefinition,
  serverUrl: string,
): void {
  if (remoteCacheRefreshPromises.has(serverUrl)) {
    log.debug(
      "[ToolkitManager] Remote toolkit cache refresh already scheduled",
      {},
      {
        group: toolkit.group,
        url: serverUrl,
      },
    );
    return;
  }

  log.info(
    "[ToolkitManager] Cache expired, scheduling background refresh",
    {},
    {
      group: toolkit.group,
      url: serverUrl,
      ttlMs: REMOTE_TOOLKIT_CACHE_TTL_MS,
    },
  );

  const refreshPromise = (async () => {
    try {
      const newDefinitions = await fetchAndCacheRemoteToolkitDefinitions(
        toolkit,
        serverUrl,
      );

      log.info(
        "[ToolkitManager] Background cache refresh completed successfully",
        {},
        {
          group: toolkit.group,
          url: serverUrl,
          toolCount: newDefinitions.length,
        },
      );

      // Trigger a rebuild of the toolkit definitions cache with fresh data
      rebuildToolkitDefinitionsCache();
    } catch (error: unknown) {
      log.error(
        "[ToolkitManager] Background cache refresh failed, continuing with stale cache",
        {},
        {
          group: toolkit.group,
          url: serverUrl,
          error: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  })();

  remoteCacheRefreshPromises.set(serverUrl, refreshPromise);
  refreshPromise.finally(() => {
    remoteCacheRefreshPromises.delete(serverUrl);
  });
}

async function loadRemoteToolkitDefinitions(
  toolkit: RemoteMcpToolkitDefinition,
): Promise<ToolDefinition[]> {
  const serverUrl = toolkit.remote_mcp_server?.url;
  if (!serverUrl) {
    log.warn(
      "[ToolkitManager] Skipping remote MCP toolkit without URL",
      {},
      {
        name: toolkit.name,
        group: toolkit.group,
      },
    );
    return [];
  }

  const cached = await readRemoteToolkitCache(serverUrl);
  const client = getOrCreateMcpClient(serverUrl);

  if (cached && cached.tools.length > 0) {
    const cacheAgeMs = Date.now() - cached.lastFetched;
    const isCacheStale = cacheAgeMs > REMOTE_TOOLKIT_CACHE_TTL_MS;

    log.debug(
      "[ToolkitManager] Loaded toolkit definitions from disk cache",
      {},
      {
        group: toolkit.group,
        url: serverUrl,
        cacheAgeMs,
        toolCount: cached.tools.length,
        isStale: isCacheStale,
      },
    );

    // Register tools and update cache
    await registerMcpToolsForServer(toolkit, serverUrl, cached.tools, client);
    const definitions = cached.tools.map((entry) => entry.definition);
    setDynamicToolkitDefinitionsForServer(serverUrl, definitions);

    // Schedule background refresh if cache is stale
    if (isCacheStale) {
      scheduleRemoteToolkitRefresh(toolkit, serverUrl);
    }

    return definitions;
  }

  // No valid cache - fetch directly
  log.debug(
    "[ToolkitManager] No valid cache found, fetching from MCP server",
    {},
    {
      group: toolkit.group,
      url: serverUrl,
    },
  );

  try {
    return await fetchAndCacheRemoteToolkitDefinitions(toolkit, serverUrl);
  } catch (error: unknown) {
    log.error(
      "[ToolkitManager] Failed to fetch tools from MCP server for toolkit definitions",
      {},
      {
        name: toolkit.name,
        group: toolkit.group,
        url: serverUrl,
        error: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : new Error(String(error)),
    );
    return [];
  }
}

/**
 * Gets raw toolkit definitions without conversion (for internal use).
 */
export const getRawToolkitDefinitions = async (): Promise<
  ToolkitDefinition[]
> => {
  const groups = await getFilteredToolkitGroups();
  return groups.list.flatMap((group) => group.toolkits);
};

/**
 * Preload toolkit definitions so that remote MCP discovery runs eagerly.
 */
export const preloadToolkitDefinitions = async (): Promise<void> => {
  try {
    log.info(
      "[ToolkitManager] Preloading toolkit definitions cache (fetching remote MCP tools)",
    );
    await getToolkitDefinitions();
    const definitionCount = toolkitDefinitionsCache
      ? toolkitDefinitionsCache.length
      : 0;
    log.info(
      "[ToolkitManager] Toolkit definitions preload completed",
      {},
      {
        definitionCount,
        source: "preload",
      },
    );
  } catch (error) {
    log.error(
      "[ToolkitManager] Preloading toolkit definitions failed",
      {},
      {
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error,
    );
  }
};

/**
 * Clears the toolkit definitions cache, forcing a fresh fetch on next call.
 * Useful for testing or when MCP servers are updated.
 *
 * @returns Promise that resolves when cache files have been cleared
 */
export const clearToolkitDefinitionsCache = async (): Promise<void> => {
  log.info("[ToolkitManager] Clearing toolkit definitions cache", {}, {});

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
    log.debug(
      "[ToolkitManager] Waiting for in-flight promises to complete",
      {},
      {
        count: pendingPromises.length,
        hasMainFetch: toolkitDefinitionsPromise !== null,
        refreshCount: pendingRefreshes.length,
      },
    );
    await Promise.allSettled(pendingPromises);
  }

  // Now it's safe to clear all cache state
  toolkitDefinitionsCache = null;
  toolkitDefinitionsPromise = null;
  toolkitGroupsCache = null;
  staticToolkitDefinitionsCache = null;
  dynamicToolkitDefinitionsByServer.clear();
  remoteCacheRefreshPromises.clear();
  mcpClientsByServerUrl.clear();

  // Clear disk cache files
  await clearRemoteToolkitCacheFiles();

  log.info(
    "[ToolkitManager] Toolkit definitions cache cleared successfully",
    {},
    {},
  );
};

/**
 * Get MCP tools for a specific toolkit group from the dynamic cache.
 * Returns an array of tools with their names and definitions.
 *
 * @param groupName - The toolkit group name (e.g., "deepwiki")
 * @returns Array of tools for the group, or empty array if not found or not MCP
 */
export const getMcpToolsForGroup = async (
  groupName: string,
): Promise<{ name: string; description: string }[]> => {
  log.debug("[ToolkitManager] Getting MCP tools for group", {}, { groupName });

  // First, ensure toolkit definitions are loaded
  await getToolkitDefinitions();

  // Find the toolkit group
  const groups = await getFilteredToolkitGroups();
  const group = groups.list.find((g) => g.name === groupName);

  if (!group) {
    log.warn("[ToolkitManager] Toolkit group not found", {}, { groupName });
    return [];
  }

  // Check if this group has remote MCP toolkits
  const remoteMcpToolkit = group.toolkits.find(
    (toolkit): toolkit is RemoteMcpToolkitDefinition =>
      toolkit.type === "remote_mcp_server",
  );

  if (!remoteMcpToolkit) {
    log.debug(
      "[ToolkitManager] Group is not a remote MCP toolkit",
      {},
      { groupName },
    );
    return [];
  }

  const serverUrl = remoteMcpToolkit.remote_mcp_server?.url;
  if (!serverUrl) {
    log.warn(
      "[ToolkitManager] Remote MCP toolkit has no URL",
      {},
      { groupName },
    );
    return [];
  }

  // Get tools from the dynamic cache
  const definitions = dynamicToolkitDefinitionsByServer.get(serverUrl) || [];

  // Convert definitions back to simple tool info
  const tools = definitions.map((def) => {
    // Extract the tool name from the fully qualified name (e.g., "deepwiki__read_wiki_structure" -> "read_wiki_structure")
    const toolName = def.name.replace(`${groupName}__`, "");
    return {
      name: toolName,
      description: def.description,
    };
  });

  log.info(
    "[ToolkitManager] Retrieved MCP tools for group",
    {},
    {
      groupName,
      toolCount: tools.length,
    },
  );

  return tools;
};

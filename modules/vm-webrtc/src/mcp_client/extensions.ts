import { log } from "../../../../lib/logger";

export interface McpProbeResult {
  success: boolean;
  statusCode: number;
  wwwAuthenticate: string | null;
  resourceMetadataUrl: string | null;
  responseBodySnippet: string | null;
  responseHeaders: Record<string, string>;
  error?: string;
}

const MCP_INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "arty", version: "1.0.0" },
  },
  id: 1,
});

export async function probeMcpServer(
  serverUrl: string,
  bearerToken?: string,
  connectorName?: string
): Promise<McpProbeResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`;
  }

  log.info(
    "[mcp_extensions] Step 1: sending request",
    { allowSensitiveLogging: true },
    {
      connector_name: connectorName,
      method: "POST",
      server_url: serverUrl,
      request_headers: headers,
    }
  );

  let response: Response;
  try {
    response = await fetch(serverUrl, {
      method: "POST",
      headers,
      body: MCP_INITIALIZE_BODY,
    });
  } catch (fetchError: any) {
    log.error(
      "[mcp_extensions] Step 1: network error",
      {},
      { connector_name: connectorName, server_url: serverUrl, error: fetchError?.message }
    );
    return {
      success: false,
      statusCode: 0,
      wwwAuthenticate: null,
      resourceMetadataUrl: null,
      responseBodySnippet: null,
      responseHeaders: {},
      error: fetchError?.message ?? "Network error",
    };
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  let responseBodySnippet: string | null = null;
  try {
    responseBodySnippet = (await response.text()).slice(0, 500);
  } catch {
    responseBodySnippet = null;
  }

  const wwwAuthenticate = responseHeaders["www-authenticate"] ?? null;
  let resourceMetadataUrl: string | null = null;
  if (wwwAuthenticate) {
    const match = wwwAuthenticate.match(/resource_metadata="([^"]+)"/);
    if (match) resourceMetadataUrl = match[1];
  }

  const result: McpProbeResult = {
    success: response.status === 200,
    statusCode: response.status,
    wwwAuthenticate,
    resourceMetadataUrl,
    responseBodySnippet,
    responseHeaders,
  };

  const logLevel = response.status === 401 ? "info" : response.status === 200 ? "info" : "warn";
  const logMessage =
    response.status === 401
      ? "[mcp_extensions] Step 1: got 401 — server requires auth"
      : "[mcp_extensions] Step 1: server responded";

  log[logLevel](
    logMessage,
    { allowSensitiveLogging: true },
    {
      connector_name: connectorName,
      server_url: serverUrl,
      status_code: response.status,
      status_text: response.statusText,
      response_headers: responseHeaders,
      response_body_snippet: responseBodySnippet,
      www_authenticate: wwwAuthenticate,
      resource_metadata_url: resourceMetadataUrl,
    }
  );

  return result;
}

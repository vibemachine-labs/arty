import { log } from "../../../../lib/logger";

export interface McpResourceMetadata {
  resource: string;
  authorizationServers: string[];
}

export interface McpOAuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
}

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

  const sanitizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) =>
      k.toLowerCase() === "authorization" ? [k, "[REDACTED]"] : [k, v]
    )
  );
  log.info(
    "[mcp_extensions] Step 1: sending request",
    {},
    {
      connector_name: connectorName,
      method: "POST",
      server_url: serverUrl,
      request_headers: sanitizedHeaders,
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

export async function fetchResourceMetadata(
  resourceMetadataUrl: string,
  connectorName?: string,
): Promise<McpResourceMetadata> {
  log.info(
    "[mcp_extensions] Step 2: fetching resource metadata",
    {},
    { resource_metadata_url: resourceMetadataUrl, connector_name: connectorName },
  );

  const response = await fetch(resourceMetadataUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Resource metadata fetch failed: ${response.status}`);
  }

  const json = await response.json();
  const resource: string = json.resource ?? resourceMetadataUrl;
  const authorizationServers: string[] = json.authorization_servers ?? [];

  if (authorizationServers.length === 0) {
    throw new Error("No authorization_servers in resource metadata");
  }

  log.info(
    "[mcp_extensions] Step 2: got resource metadata",
    {},
    { resource, authorization_servers: authorizationServers, connector_name: connectorName },
  );

  return { resource, authorizationServers };
}

export async function fetchOAuthServerMetadata(
  authServerBaseUrl: string,
  connectorName?: string,
): Promise<McpOAuthServerMetadata> {
  const url = `${authServerBaseUrl.replace(/\/$/, "")}/.well-known/oauth-authorization-server`;
  log.info(
    "[mcp_extensions] Step 3: fetching OAuth server metadata",
    {},
    { url, connector_name: connectorName },
  );

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`OAuth server metadata fetch failed: ${response.status}`);
  }

  const json = await response.json();
  const result: McpOAuthServerMetadata = {
    authorizationEndpoint: json.authorization_endpoint,
    tokenEndpoint: json.token_endpoint,
    registrationEndpoint: json.registration_endpoint ?? null,
  };

  if (!result.authorizationEndpoint || !result.tokenEndpoint) {
    throw new Error("OAuth server metadata missing authorization_endpoint or token_endpoint");
  }

  log.info(
    "[mcp_extensions] Step 3: got OAuth server metadata",
    {},
    { ...result, connector_name: connectorName },
  );

  return result;
}

export async function registerOAuthClient(
  registrationEndpoint: string,
  redirectUri: string,
  connectorName?: string,
): Promise<{ clientId: string }> {
  log.info(
    "[mcp_extensions] Step 4: registering OAuth client",
    {},
    { registration_endpoint: registrationEndpoint, redirect_uri: redirectUri, connector_name: connectorName },
  );

  const response = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Arty",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Client registration failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const json = await response.json();
  const clientId: string = json.client_id;

  if (!clientId) {
    throw new Error("Client registration response missing client_id");
  }

  log.info(
    "[mcp_extensions] Step 4: registered OAuth client",
    {},
    { client_id: clientId, connector_name: connectorName },
  );

  return { clientId };
}

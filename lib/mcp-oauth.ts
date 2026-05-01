import * as AuthSession from "expo-auth-session";

import {
  fetchOAuthServerMetadata,
  fetchResourceMetadata,
  registerOAuthClient,
} from "../modules/vm-webrtc/src/mcp_client/extensions";
import { log } from "./logger";
import {
  getMcpClientId,
  getMcpRefreshToken,
  getMcpTokenEndpoint,
  saveMcpBearerToken,
  saveMcpClientId,
  saveMcpRefreshToken,
  saveMcpTokenEndpoint,
} from "./secure-storage";

export interface McpOAuthPendingState {
  extensionId: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  tokenEndpoint: string;
}

export type McpOAuthFlowResult =
  | { type: "success"; accessToken: string; refreshToken?: string }
  | { type: "needs_manual_callback"; pendingState: McpOAuthPendingState };

export async function performMcpOAuthFlow(
  extensionId: string,
  resourceMetadataUrl: string,
  connectorName?: string,
): Promise<McpOAuthFlowResult> {
  log.info(
    "[mcp_oauth] Starting OAuth flow",
    {},
    { extension_id: extensionId, connector_name: connectorName },
  );

  const resourceMetadata = await fetchResourceMetadata(resourceMetadataUrl, connectorName);
  const authServerUrl = resourceMetadata.authorizationServers[0];
  const oauthMeta = await fetchOAuthServerMetadata(authServerUrl, connectorName);

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "vibemachine",
    path: "mcp-oauth-callback",
  });

  let clientId = await getMcpClientId(extensionId);
  if (!clientId) {
    if (!oauthMeta.registrationEndpoint) {
      throw new Error(
        "Server requires OAuth but has no registration_endpoint and no cached client_id",
      );
    }
    const reg = await registerOAuthClient(
      oauthMeta.registrationEndpoint,
      redirectUri,
      connectorName,
    );
    clientId = reg.clientId;
    await saveMcpClientId(extensionId, clientId);
  }

  const discovery = {
    authorizationEndpoint: oauthMeta.authorizationEndpoint,
    tokenEndpoint: oauthMeta.tokenEndpoint,
  };

  const request = new AuthSession.AuthRequest({
    clientId,
    responseType: AuthSession.ResponseType.Code,
    redirectUri,
    scopes: [],
    usePKCE: true,
    extraParams: { resource: resourceMetadata.resource },
  });

  await request.makeAuthUrlAsync(discovery);

  log.info(
    "[mcp_oauth] Step 5: opening browser for authorization",
    {},
    { connector_name: connectorName },
  );
  const result = await request.promptAsync(discovery);

  if (result.type === "success" && result.params.code) {
    log.info(
      "[mcp_oauth] Step 6: exchanging code for token",
      {},
      { connector_name: connectorName },
    );
    const tokens = await exchangeAndStore(
      result.params.code,
      clientId,
      redirectUri,
      request.codeVerifier ?? "",
      oauthMeta.tokenEndpoint,
      extensionId,
      connectorName,
    );
    return { type: "success", ...tokens };
  }

  // Browser was dismissed or redirect wasn't intercepted — surface manual paste UI
  log.info(
    "[mcp_oauth] Browser closed without redirect, returning manual callback state",
    {},
    { connector_name: connectorName, result_type: result.type },
  );
  return {
    type: "needs_manual_callback",
    pendingState: {
      extensionId,
      codeVerifier: request.codeVerifier ?? "",
      redirectUri,
      clientId,
      tokenEndpoint: oauthMeta.tokenEndpoint,
    },
  };
}

export async function completeMcpOAuthFromCallbackUrl(
  callbackUrl: string,
  pendingState: McpOAuthPendingState,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const questionIdx = callbackUrl.indexOf("?");
  if (questionIdx === -1) {
    throw new Error("No authorization code found in that URL.");
  }
  const params = new URLSearchParams(callbackUrl.slice(questionIdx + 1));
  const code = params.get("code");
  if (!code) {
    throw new Error("No authorization code found in that URL.");
  }

  log.info(
    "[mcp_oauth] Completing OAuth from pasted callback URL",
    {},
    { extension_id: pendingState.extensionId },
  );

  return exchangeAndStore(
    code,
    pendingState.clientId,
    pendingState.redirectUri,
    pendingState.codeVerifier,
    pendingState.tokenEndpoint,
    pendingState.extensionId,
  );
}

async function exchangeAndStore(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  tokenEndpoint: string,
  extensionId: string,
  connectorName?: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      code,
      clientId,
      redirectUri,
      extraParams: { code_verifier: codeVerifier },
    },
    { tokenEndpoint },
  );

  await saveMcpBearerToken(extensionId, tokenResponse.accessToken);
  await saveMcpTokenEndpoint(extensionId, tokenEndpoint);
  if (tokenResponse.refreshToken) {
    await saveMcpRefreshToken(extensionId, tokenResponse.refreshToken);
  }

  log.info(
    "[mcp_oauth] OAuth flow complete",
    {},
    { connector_name: connectorName, has_refresh_token: !!tokenResponse.refreshToken },
  );

  return {
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken ?? undefined,
  };
}

export async function refreshMcpAccessToken(
  extensionId: string,
  connectorName?: string,
): Promise<string | null> {
  const [refreshToken, tokenEndpoint] = await Promise.all([
    getMcpRefreshToken(extensionId),
    getMcpTokenEndpoint(extensionId),
  ]);

  if (!refreshToken || !tokenEndpoint) return null;

  const clientId = await getMcpClientId(extensionId);
  if (!clientId) return null;

  log.info(
    "[mcp_oauth] Refreshing access token",
    {},
    { extension_id: extensionId, connector_name: connectorName },
  );

  try {
    const tokenResponse = await AuthSession.refreshAsync(
      { clientId, refreshToken },
      { tokenEndpoint },
    );

    await saveMcpBearerToken(extensionId, tokenResponse.accessToken);
    if (tokenResponse.refreshToken) {
      await saveMcpRefreshToken(extensionId, tokenResponse.refreshToken);
    }

    log.info("[mcp_oauth] Token refresh succeeded", {}, { connector_name: connectorName });
    return tokenResponse.accessToken;
  } catch (err) {
    log.warn(
      "[mcp_oauth] Token refresh failed",
      {},
      { connector_name: connectorName, error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

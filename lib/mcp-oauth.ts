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

export async function performMcpOAuthFlow(
  extensionId: string,
  resourceMetadataUrl: string,
  connectorName?: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
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

  if (result.type !== "success" || !result.params.code) {
    throw new Error(
      result.type === "cancel" ? "Sign-in was cancelled." : "OAuth sign-in failed.",
    );
  }

  log.info(
    "[mcp_oauth] Step 6: exchanging code for token",
    {},
    { connector_name: connectorName },
  );
  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      code: result.params.code,
      clientId,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier ?? "" },
    },
    { tokenEndpoint: oauthMeta.tokenEndpoint },
  );

  await saveMcpBearerToken(extensionId, tokenResponse.accessToken);
  await saveMcpTokenEndpoint(extensionId, oauthMeta.tokenEndpoint);
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

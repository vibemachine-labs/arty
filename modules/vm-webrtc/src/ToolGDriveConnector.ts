import * as AuthSession from 'expo-auth-session';

import { log } from '../../../lib/logger';
import {
  deleteGDriveTokens,
  getGDriveAccessToken,
  getGDriveClientId,
  // These may already exist in your secure-storage. If not, add them there accordingly.
  getGDriveRefreshToken,
  setGDriveAccessToken
} from '../../../lib/secure-storage';
import { type ToolNativeModule } from './ToolHelper';
import { type ToolDefinition } from './VmWebrtc.types';

export const gdriveConnectorDefinition: ToolDefinition = {
  type: 'function',
  name: 'gdrive_connector',
  description: `This tool can perform any operation on Google Drive (GDrive) by generating
a self-contained JavaScript snippet that uses the Google Drive API.

The snippet MUST be a single self-invoking expression that returns a JSON-serializable value:
(() => { /* your code here */ return result; })()

Requirements:
- Return a JSON-serializable value (string, number, boolean, object, array, null)
- Must be synchronous - no async/await, Promises, or callbacks
- Include console.log statements for debugging purposes
- Do NOT declare or call named functions (no 'function foo()' or 'foo()')
- Do NOT reference external variables - inline all needed values as constants
- Use only standard JavaScript features available in most environments

The snippet must not import any other modules or libraries that are not included by default in react native, 
since it will be run in a restricted react native environment.

You should derive the snippet from the user's request, then call this tool
with that snippet.

Example code snippet 1:

// MUST be a single self-invoking expression that returns a Promise
// Note: accessToken will be available in scope when this snippet is executed
(() => {
  const params = new URLSearchParams({
    pageSize: "20",
    fields: "files(id,name,mimeType,modifiedTime)",
    orderBy: "modifiedTime desc",
    spaces: "drive",
  });

  return fetch("https://www.googleapis.com/drive/v3/files?" + params.toString(), {
    headers: {
      Authorization: "Bearer " + accessToken,
    },
  })
  .then(res => {
    if (!res.ok) {
      return res.text().then(txt => {
        throw new Error("Drive API error: " + res.status + " " + txt);
      });
    }
    return res.json();
  })
  .then(json => json.files.map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
  })));
})()
  
Example 2:

You can get any google docs in google drive by converting them into plain text.  
Here is a single, runnable TypeScript snippet that exports a Google Doc to 
plain text using the raw Drive API (no SDK), stays fully in memory, and returns { id, name, mimeType, text }. 

((docFileId) => {
  const errIfNotOk = (res) =>
    res.ok ? res : res.text().then(t => { throw new Error("Drive API error " + res.status + ": " + t); });

  const authFetch = (url) =>
    fetch(url, { headers: { Authorization: "Bearer " + accessToken } }).then(errIfNotOk);

  const fetchJSON = (url) =>
    authFetch(url).then(r => r.json());

  // Only fetch metadata for the provided file ID
  const findGoogleDoc = () => {
    if (typeof docFileId !== "string" || !docFileId) {
      throw new Error("No Google Doc file ID provided.");
    }

    return fetchJSON(
      "https://www.googleapis.com/drive/v3/files/" +
      encodeURIComponent(docFileId) +
      "?fields=id,name,mimeType"
    ).then(meta => {
      if (meta.mimeType !== "application/vnd.google-apps.document") {
        throw new Error("File " + docFileId + " is not a Google Doc (mimeType=" + meta.mimeType + ").");
      }
      return { id: meta.id, name: meta.name };
    });
  };

  // Main execution chain
  return findGoogleDoc().then(({ id, name }) => {
    const exportUrl =
      "https://www.googleapis.com/drive/v3/files/" +
      encodeURIComponent(id) +
      "/export?" +
      new URLSearchParams({
        mimeType: "text/plain",
        supportsAllDrives: "true",
      }).toString();

    return authFetch(exportUrl)
      .then(r => r.text())
      .then(text => ({
        id,
        name: name ?? null,
        mimeType: "application/vnd.google-apps.document",
        text, // plain-text contents of the Google Doc
      }));
  });
})("YOUR_DOC_FILE_ID_HERE");

Example 3:

You can get the content of a PDF document in Google Drive as well.  Here you go — a single, self-invoking snippet that (1) checks the PDF size with Drive, (2) converts the PDF to a temporary Google Doc (no OCR needed for “normal” PDFs), (3) exports that Doc as plain text, (4) deletes the temp file, and (5) returns a JSON-serializable object with the text. It keeps everything in memory and includes a hard size cap so you don’t blow up RAM.

((pdfFileId) => {
  const token = accessToken; // provided externally
  const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB limit
  const INCLUDE_ALL_DRIVES = "true";

  console.log("[pdf->text] start for", pdfFileId);

  const errIfNotOk = (res) =>
    res.ok ? res : res.text().then(t => { throw new Error("Drive API error " + res.status + ": " + t); });

  const authFetch = (url, init) => {
    console.log("[fetch]", url);
    const headers = Object.assign({ Authorization: "Bearer " + token }, (init && init.headers) || {});
    return fetch(url, Object.assign({}, init, { headers })).then(errIfNotOk);
  };

  const fetchJSON = (url, init) => authFetch(url, init).then(r => r.json());

  // 1) Fetch metadata
  const metaUrl = "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(pdfFileId) +
    "?fields=id,name,mimeType,size&supportsAllDrives=" + INCLUDE_ALL_DRIVES;

  return fetchJSON(metaUrl)
    .then(meta => {
      console.log("[meta]", meta);
      if (!meta || meta.mimeType !== "application/pdf") {
        throw new Error("File is not a PDF (mimeType=" + (meta && meta.mimeType) + ").");
      }
      const sizeNum = typeof meta.size === "string" ? parseInt(meta.size, 10) : (meta.size || 0);
      if (sizeNum > MAX_PDF_BYTES) {
        throw new Error("PDF too large (" + sizeNum + " bytes). Cap is " + MAX_PDF_BYTES + " bytes.");
      }

      // 2) Convert PDF to temporary Google Doc
      const copyUrl = "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(meta.id) +
        "/copy?supportsAllDrives=" + INCLUDE_ALL_DRIVES;

      const copyBody = {
        name: (meta.name || "PDF") + " (temp text extract)",
        mimeType: "application/vnd.google-apps.document"
      };

      console.log("[copy] creating temp Google Doc");
      return fetchJSON(copyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(copyBody)
      }).then(tempFile => ({ meta, tempFile }));
    })
    .then(({ meta, tempFile }) => {
      if (!tempFile || !tempFile.id) throw new Error("Failed to create temporary Google Doc.");
      console.log("[copy] temp doc id:", tempFile.id);

      // 3) Export the temp doc as text
      const exportUrl = "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(tempFile.id) +
        "/export?mimeType=text/plain&supportsAllDrives=" + INCLUDE_ALL_DRIVES;

      console.log("[export] exporting as text/plain");
      return authFetch(exportUrl).then(r => r.text())
        .then(text => ({ meta, tempFileId: tempFile.id, text }));
    })
    .then(({ meta, tempFileId, text }) => {
      // 4) Cleanup
      const deleteUrl = "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(tempFileId) +
        "?supportsAllDrives=" + INCLUDE_ALL_DRIVES;

      console.log("[cleanup] deleting temp doc:", tempFileId);
      return authFetch(deleteUrl, { method: "DELETE" })
        .catch(err => { console.log("[cleanup] delete failed (ignored):", String(err)); })
        .then(() => {
          console.log("[pdf->text] done");
          return {
            id: meta.id,
            name: meta.name || null,
            mimeType: meta.mimeType || "application/pdf",
            bytes: (typeof meta.size === "string" ? parseInt(meta.size, 10) : (meta.size || null)),
            text: text,
            truncated: false
          };
        });
    });
})("YOUR_PDF_FILE_ID_HERE")

Example 4:

You are able to search for files using keywords to find partial matches of file names.

Here is some sample code:

((keyword) => {
  const safeKeyword = String(keyword || "").trim();
  if (!safeKeyword) {
    throw new Error("Missing search keyword");
  }

  const params = new URLSearchParams({
    q: "name contains '" + safeKeyword.replace(/'/g, "\\'") + "' and trashed=false",
    fields: "files(id,name,mimeType,modifiedTime,owners)",
    orderBy: "modifiedTime desc",
    pageSize: "40",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true"
  });

  return fetch("https://www.googleapis.com/drive/v3/files?" + params.toString(), {
    headers: { Authorization: "Bearer " + accessToken }
  })
  .then(res => {
    if (!res.ok) {
      return res.text().then(txt => {
        throw new Error("Drive API error: " + res.status + " " + txt);
      });
    }
    return res.json();
  })
  .then(json => (json.files || []).map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    owner: (file.owners && file.owners[0] && file.owners[0].emailAddress) || null
  })));
})("runpod")`,
  parameters: {
    type: 'object',
    properties: {
      self_contained_javascript_gdrive_code_snippet: {
        type: 'string',
        description: `Provide the complete 
Google Drive API JavaScript snippet (logic + return).

The snippet MUST be a single self-invoking expression that returns a JSON-serializable value:
(() => { /* your code here */ return result; })()

Requirements:
- Return a JSON-serializable value (string, number, boolean, object, array, null)
- Must be synchronous - no async/await, Promises, or callbacks
- Include console.log statements for debugging purposes
- Do NOT declare or call named functions (no 'function foo()' or 'foo()')
- Do NOT reference external variables - inline all needed values as constants
- Use only standard JavaScript features available in most environments

Example:
// MUST be a single self-invoking expression that returns a Promise
// Note: accessToken will be available in scope when this snippet is executed
(() => {
  const params = new URLSearchParams({
    pageSize: "20",
    fields: "files(id,name,mimeType,modifiedTime)",
    orderBy: "modifiedTime desc",
    spaces: "drive",
  });

  return fetch("https://www.googleapis.com/drive/v3/files?" + params.toString(), {
    headers: {
      Authorization: "Bearer " + accessToken,
    },
  })
  .then(res => {
    if (!res.ok) {
      return res.text().then(txt => {
        throw new Error("Drive API error: " + res.status + " " + txt);
      });
    }
    return res.json();
  })
  .then(json => json.files.map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
  })));
})()`,
      },
    },
    required: ['self_contained_javascript_gdrive_code_snippet'],
  },
};

const GOOGLE_REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// MARK: - Helpers

export const revokeGDriveAccess = async (): Promise<void> => {
  log.info('[ToolGDriveConnector] 🧹 Revoking GDrive access', {});

  const [accessToken, refreshToken] = await Promise.all([
    getGDriveAccessToken(),
    getGDriveRefreshToken(),
  ]);

  const uniqueTokens = Array.from(
    new Set([accessToken, refreshToken].filter((token): token is string => Boolean(token)))
  );

  for (const token of uniqueTokens) {
    const preview = `${token.slice(0, 6)}...${token.slice(-6)}`;
    try {
      await AuthSession.revokeAsync({ token }, { revocationEndpoint: GOOGLE_REVOCATION_ENDPOINT });
      log.info(`[ToolGDriveConnector] ✅ Token revoked`, {}, { tokenPreview: preview });
    } catch (error) {
      log.warn(`[ToolGDriveConnector] ⚠️ Failed to revoke token`, {}, {
        tokenPreview: preview,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      }, error);
    }
  }

  try {
    await deleteGDriveTokens();
    log.info('[ToolGDriveConnector] 🧺 Local Google Drive tokens cleared', {});
  } catch (error) {
    log.warn('[ToolGDriveConnector] ⚠️ Failed to clear local tokens', {}, {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    }, error);
  }
};

// MARK: - Types

export interface GDriveConnectorParams {
  self_contained_javascript_gdrive_code_snippet: string;
  [key: string]: string; // Index signature to satisfy ToolParams constraint
}

export interface GDriveConnectorNativeModule extends ToolNativeModule {
  gdriveOperationFromSwift(codeSnippet: string): Promise<string>;
  sendGDriveConnectorResponse(requestId: string, result: string): void;
}

// MARK: - GDrive Connector Tool Manager

/**
 * Manages gdrive connector tool calls between JavaScript and native Swift code.
 * Uses the GDrive API.
 * Handles both OpenAI tool calls and direct Swift-to-JS testing.
 */
export class ToolGDriveConnector {
  private readonly toolName = 'ToolGDriveConnector';
  private readonly requestEventName = 'onGDriveConnectorRequest';
  private readonly module: GDriveConnectorNativeModule | null;

  constructor(nativeModule: GDriveConnectorNativeModule | null) {
    this.module = nativeModule;

    if (this.module) {
      this.module.addListener(this.requestEventName, this.handleRequest.bind(this));
      log.info('[ToolGDriveConnector] Initialized with native module', {}, { eventName: this.requestEventName });
    } else {
      log.warn('[ToolGDriveConnector] Native module unavailable', {});
    }
  }

  // MARK: - Private Methods

  /**
   * Handle a gdrive connector request from Swift.
   */
  private async handleRequest(event: { requestId: string; self_contained_javascript_gdrive_code_snippet: string }) {
    const { requestId, self_contained_javascript_gdrive_code_snippet } = event;
    log.info(`[${this.toolName}] 📥 Received request from Swift`, {}, {
      requestId,
      codeSnippet: self_contained_javascript_gdrive_code_snippet,
      snippetLength: self_contained_javascript_gdrive_code_snippet.length,
    });

    try {
      const result = await this.performOperation({ self_contained_javascript_gdrive_code_snippet });
      log.info(`[${this.toolName}] ✅ Operation completed`, {}, {
        requestId,
        resultLength: String(result).length,
        result: result,
      });

      if (this.module) {
        this.module.sendGDriveConnectorResponse(requestId, result);
        log.info(`[${this.toolName}] 📤 Sent response to Swift`, {}, {
          requestId,
          response: result,
          responseLength: String(result).length,
        });
      } else {
        log.warn(`[${this.toolName}] ⚠️ Cannot send response; native module missing`, {}, { requestId });
      }
    } catch (error) {
      log.error(`[${this.toolName}] ❌ Operation failed`, {}, {
        requestId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      }, error);

      if (this.module) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.module.sendGDriveConnectorResponse(requestId, `Error: ${errorMessage}`);
        log.info(`[${this.toolName}] 📤 Sent error response to Swift`, {}, {
          requestId,
          errorMessage,
        });
      }
    }
  }

  /**
   * Perform the actual gdrive API operation.
   */
  private async performOperation(params: GDriveConnectorParams): Promise<string> {
    const { self_contained_javascript_gdrive_code_snippet } = params;
    log.info(`[${this.toolName}] 🔧 Performing gdrive operation`, {}, {
      codeSnippet: self_contained_javascript_gdrive_code_snippet,
      snippetLength: self_contained_javascript_gdrive_code_snippet.length,
    });

    return executeGDriveSnippet({
      snippet: self_contained_javascript_gdrive_code_snippet,
      toolName: this.toolName,
    });
  }

  // MARK: - Public Methods

  /**
   * Core gdrive connector function that performs the actual operation.
   * This is the business logic that can be called directly or via native bridge.
   */
  async execute(params: GDriveConnectorParams): Promise<string> {
    return this.performOperation(params);
  }

  /**
   * GDrive connector bridge function - calls JS gdrive connector from Swift via native bridge.
   * Used for testing the Swift → JS → Swift flow.
   */
  async executeFromSwift(codeSnippet: string): Promise<string> {
    if (!this.module) {
      throw new Error(`Native module not available for gdrive connector bridge function`);
    }
    return this.module.gdriveOperationFromSwift(codeSnippet);
  }
}

// MARK: - Shared Execution Helpers

export interface ExecuteGDriveSnippetOptions {
  snippet: string;
  toolName: string;
}

export const executeGDriveSnippet = async ({
  snippet,
  toolName,
}: ExecuteGDriveSnippetOptions): Promise<string> => {
  const trimmedSnippet = (snippet ?? '').trim();
  const accessToken = await getGDriveAccessToken();

  const tokenLen = accessToken?.length ?? 0;
  const tokenPreview = accessToken ? `${accessToken.slice(0, 6)}...${accessToken.slice(-6)}` : 'null';
  log.info(`[${toolName}] 🔑 GDrive access token retrieved`, {}, {
    hasToken: !!accessToken,
    tokenPreview,
    tokenLength: tokenLen,
  });

  // Make the GDrive access token available in the eval scope
  (globalThis as any).accessToken = accessToken ?? null;

  // Optionally expose a best-effort "authenticated_gdrive_user" placeholder (email, etc.) if you have it elsewhere
  (globalThis as any).authenticated_gdrive_user = null;

  // Add common stdlib-like globals if missing (best-effort)
  const stdlibModules: Record<string, any> = {};
  try { if (typeof Buffer !== 'undefined') stdlibModules.Buffer = Buffer; } catch {}
  try { if (typeof process !== 'undefined') stdlibModules.process = process; } catch {}
  stdlibModules.console = console;
  stdlibModules.setTimeout = setTimeout;
  stdlibModules.clearTimeout = clearTimeout;
  stdlibModules.setInterval = setInterval;
  stdlibModules.clearInterval = clearInterval;
  for (const [k, v] of Object.entries(stdlibModules)) {
    if (!(k in globalThis)) {
      (globalThis as any)[k] = v;
    }
  }

  if (!trimmedSnippet) {
    return JSON.stringify({ error: 'No JavaScript snippet provided' });
  }

  // Validation (no transforms)
  if (/^\s*import\s/m.test(trimmedSnippet) || /^\s*export\s/m.test(trimmedSnippet)) {
    throw new Error('Snippet must not contain import/export.');
  }
  if (/function\s+\w+\s*\(/.test(trimmedSnippet)) {
    throw new Error('Snippet must not declare named functions.');
  }

  // Wrap global fetch to reactively handle 401 by refreshing access token once and retrying
  const originalFetch: typeof fetch | undefined = (globalThis as any).fetch?.bind(globalThis);

  const isTokenEndpoint = (urlStr: string) => urlStr.startsWith('https://oauth2.googleapis.com/token');

  const toUrlString = (input: RequestInfo | URL): string => {
    try {
      if (typeof input === 'string') return input;
      if ((input as any)?.url) return (input as any).url;
      if (input instanceof URL) return input.toString();
    } catch {}
    return '';
  };

  const normalizeHeaders = (h: any): Headers => {
    const headers = new Headers();
    if (!h) return headers;
    try {
      if (h instanceof Headers) {
        h.forEach((v, k) => headers.set(k, v));
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers.set(k as string, String(v));
      } else {
        for (const [k, v] of Object.entries(h)) headers.set(k, String(v));
      }
    } catch {
      // best-effort
    }
    return headers;
  };

  const applyAuthHeader = (init: RequestInit | undefined, token: string): RequestInit => {
    const next: RequestInit = { ...(init || {}) };
    const headers = normalizeHeaders(next.headers as any);
    headers.set('Authorization', `Bearer ${token}`);
    next.headers = headers;
    return next;
  };

  const wrappedFetch: typeof fetch = async (input: any, init?: RequestInit): Promise<Response> => {
    if (!originalFetch) {
      return fetch(input, init);
    }

    const urlStr = toUrlString(input);

    // Do not attempt refresh/retry for the token endpoint itself
    if (isTokenEndpoint(urlStr)) {
      return originalFetch(input, init);
    }

    let res = await originalFetch(input, init);

    // Explain common HTTP status codes
    const statusExplanation = (() => {
      if (res.status === 200) return 'OK';
      if (res.status === 201) return 'Created';
      if (res.status === 204) return 'No Content (success, empty response)';
      if (res.status === 400) return 'Bad Request';
      if (res.status === 401) return 'Unauthorized (will attempt token refresh)';
      if (res.status === 403) return 'Forbidden';
      if (res.status === 404) return 'Not Found';
      if (res.status === 429) return 'Rate Limited';
      if (res.status >= 500) return 'Server Error';
      return `HTTP ${res.status}`;
    })();

    if (res.status !== 401) {
      return res;
    }

    // Attempt one refresh and retry once
    log.info(`[${toolName}] 🔁 401 Unauthorized - attempting token refresh`, {}, { url: urlStr });
    const newToken = await refreshDriveAccessToken(toolName);
    if (!newToken) {
      log.warn(`[${toolName}] ⚠️ Token refresh failed`, {}, { url: urlStr });
      return res;
    }

    // Update Authorization header and retry
    try {
      let retryInput = input;
      let retryInit: RequestInit | undefined = init;

      // If the original input was a Request, clone and override headers
      if (typeof Request !== 'undefined' && input instanceof Request) {
        const hdrs = applyAuthHeader({ headers: (input as Request).headers as any }, newToken).headers as Headers;
        retryInput = new Request((input as Request).url, {
          method: (input as Request).method,
          headers: hdrs,
          body: (input as any)._bodyInit ?? undefined,
          // Other props are not strictly necessary for simple GET calls
        });
      } else {
        retryInit = applyAuthHeader(retryInit, newToken);
      }

      log.info(`[${toolName}] 🔁 Retrying request with refreshed token`, {}, { url: urlStr });
      const retryRes = await originalFetch(retryInput, retryInit);
      return retryRes;
    } catch (e) {
      log.error(`[${toolName}] ❌ Retry after refresh failed`, {}, {
        url: urlStr,
        errorMessage: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      }, e);
      return res;
    }
  };

  let execResult: any;
  try {
    log.info(`[${toolName}] 🚀 Evaluating code snippet`, {}, {
      codeSnippet: trimmedSnippet,
      snippetLength: trimmedSnippet.length
    });
    if (originalFetch) {
      (globalThis as any).fetch = wrappedFetch;
    }
    execResult = eval(trimmedSnippet);
  } catch (e) {
    log.error(`[${toolName}] ❌ Execution eval error`, {}, {
      errorMessage: e instanceof Error ? e.message : String(e),
      errorStack: e instanceof Error ? e.stack : undefined,
      errorName: e instanceof Error ? e.name : undefined,
      snippetPreview: trimmedSnippet.slice(0, 200),
      fullSnippet: trimmedSnippet,
    }, e);
    if (originalFetch) {
      (globalThis as any).fetch = originalFetch;
    }
    return JSON.stringify({ error: String(e), snippet: trimmedSnippet });
  }

  try {
    if (execResult && typeof execResult.then === 'function') {
      log.info(`[${toolName}] ⏳ Awaiting promise from snippet`, {});
      execResult = await execResult;
    }
  } catch (e) {
    log.error(`[${toolName}] ❌ Execution error (promise rejection)`, {}, {
      errorMessage: e instanceof Error ? e.message : String(e),
      errorStack: e instanceof Error ? e.stack : undefined,
      errorName: e instanceof Error ? e.name : undefined,
      snippetPreview: trimmedSnippet.slice(0, 200),
    }, e);
    return JSON.stringify({ error: String(e), snippet: trimmedSnippet });
  } finally {
    if (originalFetch) {
      (globalThis as any).fetch = originalFetch;
    }
  }

  // Serialize result to JSON for the Swift bridge and LLM
  let serialized: string;
  try {
    // JSON-serializable results will be handled here
    serialized = JSON.stringify(execResult);
    if (serialized === undefined as unknown as string) {
      // JSON.stringify(undefined) returns undefined; normalize to "null"
      serialized = 'null';
    }
  } catch {
    // Fallback for non-serializable values
    serialized = JSON.stringify({
      result: execResult != null ? String(execResult) : null,
    });
  }

  log.info(`[${toolName}] ✅ executeGDriveSnippet() complete.  Response Lenth: ${serialized.length}`, {}, {
    serializedLength: serialized.length,
    response: serialized,
  });
  return serialized;
};

const refreshDriveAccessToken = async (toolName: string): Promise<string | null> => {
  try {
    const refreshToken = await (getGDriveRefreshToken as any)?.();
    const clientId = await (getGDriveClientId as any)?.();

    if (!refreshToken || !clientId) {
      log.warn(`[${toolName}] ⚠️ Cannot refresh token - missing credentials`, {}, {
        hasRefreshToken: !!refreshToken,
        hasClientId: !!clientId,
      });
      return null;
    }

    log.info(`[${toolName}] 🔄 Refreshing Google Drive access token`, {});

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString();

    // Use the original global fetch (not wrapped) for token refresh
    const fetchFn: typeof fetch = (globalThis as any).__originalFetch__ || fetch;

    const resp = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      log.error(`[${toolName}] ❌ Token refresh failed`, {}, {
        status: resp.status,
        statusText: resp.statusText,
        errorBody: txt,
      });
      return null;
    }

    const json = await resp.json();
    const newAccessToken: string | undefined = json?.access_token;

    if (!newAccessToken) {
      log.error(`[${toolName}] ❌ Token refresh response missing access_token`, {}, { response: json });
      return null;
    }

    // Persist if setter exists
    try {
      if (typeof (setGDriveAccessToken as any) === 'function') {
        await (setGDriveAccessToken as any)(newAccessToken, json?.expires_in);
      }
    } catch (e) {
      log.warn(`[${toolName}] ⚠️ Failed to persist refreshed token, using in-memory only`, {}, {
        errorMessage: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      }, e);
    }

    (globalThis as any).accessToken = newAccessToken;

    const newTokenLen = newAccessToken.length;
    const newTokenPreview = `${newAccessToken.slice(0, 6)}...${newAccessToken.slice(-6)}`;
    log.info(`[${toolName}] ✅ Token refreshed successfully`, {}, {
      tokenPreview: newTokenPreview,
      tokenLength: newTokenLen,
      expiresIn: json?.expires_in,
    });

    return newAccessToken;
  } catch (e) {
    log.error(`[${toolName}] ❌ Unexpected error refreshing token`, {}, {
      errorMessage: e instanceof Error ? e.message : String(e),
      errorStack: e instanceof Error ? e.stack : undefined,
      errorName: e instanceof Error ? e.name : undefined,
    }, e);
    return null;
  }
};

// MARK: - Factory Function

/**
 * Creates a new ToolGDriveConnector instance with the provided native module.
 * Returns null if the module is not available.
 */
export const createGDriveConnectorTool = (nativeModule: GDriveConnectorNativeModule | null): ToolGDriveConnector | null => {
  if (!nativeModule) {
    log.warn('[ToolGDriveConnector] Native module not available, tool will not be initialized', {});
    return null;
  }
  return new ToolGDriveConnector(nativeModule);
};

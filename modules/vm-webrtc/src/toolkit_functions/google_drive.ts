import { log } from '../../../../lib/logger';
import {
    getGDriveAccessToken,
    getGDriveClientId,
    getGDriveRefreshToken,
    setGDriveAccessToken,
} from '../../../../lib/secure-storage';
import type { ToolSessionContext, ToolkitResult } from './types'; // MARK: - Constants

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DEFAULT_PAGE_SIZE = 5;
const GOOGLE_DOCS_MIME_TYPE = 'application/vnd.google-apps.document';
const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

// MARK: - Enums

enum OrderBy {
  MODIFIED_TIME_DESC = 'modifiedTime desc',
  MODIFIED_TIME = 'modifiedTime',
  CREATED_TIME_DESC = 'createdTime desc',
  CREATED_TIME = 'createdTime',
  NAME = 'name',
  NAME_DESC = 'name desc',
}

enum Corpora {
  USER = 'user',
  DRIVE = 'drive',
  DOMAIN = 'domain',
}

// MARK: - Types

export interface KeywordSearchParams {
  query: string;
}

export interface SearchDocumentsParams {
  document_contains?: string[];
  document_not_contains?: string[];
  search_only_in_shared_drive_id?: string;
  include_shared_drives?: boolean;
  include_organization_domain_documents?: boolean;
  order_by?: string[];
  limit?: number;
  pagination_token?: string;
}

export interface ListDriveFolderChildrenParams {
  folder_id?: string;
  page_size?: number;
  page_token?: string;
}

export interface GetGDriveFileContentParams {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  owners?: { emailAddress?: string }[];
  parents?: string[];
}

interface DriveApiResponse {
  files?: DriveFile[];
}

interface FormattedFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  owner: string | null;
}

// MARK: - Functions

/**
 * Search for files in Google Drive by keyword.
 *
 * @param params.query - The search keyword to find in file names
 */
export async function keyword_search(
  params: KeywordSearchParams,
  context_params?: any,
  toolSessionContext?: ToolSessionContext
): Promise<ToolkitResult> {
  const { query } = params;

  const safeKeyword = String(query || '').trim();

  if (!safeKeyword) {
    const errorMessage = 'Missing search keyword';
    log.error('[google_drive] keyword_search validation failed', {}, { query });
    return {
      result: JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'keyword_search',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
      updatedToolSessionContext: {},
    };
  }

  // Escape single quotes in the search keyword
  // Escape backslashes first, then single quotes
  const escapedKeyword = safeKeyword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // Build query parameters
  const searchParams = new URLSearchParams({
    q: `name contains '${escapedKeyword}' and trashed=false`,
    fields: 'files(id,name,mimeType,modifiedTime,owners)',
    orderBy: 'modifiedTime desc',
    pageSize: String(DEFAULT_PAGE_SIZE),
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const url = `${DRIVE_API_BASE_URL}/files?${searchParams.toString()}`;

  log.info('[google_drive] keyword_search called', {}, {
    query: safeKeyword,
    url,
  });

  try {
    // Validate auth prerequisites (client ID + access token)
    const validationError = await validateAuthPrerequisites('keyword_search');
    if (validationError) {
      return validationError;
    }

    // Get the validated access token
    const accessToken = await getGDriveAccessToken();
    const clientId = await getGDriveClientId();

    const response = await fetchWithTokenRefresh('keyword_search', url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('[google_drive] Drive API request failed', {}, {
        status: response.status,
        statusText: response.statusText,
        errorText,
        url,
        tokenLength: accessToken!.length,
        clientIdLength: clientId!.length,
        hasClientId: !!clientId,
        hasAccessToken: !!accessToken,
      });
      throw new Error(`Drive API error: ${response.status} ${errorText}`);
    }

    const data: DriveApiResponse = await response.json();
    const files: FormattedFile[] = (data.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      owner: (file.owners && file.owners[0] && file.owners[0].emailAddress) || null,
    }));

    log.info('[google_drive] keyword_search completed', {}, {
      query: safeKeyword,
      count: files.length,
      url,
    });

    return {
      result: JSON.stringify({
        success: true,
        group: 'google_drive',
        tool: 'keyword_search',
        query: safeKeyword,
        files,
        timestamp: new Date().toISOString(),
      }),
      updatedToolSessionContext: {},
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[google_drive] keyword_search failed', {}, {
      query: safeKeyword,
      url,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return {
      result: JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'keyword_search',
        error: errorMessage,
        query: safeKeyword,
        timestamp: new Date().toISOString(),
      }),
      updatedToolSessionContext: {},
    };
  }
}

// MARK: - Helper Functions

/**
 * Validate that we have the necessary auth prerequisites.
 * Returns an error response if validation fails, or null if everything is good.
 */
async function validateAuthPrerequisites(toolName: string): Promise<string | null> {
  // Check for client ID first - without this, auth/refresh will fail
  const clientId = await getGDriveClientId();
  if (!clientId) {
    const errorMessage = 'Google Drive Client ID not found. Cannot authenticate without a Client ID. Please configure EXPO_PUBLIC_GOOGLE_API_CLIENT_ID in your environment.';
    log.error(`[google_drive] ${toolName} - Missing Client ID`, {}, {
      hasClientId: false,
      errorMessage,
    });
    return JSON.stringify({
      success: false,
      group: 'google_drive',
      tool: toolName,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // Check for access token
  const accessToken = await getGDriveAccessToken();
  if (!accessToken) {
    const errorMessage = 'Google Drive access token not found. Please authenticate first.';
    log.error(`[google_drive] ${toolName} - No access token available`, {}, {
      hasClientId: true,
      clientIdLength: clientId.length,
      hasAccessToken: false,
    });
    return JSON.stringify({
      success: false,
      group: 'google_drive',
      tool: toolName,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // All good - log that we have everything we need
  log.info(`[google_drive] ${toolName} - Auth prerequisites validated`, {}, {
    hasClientId: true,
    clientIdLength: clientId.length,
    hasAccessToken: true,
    tokenLength: accessToken.length,
  });

  return null;
}

/**
 * Refresh the Google Drive access token using the refresh token.
 *
 * This function:
 * 1. Fetches the refresh token and client ID from secure storage
 * 2. Calls Google's OAuth2 token endpoint to get a new access token
 * 3. PERSISTS the new token to secure storage via setGDriveAccessToken()
 * 4. Also stores in globalThis as a fallback
 * 5. Returns the new access token for immediate use
 *
 * Future calls to getGDriveAccessToken() will pick up the refreshed token
 * from secure storage automatically.
 *
 * @param toolName - Name of the tool requesting refresh (for logging)
 * @returns The new access token or null if refresh fails
 */
async function refreshAccessToken(toolName: string): Promise<string | null> {
  try {
    const refreshToken = await getGDriveRefreshToken();
    const clientId = await getGDriveClientId();

    if (!refreshToken || !clientId) {
      log.warn(`[${toolName}] Cannot refresh token - missing credentials`, {}, {
        hasRefreshToken: !!refreshToken,
        hasClientId: !!clientId,
      });
      return null;
    }

    log.info(`[${toolName}] Refreshing Google Drive access token`, {});

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString();

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      log.error(`[${toolName}] Token refresh failed`, {}, {
        status: resp.status,
        statusText: resp.statusText,
        errorBody: txt,
      });
      return null;
    }

    const json = await resp.json();
    const newAccessToken: string | undefined = json?.access_token;

    if (!newAccessToken) {
      log.error(`[${toolName}] Token refresh response missing access_token`, {}, { response: json });
      return null;
    }

    // Persist the new token to secure storage
    try {
      await setGDriveAccessToken(newAccessToken, json?.expires_in);
      log.info(`[${toolName}] Token saved to secure storage`, {}, {
        tokenLength: newAccessToken.length,
        expiresIn: json?.expires_in,
      });
    } catch (e) {
      log.warn(`[${toolName}] Failed to persist refreshed token to secure storage, using in-memory only`, {}, {
        errorMessage: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      }, e);
    }

    // Also set in global scope as fallback (for consistency with legacy tools)
    (globalThis as any).gdriveAccessToken = newAccessToken;

    log.info(`[${toolName}] Token refreshed successfully`, {}, {
      tokenLength: newAccessToken.length,
      expiresIn: json?.expires_in,
      persistedToStorage: true,
    });

    return newAccessToken;
  } catch (error) {
    log.error(`[${toolName}] Token refresh exception`, {}, {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    }, error);
    return null;
  }
}

/**
 * Wrapper around fetch that automatically refreshes the token and retries once on 401.
 * This is your friendly neighborhood token guardian - handles auth failures gracefully.
 *
 * @param toolName - Name of the tool for logging (e.g., 'search_documents')
 * @param url - The URL to fetch
 * @param init - Fetch init options (must include Authorization header)
 * @returns The fetch response
 */
async function fetchWithTokenRefresh(
  toolName: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  // First attempt
  const response = await fetch(url, init);

  // If not a 401, return as-is
  if (response.status !== 401) {
    return response;
  }

  // Got a 401 - let's try to refresh the token
  log.info(`[${toolName}] 401 Unauthorized - attempting token refresh`, {}, { url });

  const newToken = await refreshAccessToken(toolName);
  if (!newToken) {
    log.warn(`[${toolName}] Token refresh failed, returning original 401 response`, {}, { url });
    return response;
  }

  // Update the Authorization header with the new token
  const retryInit: RequestInit = {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${newToken}`,
    },
  };

  // Retry the request
  log.info(`[${toolName}] Retrying request with refreshed token`, {}, { url });
  try {
    const retryResponse = await fetch(url, retryInit);
    return retryResponse;
  } catch (error) {
    log.error(`[${toolName}] Retry after refresh failed`, {}, {
      url,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    }, error);
    return response; // Return original 401 response
  }
}

/**
 * Remove undefined/null values from an object
 */
function removeNoneValues(params: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Build a query string for Google Drive files list
 */
function buildFilesListQuery(
  mimeType: string,
  documentContains?: string[],
  documentNotContains?: string[]
): string {
  const query: string[] = [`(mimeType = '${mimeType}' and trashed = false)`];

  if (documentContains && documentContains.length > 0) {
    for (const keyword of documentContains) {
      const nameContains = keyword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const fullTextContains = keyword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const keywordQuery = `(name contains '${nameContains}' or fullText contains '${fullTextContains}')`;
      query.push(keywordQuery);
    }
  }

  if (documentNotContains && documentNotContains.length > 0) {
    for (const keyword of documentNotContains) {
      const nameNotContains = keyword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const fullTextNotContains = keyword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const keywordQuery = `(name not contains '${nameNotContains}' and fullText not contains '${fullTextNotContains}')`;
      query.push(keywordQuery);
    }
  }

  return query.join(' and ');
}

/**
 * Build parameters for Google Drive files list request
 */
function buildFilesListParams(
  mimeType: string,
  pageSize: number,
  orderBy: OrderBy[],
  paginationToken?: string,
  includeSharedDrives?: boolean,
  searchOnlyInSharedDriveId?: string,
  includeOrganizationDomainDocuments?: boolean,
  documentContains?: string[],
  documentNotContains?: string[]
): Record<string, string> {
  const query = buildFilesListQuery(mimeType, documentContains, documentNotContains);

  const params: Record<string, string> = {
    q: query,
    pageSize: String(pageSize),
    orderBy: orderBy.map(o => o.toString()).join(','),
    fields: 'files(id,name,mimeType,modifiedTime,createdTime,owners,parents,driveId,size),nextPageToken',
  };

  if (paginationToken) {
    params.pageToken = paginationToken;
  }

  if (includeSharedDrives || searchOnlyInSharedDriveId || includeOrganizationDomainDocuments) {
    params.includeItemsFromAllDrives = 'true';
    params.supportsAllDrives = 'true';
  }

  if (searchOnlyInSharedDriveId) {
    params.driveId = searchOnlyInSharedDriveId;
    params.corpora = Corpora.DRIVE;
  }

  if (includeOrganizationDomainDocuments) {
    params.corpora = Corpora.DOMAIN;
  }

  return removeNoneValues(params) as Record<string, string>;
}

/**
 * Parse order_by strings to OrderBy enum values
 */
function parseOrderBy(orderByStrings?: string[]): OrderBy[] {
  if (!orderByStrings || orderByStrings.length === 0) {
    return [OrderBy.MODIFIED_TIME_DESC];
  }

  return orderByStrings.map(orderStr => {
    const enumValue = Object.values(OrderBy).find(v => v === orderStr);
    return enumValue ? (OrderBy as any)[Object.keys(OrderBy).find(k => (OrderBy as any)[k] === enumValue)!] : OrderBy.MODIFIED_TIME_DESC;
  });
}

// MARK: - New Toolkit Functions

/**
 * Search for documents in the user's Google Drive.
 */
export async function search_documents(
  params: SearchDocumentsParams,
  context_params?: any,
  toolSessionContext?: ToolSessionContext
): Promise<ToolkitResult> {
  const {
    document_contains,
    document_not_contains,
    search_only_in_shared_drive_id,
    include_shared_drives = false,
    include_organization_domain_documents = false,
    order_by,
    limit = 50,
    pagination_token,
  } = params;

  log.info('[google_drive] search_documents called', {}, { params });

  try {
    // Validate auth prerequisites (client ID + access token)
    const validationError = await validateAuthPrerequisites('search_documents');
    if (validationError) {
      return validationError;
    }

    // Get the validated access token and client ID
    const accessToken = await getGDriveAccessToken();
    const clientId = await getGDriveClientId();

    const orderByEnums = parseOrderBy(order_by);
    const pageSize = Math.min(10, limit);
    const files: any[] = [];
    let nextPageToken: string | undefined = pagination_token;

    while (files.length < limit) {
      const requestParams = buildFilesListParams(
        GOOGLE_DOCS_MIME_TYPE,
        pageSize,
        orderByEnums,
        nextPageToken,
        include_shared_drives,
        search_only_in_shared_drive_id,
        include_organization_domain_documents,
        document_contains,
        document_not_contains
      );

      const searchParams = new URLSearchParams(requestParams);
      const url = `${DRIVE_API_BASE_URL}/files?${searchParams.toString()}`;

      const response = await fetchWithTokenRefresh('search_documents', url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error('[google_drive] Drive API request failed', {}, {
          status: response.status,
          statusText: response.statusText,
          errorText,
          url,
          tokenLength: accessToken!.length,
          clientIdLength: clientId!.length,
          hasClientId: !!clientId,
          hasAccessToken: !!accessToken,
        });
        throw new Error(`Drive API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const batch = data.files || [];
      files.push(...batch.slice(0, limit - files.length));

      nextPageToken = data.nextPageToken;
      if (!nextPageToken || batch.length < pageSize) {
        break;
      }
    }

    log.info('[google_drive] search_documents completed', {}, {
      count: files.length,
    });

    return {
      result: JSON.stringify({
        success: true,
        group: 'google_drive',
        tool: 'search_documents',
        documents_count: files.length,
        documents: files,
        timestamp: new Date().toISOString(),
      }),
      updatedToolSessionContext: {},
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[google_drive] search_documents failed', {}, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return {
      result: JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'search_documents',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
      updatedToolSessionContext: {},
    };
  }
}

/**
 * List children of a Google Drive folder (or root if no folder_id provided).
 *
 * @param params.folder_id - The folder ID to list children of (undefined = root)
 * @param params.page_size - Number of files to return per page (default: 5)
 * @param params.page_token - Pagination token to continue a previous request
 */
export async function list_drive_folder_children(
  params: ListDriveFolderChildrenParams,
  context_params?: any,
  toolSessionContext?: ToolSessionContext
): Promise<ToolkitResult> {
  const {
    folder_id,
    page_size = DEFAULT_PAGE_SIZE,
    page_token,
  } = params;

  log.info('[google_drive] list_drive_folder_children called', {}, { params });

  try {
    // Validate auth prerequisites (client ID + access token)
    const validationError = await validateAuthPrerequisites('list_drive_folder_children');
    if (validationError) {
      return validationError;
    }

    // Get the validated access token and client ID
    const accessToken = await getGDriveAccessToken();
    const clientId = await getGDriveClientId();

    // Build query parts
    const qParts: string[] = ['trashed = false'];

    if (folder_id) {
      // List children of that folder – escape to keep Drive query well-formed
      const safeFolderId = folder_id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      qParts.push(`'${safeFolderId}' in parents`);
    } else {
      // Root folder list – use 'root' as special id
      qParts.push(`'root' in parents`);
    }

    const requestParams: Record<string, string> = {
      q: qParts.join(' and '),
      pageSize: page_size.toString(),
      fields: 'nextPageToken, files(id, name, mimeType, parents)',
      spaces: 'drive',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    };

    if (page_token) {
      requestParams.pageToken = page_token;
    }

    const searchParams = new URLSearchParams(requestParams);
    const url = `${DRIVE_API_BASE_URL}/files?${searchParams.toString()}`;

    const response = await fetchWithTokenRefresh('list_drive_folder_children', url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('[google_drive] Drive API request failed', {}, {
        status: response.status,
        statusText: response.statusText,
        errorText,
        url,
        tokenLength: accessToken!.length,
        clientIdLength: clientId!.length,
        hasClientId: !!clientId,
        hasAccessToken: !!accessToken,
      });
      throw new Error(`Drive API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      nextPageToken?: string;
      files?: Array<{
        id: string;
        name: string;
        mimeType?: string;
        parents?: string[];
      }>;
    };

    const files = data.files ?? [];
    const nextPageToken = data.nextPageToken;

    log.info('[google_drive] list_drive_folder_children completed', {}, {
      folder_id: folder_id || 'root',
      count: files.length,
      hasNextPage: !!nextPageToken,
    });

    return {
      result: JSON.stringify({
        success: true,
        group: 'google_drive',
        tool: 'list_drive_folder_children',
        folder_id: folder_id || 'root',
        files,
        next_page_token: nextPageToken,
        timestamp: new Date().toISOString(),
      }),
      updatedToolSessionContext: {},
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[google_drive] list_drive_folder_children failed', {}, {
      folder_id: folder_id || 'root',
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return {
      result: JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'list_drive_folder_children',
        error: errorMessage,
        folder_id: folder_id || 'root',
        timestamp: new Date().toISOString(),
      }),
      updatedToolSessionContext: {},
    };
  }
}

/**
 * Get the content of a Google Drive file.
 * Supports Google Docs, PDFs, and plain text files.
 *
 * @param params.file_id - The file ID to get content from
 * @param params.file_name - Optional file name (for logging/output)
 * @param params.mime_type - Optional mime type (if not provided, will be fetched)
 */
export async function get_gdrive_file_content(
  params: GetGDriveFileContentParams,
  context_params?: any,
  toolSessionContext?: ToolSessionContext
): Promise<ToolkitResult> {
  const { file_id, file_name, mime_type } = params;

  const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB limit
  const INCLUDE_ALL_DRIVES = 'true';

  log.info('[google_drive] get_gdrive_file_content called', {}, { params });

  try {
    // Validate auth prerequisites
    const validationError = await validateAuthPrerequisites('get_gdrive_file_content');
    if (validationError) {
      return validationError;
    }

    // Get the validated access token
    const accessToken = await getGDriveAccessToken();

    // Helper to make authenticated requests
    const authFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      return fetchWithTokenRefresh('get_gdrive_file_content', url, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${accessToken}`,
        },
      });
    };

    const fetchJSON = async (url: string, init?: RequestInit): Promise<any> => {
      const response = await authFetch(url, init);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Drive API error ${response.status}: ${errorText}`);
      }
      return response.json();
    };

    // Step 1: Get file metadata if mime_type not provided
    let actualMimeType = mime_type;
    let actualFileName = file_name;
    let fileSize: number | null = null;

    if (!actualMimeType) {
      const metaUrl = `${DRIVE_API_BASE_URL}/files/${encodeURIComponent(file_id)}?fields=id,name,mimeType,size&supportsAllDrives=${INCLUDE_ALL_DRIVES}`;
      const meta = await fetchJSON(metaUrl);

      actualMimeType = meta.mimeType;
      actualFileName = meta.name || file_name;
      fileSize = typeof meta.size === 'string' ? parseInt(meta.size, 10) : (meta.size || null);

      log.info('[google_drive] get_gdrive_file_content - fetched metadata', {}, {
        file_id,
        mimeType: actualMimeType,
        name: actualFileName,
        size: fileSize,
      });
    }

    // Step 2: Handle different file types
    if (actualMimeType === GOOGLE_DOCS_MIME_TYPE) {
      // Handle Google Docs - export as plain text
      log.info('[google_drive] get_gdrive_file_content - exporting Google Doc', {}, { file_id });

      const exportUrl = `${DRIVE_API_BASE_URL}/files/${encodeURIComponent(file_id)}/export?${new URLSearchParams({
        mimeType: 'text/plain',
        supportsAllDrives: INCLUDE_ALL_DRIVES,
      }).toString()}`;

      const response = await authFetch(exportUrl);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Drive API error ${response.status}: ${errorText}`);
      }

      const text = await response.text();

      log.info('[google_drive] get_gdrive_file_content - Google Doc exported', {}, {
        file_id,
        textLength: text.length,
      });

      return {
        result: JSON.stringify({
          success: true,
          group: 'google_drive',
          tool: 'get_gdrive_file_content',
          file_id,
          name: actualFileName || null,
          mime_type: actualMimeType,
          content: text,
          timestamp: new Date().toISOString(),
        }),
        updatedToolSessionContext: {},
      };

    } else if (actualMimeType === 'application/pdf') {
      // Handle PDF - convert to temp Google Doc, export as text, delete temp doc
      log.info('[google_drive] get_gdrive_file_content - processing PDF', {}, { file_id, size: fileSize });

      // Check size limit
      if (fileSize && fileSize > MAX_PDF_BYTES) {
        throw new Error(`PDF too large (${fileSize} bytes). Cap is ${MAX_PDF_BYTES} bytes.`);
      }

      // Convert PDF to temporary Google Doc
      const copyUrl = `${DRIVE_API_BASE_URL}/files/${encodeURIComponent(file_id)}/copy?supportsAllDrives=${INCLUDE_ALL_DRIVES}`;
      const copyBody = {
        name: `${actualFileName || 'PDF'} (temp text extract)`,
        mimeType: GOOGLE_DOCS_MIME_TYPE,
      };

      log.info('[google_drive] get_gdrive_file_content - creating temp Google Doc from PDF', {}, { file_id });

      const tempFile = await fetchJSON(copyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(copyBody),
      });

      if (!tempFile || !tempFile.id) {
        throw new Error('Failed to create temporary Google Doc.');
      }

      const tempFileId = tempFile.id;
      log.info('[google_drive] get_gdrive_file_content - temp doc created', {}, { tempFileId });

      try {
        // Export the temp doc as text
        const exportUrl = `${DRIVE_API_BASE_URL}/files/${encodeURIComponent(tempFileId)}/export?mimeType=text/plain&supportsAllDrives=${INCLUDE_ALL_DRIVES}`;

        const exportResponse = await authFetch(exportUrl);
        if (!exportResponse.ok) {
          const errorText = await exportResponse.text();
          throw new Error(`Drive API error ${exportResponse.status}: ${errorText}`);
        }

        const text = await exportResponse.text();

        log.info('[google_drive] get_gdrive_file_content - PDF exported as text', {}, {
          file_id,
          textLength: text.length,
        });

        // Cleanup - delete temp doc
        const deleteUrl = `${DRIVE_API_BASE_URL}/files/${encodeURIComponent(tempFileId)}?supportsAllDrives=${INCLUDE_ALL_DRIVES}`;
        await authFetch(deleteUrl, { method: 'DELETE' })
          .catch(err => {
            log.warn('[google_drive] get_gdrive_file_content - temp doc cleanup failed (ignored)', {}, {
              tempFileId,
              error: String(err),
            });
          });

        return {
          result: JSON.stringify({
            success: true,
            group: 'google_drive',
            tool: 'get_gdrive_file_content',
            file_id,
            name: actualFileName || null,
            mime_type: actualMimeType,
            bytes: fileSize,
            content: text,
            timestamp: new Date().toISOString(),
          }),
          updatedToolSessionContext: {},
        };

      } catch (error) {
        // Cleanup on error - delete temp doc
        log.warn('[google_drive] get_gdrive_file_content - error during PDF processing, cleaning up temp doc', {}, {
          tempFileId,
          error: error instanceof Error ? error.message : String(error),
        });

        const deleteUrl = `${DRIVE_API_BASE_URL}/files/${encodeURIComponent(tempFileId)}?supportsAllDrives=${INCLUDE_ALL_DRIVES}`;
        await authFetch(deleteUrl, { method: 'DELETE' })
          .catch(err => {
            log.warn('[google_drive] get_gdrive_file_content - temp doc cleanup failed (ignored)', {}, {
              tempFileId,
              error: String(err),
            });
          });

        throw error;
      }

    } else if (actualMimeType === 'text/plain' || actualMimeType?.startsWith('text/')) {
      // Handle plain text files - download directly
      log.info('[google_drive] get_gdrive_file_content - downloading text file', {}, { file_id, mimeType: actualMimeType });

      const downloadUrl = `${DRIVE_API_BASE_URL}/files/${encodeURIComponent(file_id)}?alt=media&supportsAllDrives=${INCLUDE_ALL_DRIVES}`;

      const response = await authFetch(downloadUrl);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Drive API error ${response.status}: ${errorText}`);
      }

      const text = await response.text();

      log.info('[google_drive] get_gdrive_file_content - text file downloaded', {}, {
        file_id,
        textLength: text.length,
      });

      return {
        result: JSON.stringify({
          success: true,
          group: 'google_drive',
          tool: 'get_gdrive_file_content',
          file_id,
          name: actualFileName || null,
          mime_type: actualMimeType,
          content: text,
          timestamp: new Date().toISOString(),
        }),
        updatedToolSessionContext: {},
      };

    } else {
      // Unsupported file type
      const errorMessage = `Unsupported file type: ${actualMimeType}. We currently support Google Docs (application/vnd.google-apps.document), PDFs (application/pdf), and text files (text/*).`;

      log.warn('[google_drive] get_gdrive_file_content - unsupported file type', {}, {
        file_id,
        mimeType: actualMimeType,
      });

      return {
        result: JSON.stringify({
          success: false,
          group: 'google_drive',
          tool: 'get_gdrive_file_content',
          error: errorMessage,
          file_id,
          name: actualFileName || null,
          mime_type: actualMimeType,
          timestamp: new Date().toISOString(),
        }),
        updatedToolSessionContext: {},
      };
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[google_drive] get_gdrive_file_content failed', {}, {
      file_id,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return {
      result: JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'get_gdrive_file_content',
        error: errorMessage,
        file_id,
        timestamp: new Date().toISOString(),
      }),
      updatedToolSessionContext: {},
    };
  }
}


import { log } from '../../../../lib/logger';
import {
  getGDriveAccessToken,
  getGDriveRefreshToken,
  getGDriveClientId,
  setGDriveAccessToken,
} from '../../../../lib/secure-storage';

// MARK: - Constants

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DOCS_API_BASE_URL = 'https://www.googleapis.com/docs/v1';
const DEFAULT_PAGE_SIZE = 40;
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

enum DocumentFormat {
  MARKDOWN = 'markdown',
  HTML = 'html',
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

export interface SearchAndRetrieveDocumentsParams extends SearchDocumentsParams {
  return_format?: string;
}

export interface GetFileTreeStructureParams {
  include_shared_drives?: boolean;
  restrict_to_shared_drive_id?: string;
  include_organization_domain_documents?: boolean;
  order_by?: string[];
  limit?: number;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  owners?: Array<{ emailAddress?: string }>;
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
export async function keyword_search(params: KeywordSearchParams): Promise<string> {
  const { query } = params;

  const safeKeyword = String(query || '').trim();

  if (!safeKeyword) {
    const errorMessage = 'Missing search keyword';
    log.error('[google_drive] keyword_search validation failed', {}, { query });
    return JSON.stringify({
      success: false,
      group: 'google_drive',
      tool: 'keyword_search',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
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
    // Retrieve access token from secure storage
    const accessToken = await getGDriveAccessToken();

    if (!accessToken) {
      const errorMessage = 'Google Drive access token not found. Please authenticate first.';
      log.error('[google_drive] No access token available', {}, {
        query: safeKeyword,
      });
      return JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'keyword_search',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    // Log token info (length only, not the actual token for security)
    log.info('[google_drive] Using access token', {}, {
      tokenLength: accessToken.length,
      hasToken: true,
    });

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
        tokenLength: accessToken.length,
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

    return JSON.stringify({
      success: true,
      group: 'google_drive',
      tool: 'keyword_search',
      query: safeKeyword,
      files,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[google_drive] keyword_search failed', {}, {
      query: safeKeyword,
      url,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return JSON.stringify({
      success: false,
      group: 'google_drive',
      tool: 'keyword_search',
      error: errorMessage,
      query: safeKeyword,
      timestamp: new Date().toISOString(),
    });
  }
}

// MARK: - Helper Functions

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
      const nameContains = keyword.replace(/'/g, "\\'");
      const fullTextContains = keyword.replace(/'/g, "\\'");
      const keywordQuery = `(name contains '${nameContains}' or fullText contains '${fullTextContains}')`;
      query.push(keywordQuery);
    }
  }

  if (documentNotContains && documentNotContains.length > 0) {
    for (const keyword of documentNotContains) {
      const nameNotContains = keyword.replace(/'/g, "\\'");
      const fullTextNotContains = keyword.replace(/'/g, "\\'");
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
 * Build parameters for file tree request
 */
function buildFileTreeRequestParams(
  orderBy: OrderBy[] | null,
  pageToken: string | null,
  limit: number | null,
  includeSharedDrives: boolean,
  restrictToSharedDriveId: string | null,
  includeOrganizationDomainDocuments: boolean
): Record<string, string> {
  const orderByList = orderBy || [OrderBy.MODIFIED_TIME_DESC];

  const params: Record<string, string> = {
    q: 'trashed = false',
    corpora: Corpora.USER,
    fields: 'files(id,name,parents,mimeType,driveId,size,createdTime,modifiedTime,owners),nextPageToken',
    orderBy: orderByList.map(o => o.toString()).join(','),
  };

  if (pageToken) {
    params.pageToken = pageToken;
  }

  if (limit) {
    params.pageSize = String(limit);
  }

  if (includeSharedDrives || restrictToSharedDriveId || includeOrganizationDomainDocuments) {
    params.includeItemsFromAllDrives = 'true';
    params.supportsAllDrives = 'true';
  }

  if (restrictToSharedDriveId) {
    params.driveId = restrictToSharedDriveId;
    params.corpora = Corpora.DRIVE;
  }

  if (includeOrganizationDomainDocuments) {
    params.corpora = Corpora.DOMAIN;
  }

  return removeNoneValues(params) as Record<string, string>;
}

/**
 * Build file tree from flat list of files
 */
function buildFileTree(files: Record<string, any>): Record<string, any[]> {
  const fileTree: Record<string, any[]> = {};

  for (const [fileId, file] of Object.entries(files)) {
    // Process owners
    if (file.owners && Array.isArray(file.owners)) {
      file.owners = file.owners.map((owner: any) => ({
        name: owner.displayName || '',
        email: owner.emailAddress || '',
      }));
    }

    // Process size
    if (file.size) {
      file.size = { value: parseInt(file.size), unit: 'bytes' };
    }

    // Get parent ID (a file can only have one parent)
    let parentId: string | null = null;
    if (file.parents && Array.isArray(file.parents) && file.parents.length > 0) {
      parentId = file.parents[0];
      delete file.parents;
    }

    // Determine the file's Drive ID
    const driveId = file.driveId || 'My Drive';
    if (file.driveId) {
      delete file.driveId;
    }

    if (!fileTree[driveId]) {
      fileTree[driveId] = [];
    }

    // Root files will have the Drive's id as the parent
    if (!parentId || !files[parentId]) {
      fileTree[driveId].push(file);
    } else {
      // Associate the file with its parent
      if (!files[parentId].children) {
        files[parentId].children = [];
      }
      files[parentId].children.push(file);
    }
  }

  return fileTree;
}

/**
 * Get document content from Google Docs API
 */
async function getDocumentContentById(documentId: string, accessToken: string): Promise<any> {
  const url = `${DOCS_API_BASE_URL}/documents/${documentId}`;

  log.info('[google_drive] Fetching document content', {}, { documentId });

  const response = await fetchWithTokenRefresh('get_document_content', url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error('[google_drive] Docs API request failed', {}, {
      status: response.status,
      statusText: response.statusText,
      errorText,
      documentId,
    });
    throw new Error(`Docs API error: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Convert Google Docs document to markdown (basic implementation)
 * Note: This is a simplified conversion. For production use, consider a more robust solution.
 */
function convertDocumentToMarkdown(document: any): string {
  const title = document.title || 'Untitled';
  const body = document.body?.content || [];

  let markdown = `# ${title}\n\n`;

  for (const element of body) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      let text = '';

      if (paragraph.elements) {
        for (const elem of paragraph.elements) {
          if (elem.textRun && elem.textRun.content) {
            text += elem.textRun.content;
          }
        }
      }

      if (text.trim()) {
        markdown += text + '\n\n';
      }
    }
  }

  return markdown;
}

/**
 * Convert Google Docs document to HTML (basic implementation)
 * Note: This is a simplified conversion. For production use, consider a more robust solution.
 */
function convertDocumentToHtml(document: any): string {
  const title = document.title || 'Untitled';
  const body = document.body?.content || [];

  let html = `<h1>${title}</h1>\n`;

  for (const element of body) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      let text = '';

      if (paragraph.elements) {
        for (const elem of paragraph.elements) {
          if (elem.textRun && elem.textRun.content) {
            text += elem.textRun.content;
          }
        }
      }

      if (text.trim()) {
        html += `<p>${text}</p>\n`;
      }
    }
  }

  return html;
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
export async function search_documents(params: SearchDocumentsParams): Promise<string> {
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
    const accessToken = await getGDriveAccessToken();

    if (!accessToken) {
      const errorMessage = 'Google Drive access token not found. Please authenticate first.';
      log.error('[google_drive] No access token available', {}, {});
      return JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'search_documents',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

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

    return JSON.stringify({
      success: true,
      group: 'google_drive',
      tool: 'search_documents',
      documents_count: files.length,
      documents: files,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[google_drive] search_documents failed', {}, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return JSON.stringify({
      success: false,
      group: 'google_drive',
      tool: 'search_documents',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Search and retrieve the contents of Google documents in the user's Google Drive.
 */
export async function search_and_retrieve_documents(params: SearchAndRetrieveDocumentsParams): Promise<string> {
  const { return_format = 'markdown', ...searchParams } = params;

  log.info('[google_drive] search_and_retrieve_documents called', {}, { params });

  try {
    const accessToken = await getGDriveAccessToken();

    if (!accessToken) {
      const errorMessage = 'Google Drive access token not found. Please authenticate first.';
      log.error('[google_drive] No access token available', {}, {});
      return JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'search_and_retrieve_documents',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    // First search for documents
    const searchResultStr = await search_documents(searchParams);
    const searchResult = JSON.parse(searchResultStr);

    if (!searchResult.success) {
      return searchResultStr;
    }

    const documents = [];
    for (const item of searchResult.documents) {
      try {
        const document = await getDocumentContentById(item.id, accessToken);

        // Convert document content to requested format
        let documentBody: string;
        if (return_format === DocumentFormat.HTML) {
          documentBody = convertDocumentToHtml(document);
        } else {
          documentBody = convertDocumentToMarkdown(document);
        }

        // Extract only useful fields
        const filteredDocument = {
          title: document.title || '',
          body: documentBody,
          documentId: document.documentId || item.id,
        };

        documents.push(filteredDocument);
      } catch (error) {
        log.error('[google_drive] Failed to retrieve document', {}, {
          documentId: item.id,
          error: error instanceof Error ? error.message : String(error),
        }, error);
        // Continue with other documents
      }
    }

    log.info('[google_drive] search_and_retrieve_documents completed', {}, {
      count: documents.length,
    });

    return JSON.stringify({
      success: true,
      group: 'google_drive',
      tool: 'search_and_retrieve_documents',
      documents_count: documents.length,
      documents: documents,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[google_drive] search_and_retrieve_documents failed', {}, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return JSON.stringify({
      success: false,
      group: 'google_drive',
      tool: 'search_and_retrieve_documents',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get the file/folder tree structure of the user's Google Drive.
 */
export async function get_file_tree_structure(params: GetFileTreeStructureParams): Promise<string> {
  const {
    include_shared_drives = false,
    restrict_to_shared_drive_id,
    include_organization_domain_documents = false,
    order_by,
    limit,
  } = params;

  log.info('[google_drive] get_file_tree_structure called', {}, { params });

  try {
    const accessToken = await getGDriveAccessToken();

    if (!accessToken) {
      const errorMessage = 'Google Drive access token not found. Please authenticate first.';
      log.error('[google_drive] No access token available', {}, {});
      return JSON.stringify({
        success: false,
        group: 'google_drive',
        tool: 'get_file_tree_structure',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    const orderByEnums = parseOrderBy(order_by);
    let keepPaginating = true;
    let pageToken: string | null = null;
    const files: Record<string, any> = {};

    while (keepPaginating) {
      const requestParams = buildFileTreeRequestParams(
        orderByEnums,
        pageToken,
        limit || null,
        include_shared_drives,
        restrict_to_shared_drive_id || null,
        include_organization_domain_documents
      );

      const searchParams = new URLSearchParams(requestParams);
      const url = `${DRIVE_API_BASE_URL}/files?${searchParams.toString()}`;

      const response = await fetchWithTokenRefresh('get_file_tree_structure', url, {
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
        });
        throw new Error(`Drive API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const batch = data.files || [];

      for (const file of batch) {
        files[file.id] = file;
      }

      pageToken = data.nextPageToken || null;
      keepPaginating = pageToken !== null;
    }

    if (Object.keys(files).length === 0) {
      return JSON.stringify({
        success: true,
        group: 'google_drive',
        tool: 'get_file_tree_structure',
        drives: [],
        timestamp: new Date().toISOString(),
      });
    }

    const fileTree = buildFileTree(files);
    const drives = [];

    for (const [driveId, driveFiles] of Object.entries(fileTree)) {
      if (driveId === 'My Drive') {
        drives.push({
          name: 'My Drive',
          children: driveFiles,
        });
      } else {
        // Fetch drive name
        let driveName = `Shared Drive (id: ${driveId})`;
        try {
          const driveUrl = `${DRIVE_API_BASE_URL}/drives/${driveId}`;
          const driveResponse = await fetchWithTokenRefresh('get_file_tree_structure', driveUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (driveResponse.ok) {
            const driveData = await driveResponse.json();
            driveName = driveData.name || driveName;
          }
        } catch (error) {
          log.error('[google_drive] Failed to fetch drive name', {}, {
            driveId,
            error: error instanceof Error ? error.message : String(error),
          }, error);
        }

        drives.push({
          name: driveName,
          id: driveId,
          children: driveFiles,
        });
      }
    }

    log.info('[google_drive] get_file_tree_structure completed', {}, {
      driveCount: drives.length,
    });

    return JSON.stringify({
      success: true,
      group: 'google_drive',
      tool: 'get_file_tree_structure',
      drives: drives,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[google_drive] get_file_tree_structure failed', {}, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return JSON.stringify({
      success: false,
      group: 'google_drive',
      tool: 'get_file_tree_structure',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
}

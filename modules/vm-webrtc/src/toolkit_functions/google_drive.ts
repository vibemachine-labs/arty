import { log } from '../../../../lib/logger';
import { getGDriveAccessToken } from '../../../../lib/secure-storage';

// MARK: - Constants

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DEFAULT_PAGE_SIZE = 40;

// MARK: - Types

export interface KeywordSearchParams {
  query: string;
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

    const response = await fetch(url, {
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

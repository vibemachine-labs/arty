import { log } from '../../../../lib/logger';

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
  const escapedKeyword = safeKeyword.replace(/'/g, "\\'");

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
    // TODO: Wire up authentication - accessToken needs to be provided
    // This will be implemented when wiring up the OAuth flow
    const accessToken = ''; // Placeholder - needs to be wired up

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
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

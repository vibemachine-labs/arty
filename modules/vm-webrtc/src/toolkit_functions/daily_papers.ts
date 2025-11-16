import { log } from '../../../../lib/logger';

// MARK: - Types

export interface ShowDailyPapersParams {
  region: string;
  limit?: number;
}

export interface GetPaperDetailsParams {
  arxivId: string;
}

// MARK: - Functions

/**
 * Retrieve a list of today's daily papers from major publications.
 */
export async function showDailyPapers(params: ShowDailyPapersParams): Promise<string> {
  const { region, limit } = params;

  log.info('[daily_papers] showDailyPapers called', {}, { region, limit });

  try {
    // Build API URL
    const url = new URL('https://huggingface.co/api/daily_papers');

    // Add optional date parameter if provided via region (can be wired up later)
    // For now, we'll use today's date by default (API behavior)

    // Add limit parameter if provided
    if (limit) {
      url.searchParams.set('limit', limit.toString());
    }

    log.info('[daily_papers] Fetching from API', {}, { url: url.toString() });

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return JSON.stringify({
      success: true,
      region,
      papers: data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log.error('[daily_papers] Error fetching daily papers', {}, { error });
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Get paper details including metadata like authors, summary, and discussion comments.
 */
export async function getPaperDetails(params: GetPaperDetailsParams): Promise<string> {
  const { arxivId } = params;

  log.info('[daily_papers] getPaperDetails called', {}, { arxivId });

  try {
    // Build API URL
    const url = `https://huggingface.co/api/papers/${arxivId}`;

    log.info('[daily_papers] Fetching paper details from API', {}, { url });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return JSON.stringify({
      success: true,
      paper: data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log.error('[daily_papers] Error fetching paper details', {}, { error, arxivId });
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      arxivId,
      timestamp: new Date().toISOString()
    });
  }
}

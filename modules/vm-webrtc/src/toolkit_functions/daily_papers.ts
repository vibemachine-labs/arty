import { log } from '../../../../lib/logger';

// MARK: - Types

export interface ShowDailyPapersParams {
  p?: number;
  limit?: number;
  date?: string;
  week?: string;
  month?: string;
  submitter?: string;
  sort?: 'publishedAt' | 'trending';
}

export interface GetPaperDetailsParams {
  arxivId: string;
}

// MARK: - Functions

/**
 * Retrieve a list of daily papers from Hugging Face.
 */
export async function showDailyPapers(params: ShowDailyPapersParams): Promise<string> {
  const { p = 0, limit = 5, date, week, month, submitter, sort = 'trending' } = params;

  log.info('[daily_papers] showDailyPapers called', {}, { p, limit, date, week, month, submitter, sort, allParams: params });

  try {
    // Build API URL
    const url = new URL('https://huggingface.co/api/daily_papers');

    // Add pagination parameter (p is 0-based page index)
    url.searchParams.set('p', p.toString());

    // Add limit parameter (defaults to 5, max 100)
    url.searchParams.set('limit', limit.toString());

    // Add optional filter parameters
    if (date) {
      url.searchParams.set('date', date);
    }
    if (week) {
      url.searchParams.set('week', week);
    }
    if (month) {
      url.searchParams.set('month', month);
    }
    if (submitter) {
      url.searchParams.set('submitter', submitter);
    }

    // Add sort parameter
    url.searchParams.set('sort', sort);

    log.info('[daily_papers] Fetching from API', {}, { url: url.toString() });

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    const result = {
      success: true,
      filters: { date, week, month, submitter, sort },
      pagination: { p, limit },
      papers: data,
      timestamp: new Date().toISOString()
    };

    log.debug('[daily_papers] showDailyPapers result', {}, result);

    return JSON.stringify(result);
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

  log.info('[daily_papers] getPaperDetails called', {}, { arxivId, allParams: params });

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

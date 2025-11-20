import { log } from '../../../../lib/logger';
import { getContentsFromUrl } from './web';

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

export interface SearchDailyPapersParams {
  q: string;
  limit?: number;
}

export interface GetCommentsForPaperParams {
  arxiv_id: string;
}

// MARK: - Helper Functions

/**
 * Extracts comment texts from a Hugging Face paper page HTML.
 * It looks for the <!-- HTML_TAG_START --> ... <!-- HTML_TAG_END --> blocks
 * inside the comment content and strips tags from those chunks.
 */
export function extractHfPaperComments(html: string): string[] {
  const comments: string[] = [];

  // Find all comment HTML blocks between the special markers
  const commentBlocks = [...html.matchAll(
    /<!-- HTML_TAG_START -->([\s\S]*?)<!-- HTML_TAG_END -->/g
  )];

  for (const match of commentBlocks) {
    const innerHtml = match[1] ?? '';

    // Very simple tag stripper to avoid heavy deps / blocking libs
    let text = innerHtml
      // remove all tags
      .replace(/<[^>]+>/g, ' ')
      // collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length > 0) {
      comments.push(text);
    }
  }

  return comments;
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
 * Search daily papers using a query string with hybrid semantic/full-text search.
 */
export async function searchDailyPapers(params: SearchDailyPapersParams): Promise<string> {
  const { q, limit = 5 } = params;

  log.info('[daily_papers] searchDailyPapers called', {}, { q, limit, allParams: params });

  try {
    // Build API URL
    const url = new URL('https://huggingface.co/api/papers/search');
    url.searchParams.set('q', q);

    log.info('[daily_papers] Searching papers from API', {}, { url: url.toString() });

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // API doesn't support limit, so we limit client-side to avoid overwhelming LLM
    const limitedData = Array.isArray(data) ? data.slice(0, limit) : data;

    const result = {
      success: true,
      query: q,
      limit,
      totalResults: Array.isArray(data) ? data.length : 0,
      returnedResults: Array.isArray(limitedData) ? limitedData.length : 0,
      papers: limitedData,
      timestamp: new Date().toISOString()
    };

    log.debug('[daily_papers] searchDailyPapers result', {}, result);

    return JSON.stringify(result);
  } catch (error) {
    log.error('[daily_papers] Error searching daily papers', {}, { error, query: q });
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      query: q,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Get comments for a paper by fetching the HTML from the paper's Hugging Face page.
 */
export async function getCommentsForPaper(params: GetCommentsForPaperParams): Promise<string> {
  const { arxiv_id } = params;

  log.info('[daily_papers] getCommentsForPaper called', {}, { arxiv_id, allParams: params });

  try {
    // Construct the Hugging Face paper URL
    const url = `https://huggingface.co/papers/${arxiv_id}`;

    log.info('[daily_papers] Fetching paper comments from URL', {}, { url });

    // Use the web.ts getContentsFromUrl function with a large maxLength to get full HTML
    // We need ~300K to capture all comments before filtering
    const htmlContent = await getContentsFromUrl(
      { url },
      { maxLength: 300000, minHtmlForBody: 15000, maxRawBytes: 3000000 }
    );

    // Extract comments from the HTML
    const comments = extractHfPaperComments(htmlContent);

    const result = {
      success: true,
      arxiv_id,
      url,
      commentsCount: comments.length,
      comments: comments.length > 0 ? comments : ['No comments found'],
      timestamp: new Date().toISOString()
    };

    log.debug('[daily_papers] getCommentsForPaper result', {}, result);

    return JSON.stringify(result);
  } catch (error) {
    log.error('[daily_papers] Error fetching paper comments', {}, { error, arxiv_id });
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      arxiv_id,
      timestamp: new Date().toISOString()
    });
  }
}

import { log } from '../../../../lib/logger';
import type { ToolSessionContext, ToolkitResult } from './types';

// MARK: - Types

// Constants for default values
const DEFAULT_PAGE = 0;
const DEFAULT_LIMIT = 5;
const COMMENTS_FETCH_TIMEOUT_MS = 45000; // 45 seconds

export interface ShowDailyPapersParams {
  page?: number;
  limit?: number;
  date?: string;
  week?: string;
  month?: string;
  submitter?: string;
  sort?: 'publishedAt' | 'trending';
}

/**
 * Helper function to export ShowDailyPapersParams as a dictionary for session context.
 */
function exportParamsToDict(params: ShowDailyPapersParams): Record<string, string> {
  const dict: Record<string, string> = {};
  
  // Use defaults if not provided
  dict.page = (params.page !== undefined ? params.page : DEFAULT_PAGE).toString();
  dict.limit = (params.limit !== undefined ? params.limit : DEFAULT_LIMIT).toString();
  if (params.date) dict.date = params.date;
  if (params.week) dict.week = params.week;
  if (params.month) dict.month = params.month;
  if (params.submitter) dict.submitter = params.submitter;
  if (params.sort) dict.sort = params.sort;
  
  return dict;
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
 * Postprocess the daily papers API response to reduce size.
 * - Strips avatarUrl from submittedBy (top level)
 * - Strips avatarUrl from paper.submittedOnDailyBy
 * - Strips avatarUrl from paper.authors[].user
 * - Keeps only the first author in authors array
 * - Removes thumbnail URLs
 */
function postprocessDailyPapersResponse(data: any): any {
  if (!Array.isArray(data)) {
    return data;
  }

  return data.map((paper: any) => {
    const processed = { ...paper };

    // Strip avatarUrl from submittedBy (top level)
    if (processed.submittedBy?.avatarUrl) {
      const { avatarUrl, ...rest } = processed.submittedBy;
      processed.submittedBy = rest;
    }

    // Process nested paper object
    if (processed.paper) {
      processed.paper = { ...processed.paper };

      // Strip avatarUrl from paper.submittedOnDailyBy
      if (processed.paper.submittedOnDailyBy?.avatarUrl) {
        const { avatarUrl, ...rest } = processed.paper.submittedOnDailyBy;
        processed.paper.submittedOnDailyBy = rest;
      }

      // Keep only first author and strip avatarUrl from author.user
      if (Array.isArray(processed.paper.authors) && processed.paper.authors.length > 0) {
        const firstAuthor = { ...processed.paper.authors[0] };
        
        // Strip avatarUrl from author.user if present
        if (firstAuthor.user?.avatarUrl) {
          const { avatarUrl, ...rest } = firstAuthor.user;
          firstAuthor.user = rest;
        }
        
        processed.paper.authors = [firstAuthor];
      }
    }

    // Remove thumbnail (top level)
    if (processed.thumbnail) {
      delete processed.thumbnail;
    }

    return processed;
  });
}

// MARK: - Functions

/**
 * Retrieve a list of daily papers from Hugging Face.
 */
export async function showDailyPapers(
  params: ShowDailyPapersParams,
  context_params?: any,
  toolSessionContext?: ToolSessionContext
): Promise<ToolkitResult> {
  // Check for unexpected parameters and warn
  const expectedParams = new Set(['page', 'limit', 'date', 'week', 'month', 'submitter', 'sort']);
  const receivedParams = Object.keys(params);
  const unexpectedParams = receivedParams.filter(p => !expectedParams.has(p));

  if (unexpectedParams.length > 0) {
    log.warn('[daily_papers] Received unexpected parameters', {}, {
      unexpectedParams,
      receivedParams,
      hint: 'Check toolkitGroups.json parameter names match TypeScript interface'
    });
  }

  // Handle page parameter: use provided value if it's a number, otherwise use default
  // This handles the case where page might be false, null, undefined, etc.
  const page = typeof params.page === 'number' ? params.page : DEFAULT_PAGE;
  const limit = typeof params.limit === 'number' ? params.limit : DEFAULT_LIMIT;
  const { date, week, month, submitter, sort = 'trending' } = params;

  log.info('[daily_papers] showDailyPapers called', {}, { page, limit, date, week, month, submitter, sort, allParams: params, toolSessionContext });

  try {
    // Build API URL
    const url = new URL('https://huggingface.co/api/daily_papers');

    // Add pagination parameter (p is 0-based page index)
    url.searchParams.set('p', page.toString());

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

    // Postprocess to reduce response size
    const processedData = postprocessDailyPapersResponse(data);

    const result = {
      success: true,
      filters: { date, week, month, submitter, sort },
      pagination: { page, limit },
      papers: processedData,
      timestamp: new Date().toISOString()
    };

    log.debug('[daily_papers] showDailyPapers result', {}, result);

    return {
      result: JSON.stringify(result),
      updatedToolSessionContext: exportParamsToDict(params),
    };
  } catch (error) {
    log.error('[daily_papers] Error fetching daily papers', {}, { error });
    return {
      result: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      updatedToolSessionContext: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Search daily papers using a query string with hybrid semantic/full-text search.
 */
export async function searchDailyPapers(
  params: SearchDailyPapersParams,
  context_params?: any,
  toolSessionContext?: ToolSessionContext
): Promise<ToolkitResult> {
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

    return {
      result: JSON.stringify(result),
      updatedToolSessionContext: {},
    };
  } catch (error) {
    log.error('[daily_papers] Error searching daily papers', {}, { error, query: q });
    return {
      result: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        query: q,
        timestamp: new Date().toISOString()
      }),
      updatedToolSessionContext: {},
    };
  }
}

/**
 * Get comments for a paper using the Hugging Face API.
 * Fetches comments from https://huggingface.co/api/papers/{arxiv_id}?field=comments
 */
export async function getCommentsForPaper(
  params: GetCommentsForPaperParams,
  context_params?: any,
  toolSessionContext?: ToolSessionContext
): Promise<ToolkitResult> {
  const { arxiv_id } = params;

  log.info('[daily_papers] getCommentsForPaper called', {}, { arxiv_id, allParams: params });

  try {
    // Construct the Hugging Face API URL for fetching comments
    const url = `https://huggingface.co/api/papers/${arxiv_id}?field=comments`;

    log.info('[daily_papers] Fetching paper comments from API', {}, { url, timeout: COMMENTS_FETCH_TIMEOUT_MS });

    // Set up timeout using AbortController
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), COMMENTS_FETCH_TIMEOUT_MS);

    let data;
    try {
      const response = await fetch(url, { signal: abortController.signal });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorMsg = `API request failed: ${response.status} ${response.statusText}`;
        log.warn('[daily_papers] API returned error status', {}, {
          arxiv_id,
          url,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries())
        });
        throw new Error(errorMsg);
      }

      data = await response.json();
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // Check if the error is due to timeout
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        const timeoutMsg = `Request timed out after ${COMMENTS_FETCH_TIMEOUT_MS / 1000} seconds`;
        log.warn('[daily_papers] Request timeout', {}, {
          arxiv_id,
          url,
          timeout: COMMENTS_FETCH_TIMEOUT_MS
        });
        throw new Error(timeoutMsg);
      }

      // Re-throw other errors (will be caught by outer catch block)
      throw fetchError;
    }

    // Extract comments from the response
    const commentsArray = data?.comments || [];

    // Process comments to extract useful information
    const processedComments = commentsArray.map((comment: any) => ({
      id: comment.id,
      author: comment.author?.name || comment.author?.fullname || 'Unknown',
      createdAt: comment.createdAt,
      text: comment.data?.latest?.raw || comment.data?.latest?.html || '',
      numEdits: comment.data?.numEdits || 0
    }));

    const result = {
      success: true,
      arxiv_id,
      url,
      commentsCount: processedComments.length,
      comments: processedComments.length > 0 ? processedComments : ['No comments found'],
      timestamp: new Date().toISOString()
    };

    log.debug('[daily_papers] getCommentsForPaper result', {}, result);

    return {
      result: JSON.stringify(result),
      updatedToolSessionContext: {},
    };
  } catch (error) {
    // Log detailed error information for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    log.error('[daily_papers] Error fetching paper comments', {}, {
      arxiv_id,
      url: `https://huggingface.co/api/papers/${arxiv_id}?field=comments`,
      errorMessage,
      errorName,
      errorStack,
      errorType: typeof error,
      timeout: COMMENTS_FETCH_TIMEOUT_MS
    });

    return {
      result: JSON.stringify({
        success: false,
        error: errorMessage,
        arxiv_id,
        timestamp: new Date().toISOString()
      }),
      updatedToolSessionContext: {},
    };
  }
}

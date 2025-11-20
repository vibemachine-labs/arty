import { log } from '../../../../lib/logger';
import type { ToolSessionContext, ToolkitResult } from './types';
import { fetchWithSsrfProtection } from './web';

// MARK: - Types

// Constants for default values
const DEFAULT_PAGE = 0;
const DEFAULT_LIMIT = 5;

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

/**
 * Strips HTML tags from a string in a simple, memory-efficient way.
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetches web content and extracts Hugging Face paper comments in a memory-efficient streaming fashion.
 * Scans HTML chunks for comment blocks between <!-- HTML_TAG_START --> and <!-- HTML_TAG_END --> markers.
 */
async function getWebContentExtractComments(url: string): Promise<string[]> {
  log.info('[daily_papers] getWebContentExtractComments starting', {}, { url });

  // Use shared SSRF-protected fetch helper with 15 second timeout
  const response = await fetchWithSsrfProtection(url, 15000);

  if (!response.body) {
    throw new Error('Response body not available');
  }

  // Stream and scan for comment blocks
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const comments: string[] = [];
  
  let buffer = '';
  const START_MARKER = '<!-- HTML_TAG_START -->';
  const END_MARKER = '<!-- HTML_TAG_END -->';
  const MAX_BUFFER_SIZE = 500000; // 500KB sliding window
  const MAX_TOTAL_BYTES = 10000000; // 10MB hard limit
  let totalBytesRead = 0;
  let commentCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        log.info('[daily_papers] Stream complete', {}, { 
          totalBytesRead, 
          commentsFound: commentCount 
        });
        break;
      }

      totalBytesRead += value.length;
      buffer += decoder.decode(value, { stream: true });

      // Hard limit check
      if (totalBytesRead >= MAX_TOTAL_BYTES) {
        log.warn('[daily_papers] Reached max total bytes limit', {}, { totalBytesRead });
        break;
      }

      // Scan buffer for complete comment blocks
      let startIdx = 0;
      while (true) {
        const commentStart = buffer.indexOf(START_MARKER, startIdx);
        if (commentStart === -1) break;

        const commentEnd = buffer.indexOf(END_MARKER, commentStart + START_MARKER.length);
        if (commentEnd === -1) {
          // Incomplete block, keep in buffer
          break;
        }

        // Extract and process the comment block
        const commentHtml = buffer.substring(
          commentStart + START_MARKER.length,
          commentEnd
        );
        
        const commentText = stripHtmlTags(commentHtml);
        if (commentText.length > 0) {
          comments.push(commentText);
          commentCount++;
        }

        // Move past this comment block
        startIdx = commentEnd + END_MARKER.length;
      }

      // Trim processed content from buffer, keep unprocessed tail
      if (startIdx > 0) {
        buffer = buffer.substring(startIdx);
      }

      // If buffer grows too large without finding complete blocks, trim it
      if (buffer.length > MAX_BUFFER_SIZE) {
        // Keep last portion that might contain incomplete marker
        const keepSize = Math.max(START_MARKER.length + END_MARKER.length + 10000, 50000);
        buffer = buffer.substring(buffer.length - keepSize);
        log.debug('[daily_papers] Buffer trimmed', {}, { newBufferSize: buffer.length });
      }
    }

    log.info('[daily_papers] Comment extraction complete', {}, { 
      totalComments: comments.length,
      totalBytesRead 
    });

    return comments;

  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock may already be released
    }
  }
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
  const { page = DEFAULT_PAGE, limit = DEFAULT_LIMIT, date, week, month, submitter, sort = 'trending' } = params;

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
 * Get comments for a paper by fetching the HTML from the paper's Hugging Face page.
 * Uses memory-efficient streaming to extract comments without loading entire HTML into memory.
 */
export async function getCommentsForPaper(
  params: GetCommentsForPaperParams,
  context_params?: any,
  toolSessionContext?: ToolSessionContext
): Promise<ToolkitResult> {
  const { arxiv_id } = params;

  log.info('[daily_papers] getCommentsForPaper called', {}, { arxiv_id, allParams: params });

  try {
    // Construct the Hugging Face paper URL
    const url = `https://huggingface.co/papers/${arxiv_id}`;

    log.info('[daily_papers] Fetching paper comments from URL', {}, { url });

    // Use memory-efficient streaming extraction
    const comments = await getWebContentExtractComments(url);

    const result = {
      success: true,
      arxiv_id,
      url,
      commentsCount: comments.length,
      comments: comments.length > 0 ? comments : ['No comments found'],
      timestamp: new Date().toISOString()
    };

    log.debug('[daily_papers] getCommentsForPaper result', {}, result);

    return {
      result: JSON.stringify(result),
      updatedToolSessionContext: {},
    };
  } catch (error) {
    log.error('[daily_papers] Error fetching paper comments', {}, { error, arxiv_id });
    return {
      result: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        arxiv_id,
        timestamp: new Date().toISOString()
      }),
      updatedToolSessionContext: {},
    };
  }
}

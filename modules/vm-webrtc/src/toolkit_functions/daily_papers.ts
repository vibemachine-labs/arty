import { log } from '../../../../lib/logger';

// MARK: - Types

export interface ShowDailyPapersParams {
  region: string;
  limit?: number;
}

export interface ShowCommentsForPaperParams {
  paperId: string;
  maxComments?: number;
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
 * Retrieve comments or reader feedback for a specified daily paper.
 */
export async function showCommentsForPaper(params: ShowCommentsForPaperParams): Promise<string> {
  const { paperId, maxComments } = params;

  log.info('[daily_papers] showCommentsForPaper called (STUBBED)', {}, { paperId, maxComments });

  // STUB: Return mock data
  const stubData = {
    success: true,
    paperId,
    comments: [
      {
        id: "comment-001",
        author: "researcher_alice",
        text: "Fascinating approach! The experimental results are very promising.",
        upvotes: 23,
        timestamp: "2025-11-09T10:30:00Z"
      },
      {
        id: "comment-002",
        author: "ml_expert_bob",
        text: "I wonder how this would scale to even larger models?",
        upvotes: 15,
        timestamp: "2025-11-09T11:15:00Z",
        replies: [
          {
            id: "comment-003",
            author: "paper_author",
            text: "Great question! We're currently working on scaling experiments...",
            upvotes: 8,
            timestamp: "2025-11-09T12:00:00Z"
          }
        ]
      },
      {
        id: "comment-004",
        author: "phd_student",
        text: "The ablation studies in Section 4.2 are particularly insightful.",
        upvotes: 12,
        timestamp: "2025-11-09T13:45:00Z"
      }
    ].slice(0, maxComments || 10),
    totalComments: 3,
    timestamp: new Date().toISOString()
  };

  return JSON.stringify(stubData);
}

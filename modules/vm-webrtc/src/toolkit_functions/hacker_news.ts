import { log } from '../../../../lib/logger';

// MARK: - Constants

const BASE_API_URL = 'https://hn.algolia.com/api/v1';
const DEFAULT_NUM_STORIES = 10;

// MARK: - Types

export interface ShowTopStoriesParams {
  story_type: 'top' | 'new' | 'ask_hn' | 'show_hn';
  num_stories?: number;
}

export interface ShowCommentsForStoryParams {
  storyId: number;
  maxDepth?: number;
}

interface HNStory {
  objectID: string;
  title: string;
  url?: string;
  author: string;
  points?: number;
  num_comments?: number;
}

// MARK: - Helper Functions

function formatStoryDetails(story: HNStory) {
  return {
    id: parseInt(story.objectID, 10),
    title: story.title,
    url: story.url || `https://news.ycombinator.com/item?id=${story.objectID}`,
    author: story.author,
    points: story.points ?? null,
  };
}

// MARK: - Functions

/**
 * Fetch stories from Hacker News by category.
 *
 * @param params.story_type - Category of stories: "top" (front page), "new" (recent), "ask_hn", "show_hn"
 * @param params.num_stories - Number of stories to return (default: 10)
 */
export async function showTopStories(params: ShowTopStoriesParams): Promise<string> {
  const { story_type, num_stories = DEFAULT_NUM_STORIES } = params;

  log.info('[hacker_news] showTopStories called', {}, { story_type, num_stories });

  // Validate story_type
  const validTypes = ['top', 'new', 'ask_hn', 'show_hn'];
  const normalizedType = story_type.toLowerCase().trim();

  if (!validTypes.includes(normalizedType)) {
    const error = `story_type must be one of: ${validTypes.join(', ')}`;
    log.error('[hacker_news] Invalid story_type', {}, { story_type, validTypes });
    return JSON.stringify({
      success: false,
      error,
    });
  }

  // Map story type to appropriate API parameters
  const apiParams: Record<string, { endpoint: string; tags: string }> = {
    top: { endpoint: 'search', tags: 'front_page' },
    new: { endpoint: 'search_by_date', tags: 'story' },
    ask_hn: { endpoint: 'search', tags: 'ask_hn' },
    show_hn: { endpoint: 'search', tags: 'show_hn' },
  };

  const params_config = apiParams[normalizedType];
  const url = `${BASE_API_URL}/${params_config.endpoint}?tags=${params_config.tags}&hitsPerPage=${num_stories}`;

  try {
    log.info('[hacker_news] Fetching stories from API', {}, { url });

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const stories = data.hits.map((story: HNStory) => formatStoryDetails(story));

    log.info('[hacker_news] Stories fetched successfully', {}, {
      story_type: normalizedType,
      count: stories.length
    });

    return JSON.stringify({
      success: true,
      story_type: normalizedType,
      stories,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[hacker_news] Failed to fetch stories', {}, {
      story_type: normalizedType,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, error);

    return JSON.stringify({
      success: false,
      error: errorMessage,
      story_type: normalizedType,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Fetch the comments for a given Hacker News story.
 */
export async function showCommentsForStory(params: ShowCommentsForStoryParams): Promise<string> {
  const { storyId, maxDepth } = params;

  log.info('[hacker_news] showCommentsForStory called (STUBBED)', {}, { storyId, maxDepth });

  // STUB: Return mock data
  const stubData = {
    success: true,
    storyId,
    comments: [
      {
        id: 101,
        author: "techexpert",
        text: "This is a great story! Very insightful.",
        points: 42,
        depth: 0,
        replies: [
          {
            id: 102,
            author: "codereader",
            text: "I agree, learned a lot from this.",
            points: 15,
            depth: 1
          }
        ]
      },
      {
        id: 103,
        author: "skeptic99",
        text: "I'm not sure about this approach...",
        points: 8,
        depth: 0
      }
    ],
    totalComments: 2,
    maxDepth: maxDepth || 5,
    timestamp: new Date().toISOString()
  };

  return JSON.stringify(stubData);
}

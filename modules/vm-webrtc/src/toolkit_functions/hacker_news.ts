import { log } from '../../../../lib/logger';

// MARK: - Constants

const BASE_API_URL = 'https://hn.algolia.com/api/v1';
const DEFAULT_NUM_STORIES = 10;
const DEFAULT_COMMENT_DEPTH = 2;
const DEFAULT_NUM_COMMENTS = 10;

// MARK: - Types

export interface ShowTopStoriesParams {
  story_type: 'top' | 'new' | 'ask_hn' | 'show_hn';
  num_stories?: number;
}

export interface SearchStoriesParams {
  query: string;
  num_results?: number;
  search_by_date?: boolean;
}

export interface GetStoryInfoParams {
  story_id: number;
  comment_depth?: number;
  comments_per_level?: number;
}

export interface GetUserInfoParams {
  user_name: string;
  num_stories?: number;
}

interface HNStory {
  objectID?: string;
  id?: number;
  story_id?: number;
  title?: string;
  url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  children?: HNComment[];
}

interface HNComment {
  id: number;
  author?: string;
  text?: string;
  children?: HNComment[];
}

interface FormattedComment {
  id: number;
  author: string | null;
  text: string | null;
  comments?: FormattedComment[];
}

interface FormattedStory {
  id: number;
  title?: string;
  url?: string;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  comments?: FormattedComment[];
}

interface FormatStoryOptions {
  includeComments?: boolean;
  commentDepth?: number;
  commentsPerLevel?: number;
}

// MARK: - Helper Functions

function formatStoryDetails(story: HNStory, options: FormatStoryOptions = {}): FormattedStory {
  const storyId = deriveStoryId(story);
  const formatted: FormattedStory = {
    id: storyId,
    title: story.title,
    url: story.url || (storyId ? `https://news.ycombinator.com/item?id=${storyId}` : undefined),
    author: story.author,
    points: story.points ?? null,
    num_comments: story.num_comments ?? (Array.isArray(story.children) ? story.children.length : null),
  };

  if (options.includeComments && Array.isArray(story.children)) {
    const depth = Math.max(1, options.commentDepth ?? DEFAULT_COMMENT_DEPTH);
    const perLevel = Math.max(1, options.commentsPerLevel ?? DEFAULT_NUM_COMMENTS);
    formatted.comments = formatCommentList(story.children, depth, perLevel);
  }

  return formatted;
}

function formatCommentList(comments: HNComment[], depth: number, perLevel: number): FormattedComment[] {
  if (depth < 1) {
    return [];
  }

  return comments.slice(0, perLevel).map((comment) => formatCommentDetails(comment, depth, perLevel));
}

function formatCommentDetails(comment: HNComment, depth: number, perLevel: number): FormattedComment {
  const formatted: FormattedComment = {
    id: comment.id,
    author: comment.author ?? null,
    text: comment.text ?? null,
  };

  if (depth > 1 && Array.isArray(comment.children) && comment.children.length > 0) {
    formatted.comments = formatCommentList(comment.children, depth - 1, perLevel);
  }

  return formatted;
}

function deriveStoryId(story: HNStory): number {
  if (story.objectID) {
    const parsed = parseInt(story.objectID, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  if (typeof story.id === 'number') {
    return story.id;
  }

  if (typeof story.story_id === 'number') {
    return story.story_id;
  }

  return 0;
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
      group: 'hacker_news',
      tool: 'showTopStories',
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
      count: stories.length,
      stories,
    });

    return JSON.stringify({
      success: true,
      group: 'hacker_news',
      tool: 'showTopStories',
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
      group: 'hacker_news',
      tool: 'showTopStories',
      error: errorMessage,
      story_type: normalizedType,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Search Hacker News stories using a free-form query.
 */
export async function searchStories(params: SearchStoriesParams): Promise<string> {
  const {
    query,
    num_results = DEFAULT_NUM_STORIES,
    search_by_date = false,
  } = params;

  const normalizedQuery = query?.trim();

  if (!normalizedQuery) {
    const errorMessage = 'query must be a non-empty string';
    log.error('[hacker_news] searchStories validation failed', {}, { query });
    return JSON.stringify({
      success: false,
      group: 'hacker_news',
      tool: 'searchStories',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  const endpoint = search_by_date ? 'search_by_date' : 'search';
  const url = `${BASE_API_URL}/${endpoint}?query=${encodeURIComponent(normalizedQuery)}&hitsPerPage=${num_results}&tags=story`;

  log.info('[hacker_news] searchStories called', {}, {
    query: normalizedQuery,
    num_results,
    search_by_date,
    endpoint,
  });

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const stories = (data.hits || []).map((story: HNStory) => formatStoryDetails(story));

    log.info('[hacker_news] searchStories completed', {}, {
      query: normalizedQuery,
      count: stories.length,
      search_by_date,
    });

    return JSON.stringify({
      success: true,
      group: 'hacker_news',
      tool: 'searchStories',
      query: normalizedQuery,
      search_by_date,
      stories,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[hacker_news] searchStories failed', {}, {
      query: normalizedQuery,
      error: errorMessage,
    }, error);

    return JSON.stringify({
      success: false,
      group: 'hacker_news',
      tool: 'searchStories',
      error: errorMessage,
      query: normalizedQuery,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Fetch a single Hacker News story including its comments.
 */
export async function getStoryInfo(params: GetStoryInfoParams): Promise<string> {
  const {
    story_id,
    comment_depth = DEFAULT_COMMENT_DEPTH,
    comments_per_level = DEFAULT_NUM_COMMENTS,
  } = params;

  log.info('[hacker_news] getStoryInfo called', {}, {
    story_id,
    comment_depth,
    comments_per_level,
  });

  try {
    const story = await fetchStoryById(story_id);
    const formattedStory = formatStoryDetails(story, {
      includeComments: true,
      commentDepth: comment_depth,
      commentsPerLevel: comments_per_level,
    });

    log.info('[hacker_news] Story info fetched successfully', {}, {
      story_id,
      hasComments: Array.isArray(formattedStory.comments) && formattedStory.comments.length > 0,
    });

    return JSON.stringify({
      success: true,
      group: 'hacker_news',
      tool: 'getStoryInfo',
      story: formattedStory,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[hacker_news] getStoryInfo failed', { emit2logfire: true }, {
      story_id,
      error: errorMessage,
    }, error);

    return JSON.stringify({
      success: false,
      group: 'hacker_news',
      tool: 'getStoryInfo',
      error: errorMessage,
      story_id,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Port of _get_user_stories helper – fetches stories for a specific author.
 */
async function getUserStoriesInternal(user_name: string, num_stories: number): Promise<FormattedStory[]> {
  const url = `${BASE_API_URL}/search?tags=author_${encodeURIComponent(user_name)},story&hitsPerPage=${num_stories}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`User stories request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return (data.hits || []).map((story: HNStory) => formatStoryDetails(story));
}

/**
 * Fetch Hacker News user metadata plus their recent submissions.
 */
export async function getUserInfo(params: GetUserInfoParams): Promise<string> {
  const {
    user_name,
    num_stories = DEFAULT_NUM_STORIES,
  } = params;

  const normalizedUserName = user_name?.trim();

  if (!normalizedUserName) {
    const errorMessage = 'user_name must be a non-empty string';
    log.error('[hacker_news] getUserInfo validation failed', {}, { user_name });
    return JSON.stringify({
      success: false,
      group: 'hacker_news',
      tool: 'getUserInfo',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  const url = `${BASE_API_URL}/users/${encodeURIComponent(normalizedUserName)}`;

  log.info('[hacker_news] getUserInfo called', {}, {
    user_name: normalizedUserName,
    num_stories,
  });

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`User request failed: ${response.status} ${errorText}`);
    }

    const userData = await response.json();
    const stories = await getUserStoriesInternal(normalizedUserName, num_stories);

    log.info('[hacker_news] User info fetched successfully', {}, {
      user_name: normalizedUserName,
      story_count: stories.length,
    });

    return JSON.stringify({
      success: true,
      group: 'hacker_news',
      tool: 'getUserInfo',
      user: {
        ...userData,
        stories,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[hacker_news] getUserInfo failed', {}, {
      user_name: normalizedUserName,
      error: errorMessage,
    }, error);

    return JSON.stringify({
      success: false,
      group: 'hacker_news',
      tool: 'getUserInfo',
      error: errorMessage,
      user_name: normalizedUserName,
      timestamp: new Date().toISOString(),
    });
  }
}

async function fetchStoryById(storyId: number): Promise<HNStory> {
  const url = `${BASE_API_URL}/items/${storyId}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Story request failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

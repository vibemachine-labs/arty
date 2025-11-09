import { log } from '../../../../lib/logger';

// MARK: - Types

export interface ShowTopStoriesParams {
  limit: number;
}

export interface ShowCommentsForStoryParams {
  storyId: number;
  maxDepth?: number;
}

// MARK: - Functions

/**
 * Fetch the top stories from Hacker News.
 */
export async function showTopStories(params: ShowTopStoriesParams): Promise<string> {
  const { limit } = params;

  log.info('[hacker_news] showTopStories called (STUBBED)', {}, { limit });

  // STUB: Return mock data
  const stubData = {
    success: true,
    stories: [
      {
        id: 1,
        title: "Rust goes open source",
        url: "https://example.com/rust-oss",
        points: 1234,
        author: "rustfan",
        comments: 567
      },
      {
        id: 2,
        title: "OpenAI raises $10 trillion on a $100 trillion valuation",
        url: "https://example.com/openai-funding",
        points: 9999,
        author: "aifuturist",
        comments: 8888
      }
    ].slice(0, limit),
    timestamp: new Date().toISOString()
  };

  return JSON.stringify(stubData);
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

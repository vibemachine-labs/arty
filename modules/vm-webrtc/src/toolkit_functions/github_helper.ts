// MARK: - GitHub Helper Functions

import { Octokit } from '@octokit/rest';
import { log } from '../../../../lib/logger';
import { getGithubToken } from '../../../../lib/secure-storage';

export interface GithubRepoLookupParams {
  repoIdentifier: string; // e.g. "arty" or "org/repo"
}

/**
 * Resolve a repository identifier to its canonical owner/repo format.
 *
 * If the identifier contains a slash (e.g., "owner/repo"), validates that the repo exists
 * and returns the correctly-cased "Owner/Repo" string.
 *
 * Otherwise, treats the identifier as a search term, uses GitHub search to find the most
 * popular matching repository, and returns its "Owner/Repo" string.
 *
 * @param params - The lookup parameters
 * @returns The canonical "Owner/Repo" string
 * @throws Error if no repository is found or GitHub API is unavailable
 *
 * @remarks
 * Authentication is optional. If a GitHub token is available, it will be used (higher rate limits).
 * Otherwise, falls back to unauthenticated access for public repositories only.
 * Note: Unauthenticated requests have lower rate limits (60 requests/hour vs 5000+/hour).
 */
export async function lookupGithubRepo(params: GithubRepoLookupParams): Promise<string> {
  const { repoIdentifier } = params;
  log.info('[GithubHelper] Performing repo lookup', {}, { repoIdentifier });

  // Get token from secure storage (may be null)
  const token = await getGithubToken();
  let oct: Octokit;
  let authUser: string | null = null;

  // Create custom logger for Octokit that forwards all logs at debug level
  const octokitLogger = {
    debug: (message: string, ...args: any[]) => {
      log.debug('[Octokit]', {}, { message, args });
    },
    info: (message: string, ...args: any[]) => {
      log.debug('[Octokit]', {}, { message, args });
    },
    warn: (message: string, ...args: any[]) => {
      log.debug('[Octokit]', {}, { message, args });
    },
    error: (message: string, ...args: any[]) => {
      log.debug('[Octokit]', {}, { message, args });
    },
  };

  if (token) {
    log.info('[GithubHelper] Using authenticated Octokit instance', {});
    oct = new Octokit({
      auth: token,
      log: octokitLogger,
    });
    try {
      const { data: udata } = await oct.rest.users.getAuthenticated();
      authUser = udata.login;
      log.info('[GithubHelper] Authenticated as GitHub user', {}, { username: authUser });
    } catch (e) {
      log.warn('[GithubHelper] Authenticated user fetch failed - proceeding as unauthenticated', {}, {
        error: e instanceof Error ? e.message : String(e),
      });
      authUser = null;
    }
  } else {
    log.info('[GithubHelper] No token found - using unauthenticated Octokit instance (public-only)', {});
    oct = new Octokit({
      log: octokitLogger,
    }); // no auth
  }

  // Expose globally for compatibility with other tools
  (globalThis as any).octokit = oct;
  (globalThis as any).authenticated_github_user = authUser;

  // If identifier contains slash => try direct lookup first, fall back to search
  if (repoIdentifier.includes('/')) {
    const [rawOwner, rawRepo] = repoIdentifier.split('/');
    const owner = rawOwner.trim();
    const repo = rawRepo.trim();
    log.info('[GithubHelper] Direct lookup - verifying repo exists', {}, { owner, repo });

    try {
      const { data } = await oct.rest.repos.get({
        owner,
        repo,
      });
      // Use the actual case-sensitive names from the returned data
      const actualOwner = data.owner?.login || owner;
      const actualRepo = data.name || repo;
      const stars = data.stargazers_count || 0;

      log.info('[GithubHelper] Direct lookup successful', {}, {
        actualOwner,
        actualRepo,
        stars,
        fullName: `${actualOwner}/${actualRepo}`,
      });
      return `${actualOwner}/${actualRepo}`;
    } catch (e) {
      log.warn('[GithubHelper] Direct lookup failed - falling back to search', {}, {
        owner,
        repo,
        error: e instanceof Error ? e.message : String(e),
      });
      // Fall through to search using just the repo name
    }
  }

  // Extract just the repo name for search (remove owner if present)
  const searchTerm = repoIdentifier.includes('/')
    ? repoIdentifier.split('/')[1].trim()
    : repoIdentifier.trim();
  log.info('[GithubHelper] Starting GitHub search', {}, {
    searchTerm,
    authenticatedUser: authUser || 'unauthenticated',
  });

  // Use search API - sort by stars descending to get most popular
  const { data } = await oct.request('GET /search/repositories', {
    q: `${searchTerm} in:name`,
    sort: 'stars',
    order: 'desc',
    per_page: 5,
  });

  log.info('[GithubHelper] Search completed', {}, {
    searchTerm,
    totalCount: data.total_count,
    resultCount: data.items?.length || 0,
  });

  if (!data.items || data.items.length === 0) {
    log.warn('[GithubHelper] No search results found', {}, { searchTerm });
    throw new Error(`No repository found matching: ${searchTerm}`);
  }

  // Log all search results for visibility
  const searchResults = data.items.map((item, index) => ({
    rank: index + 1,
    owner: item.owner?.login,
    repo: item.name,
    fullName: item.full_name,
    stars: item.stargazers_count,
    description: item.description?.substring(0, 100) || 'No description',
  }));

  log.info('[GithubHelper] Search results (sorted by stars)', {}, {
    searchTerm,
    results: searchResults,
  });

  // Check for exact repo name match with specific owner (if we had owner/repo originally)
  if (repoIdentifier.includes('/')) {
    const [originalOwner] = repoIdentifier.split('/');
    const ownerLower = originalOwner.trim().toLowerCase();
    const exactMatch = data.items.find(
      (item) =>
        item.owner?.login?.toLowerCase() === ownerLower &&
        item.name.toLowerCase() === searchTerm.toLowerCase()
    );
    if (exactMatch) {
      const owner = exactMatch.owner?.login;
      const repo = exactMatch.name;
      log.info('[GithubHelper] Found exact match for owner/repo - prioritizing', {}, {
        originalOwner,
        owner,
        repo,
        stars: exactMatch.stargazers_count,
        fullName: `${owner}/${repo}`,
      });
      return `${owner}/${repo}`;
    } else {
      log.info('[GithubHelper] No exact match for owner/repo in search results', {}, {
        originalOwner,
        searchTerm,
      });
    }
  }

  // If authenticated, check if any result matches the authenticated user
  if (authUser) {
    const userMatch = data.items.find(
      (item) =>
        item.owner?.login?.toLowerCase() === authUser.toLowerCase() &&
        item.name.toLowerCase() === searchTerm.toLowerCase()
    );
    if (userMatch) {
      const owner = userMatch.owner?.login;
      const repo = userMatch.name;
      log.info('[GithubHelper] Found match for authenticated user - prioritizing', {}, {
        authUser,
        owner,
        repo,
        stars: userMatch.stargazers_count,
        fullName: `${owner}/${repo}`,
      });
      return `${owner}/${repo}`;
    } else {
      log.info('[GithubHelper] No match for authenticated user in results', {}, {
        authUser,
        searchTerm,
      });
    }
  }

  // No authenticated user match (or not authenticated) => return top result by stars
  const top = data.items[0];
  const owner = top.owner?.login;
  const repo = top.name;
  if (!owner) {
    throw new Error(`Unexpected search result format for term: ${searchTerm}`);
  }

  log.info('[GithubHelper] Returning top result by stars', {}, {
    owner,
    repo,
    stars: top.stargazers_count,
    fullName: `${owner}/${repo}`,
    isAuthenticatedUser: authUser ? owner.toLowerCase() === authUser.toLowerCase() : false,
  });
  return `${owner}/${repo}`;
}

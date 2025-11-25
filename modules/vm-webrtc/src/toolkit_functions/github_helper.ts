// MARK: - GitHub Helper Functions

import { log } from '../../../../lib/logger';

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
 * Assumes global `octokit` and `authenticated_github_user` are injected by the GitHub connector.
 * Uses octokit.rest.* or octokit.request(), and octokit.paginate() if needed.
 */
export async function lookupGithubRepo(params: GithubRepoLookupParams): Promise<string> {
  const { repoIdentifier } = params;
  log.info('[GithubHelper] Performing repo lookup', {}, { repoIdentifier });

  // Assumes global octokit & authenticated_github_user are injected
  const oct = (globalThis as any).octokit;
  const authUser = (globalThis as any).authenticated_github_user;

  if (!oct) {
    throw new Error('GitHub API client (octokit) not available');
  }

  // If identifier contains slash => treat as org/repo
  if (repoIdentifier.includes('/')) {
    const [rawOwner, rawRepo] = repoIdentifier.split('/');
    const owner = rawOwner.trim();
    const repo = rawRepo.trim();
    log.info('[GithubHelper] Trying direct verify of repo', {}, { owner, repo });

    try {
      const { data } = await oct.rest.repos.get({
        owner,
        repo,
      });
      // Use the actual case-sensitive names from the returned data
      const actualOwner = data.owner?.login || owner;
      const actualRepo = data.name || repo;

      log.info('[GithubHelper] Repo exists', {}, { actualOwner, actualRepo });
      return `${actualOwner}/${actualRepo}`;
    } catch (e) {
      throw new Error(`Repository not found: ${owner}/${repo}`);
    }
  } else {
    // Treat as search term
    const searchTerm = repoIdentifier.trim();
    log.info('[GithubHelper] Searching repositories for term', {}, { searchTerm });

    // Use search API
    const { data } = await oct.request('GET /search/repositories', {
      q: `${searchTerm} in:name`,
      sort: 'stars',
      order: 'desc',
      per_page: 5,
    });

    if (!data.items || data.items.length === 0) {
      throw new Error(`No repository found matching: ${searchTerm}`);
    }

    // Pick top result
    const top = data.items[0];
    const owner = top.owner?.login;
    const repo = top.name;
    if (!owner) {
      throw new Error(`Unexpected search result format for term: ${searchTerm}`);
    }

    log.info('[GithubHelper] Top match', {}, { owner, repo });
    return `${owner}/${repo}`;
  }
}

// MARK: - GitHub Helper Functions

import { Octokit } from "@octokit/rest";
import { log } from "../../../../lib/logger";
import { getGithubToken } from "../../../../lib/secure-storage";

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
export async function lookupGithubRepo(
  params: GithubRepoLookupParams,
): Promise<string> {
  const { repoIdentifier } = params;
  log.info("[GithubHelper] Performing repo lookup", {}, { repoIdentifier });

  // Get token from secure storage (may be null)
  const token = await getGithubToken();
  let oct: Octokit;
  let authUser: string | null = null;

  // Create custom logger for Octokit that forwards all logs at debug level
  const octokitLogger = {
    debug: (message: string, ...args: any[]) => {
      log.debug(
        `🔧 [Octokit] ${message}`,
        {},
        { args: args.length > 0 ? JSON.stringify(args) : undefined },
      );
    },
    info: (message: string, ...args: any[]) => {
      log.debug(
        `🔧 [Octokit] ${message}`,
        {},
        { args: args.length > 0 ? JSON.stringify(args) : undefined },
      );
    },
    warn: (message: string, ...args: any[]) => {
      log.warn(
        `🔧 [Octokit] ${message}`,
        {},
        { args: args.length > 0 ? JSON.stringify(args) : undefined },
      );
    },
    error: (message: string, ...args: any[]) => {
      log.error(
        `🔧 [Octokit] ${message}`,
        {},
        { args: args.length > 0 ? JSON.stringify(args) : undefined },
      );
    },
  };

  if (token) {
    log.info("[GithubHelper] Using authenticated Octokit instance", {});
    oct = new Octokit({
      auth: token,
      log: octokitLogger,
    });
    try {
      const { data: udata } = await oct.rest.users.getAuthenticated();
      authUser = udata.login;
      log.info(
        "[GithubHelper] Authenticated as GitHub user",
        {},
        { username: authUser },
      );
    } catch (e) {
      log.warn(
        "[GithubHelper] Authenticated user fetch failed - proceeding as unauthenticated",
        {},
        {
          error: e instanceof Error ? e.message : String(e),
        },
      );
      authUser = null;
    }
  } else {
    log.info(
      "[GithubHelper] No token found - using unauthenticated Octokit instance (public-only)",
      {},
    );
    oct = new Octokit({
      log: octokitLogger,
    }); // no auth
  }

  // Expose globally for compatibility with other tools
  (globalThis as any).octokit = oct;
  (globalThis as any).authenticated_github_user = authUser;

  // If identifier contains slash => try direct lookup first, fall back to search
  if (repoIdentifier.includes("/")) {
    const [rawOwner, rawRepo] = repoIdentifier.split("/");
    const owner = rawOwner.trim();
    const repo = rawRepo.trim();
    log.info(
      "[GithubHelper] Direct lookup - verifying repo exists",
      {},
      { owner, repo },
    );

    try {
      const { data } = await oct.rest.repos.get({
        owner,
        repo,
      });
      // Use the actual case-sensitive names from the returned data
      const actualOwner = data.owner?.login || owner;
      const actualRepo = data.name || repo;
      const stars = data.stargazers_count || 0;

      log.info(
        "[GithubHelper] Direct lookup successful",
        {},
        {
          actualOwner,
          actualRepo,
          stars,
          fullName: `${actualOwner}/${actualRepo}`,
        },
      );
      return `${actualOwner}/${actualRepo}`;
    } catch (e) {
      log.warn(
        "[GithubHelper] Direct lookup failed - falling back to search",
        {},
        {
          owner,
          repo,
          error: e instanceof Error ? e.message : String(e),
        },
      );
      // Fall through to search using just the repo name
    }
  }

  // Extract just the repo name for search (remove owner if present)
  const searchTerm = repoIdentifier.includes("/")
    ? repoIdentifier.split("/")[1].trim()
    : repoIdentifier.trim();
  log.info(
    "[GithubHelper] Starting GitHub search",
    {},
    {
      searchTerm,
      authenticatedUser: authUser || "unauthenticated",
    },
  );

  // Use search API - sort by stars descending to get most popular
  const { data } = await oct.request("GET /search/repositories", {
    q: `${searchTerm} in:name`,
    sort: "stars",
    order: "desc",
    per_page: 20, // Fetch more to allow filtering
  });

  log.info(
    "[GithubHelper] Search completed",
    {},
    {
      searchTerm,
      totalCount: data.total_count,
      resultCount: data.items?.length || 0,
      allResults:
        data.items?.map((item) => ({
          fullName: item.full_name,
          name: item.name,
          owner: item.owner?.login,
          stars: item.stargazers_count,
          description: item.description?.substring(0, 100),
        })) || [],
    },
  );

  if (!data.items || data.items.length === 0) {
    log.warn("[GithubHelper] No search results found", {}, { searchTerm });
    throw new Error(
      `No repositories found matching "${searchTerm}". Please check the spelling or try a different search term.`,
    );
  }

  // Filter for exact name matches only
  const exactMatches = data.items.filter(
    (item) => item.name.toLowerCase() === searchTerm.toLowerCase(),
  );

  const filteredOut = data.items.filter(
    (item) => item.name.toLowerCase() !== searchTerm.toLowerCase(),
  );

  log.info(
    "[GithubHelper] Filtered for exact name matches",
    {},
    {
      searchTerm,
      originalCount: data.items.length,
      exactMatchCount: exactMatches.length,
      filteredOutCount: filteredOut.length,
      exactMatches: exactMatches.map((item) => ({
        fullName: item.full_name,
        stars: item.stargazers_count,
      })),
      filteredOut: filteredOut.map((item) => ({
        fullName: item.full_name,
        name: item.name,
        stars: item.stargazers_count,
        reason: "name_mismatch",
      })),
    },
  );

  if (exactMatches.length === 0) {
    log.warn(
      "[GithubHelper] No exact name matches found",
      {},
      {
        searchTerm,
        availableRepos: data.items.slice(0, 5).map((item) => item.full_name),
      },
    );
    throw new Error(
      `No repositories found with exact name "${searchTerm}". Found similar repositories but none match exactly. Please specify the full owner/repo format (e.g., "owner/${searchTerm}") or check the spelling.`,
    );
  }

  // Filter out repos with less than X stars
  const MIN_STARS = 5;
  const popularMatches = exactMatches.filter(
    (item) => (item.stargazers_count || 0) >= MIN_STARS,
  );

  const belowThreshold = exactMatches.filter(
    (item) => (item.stargazers_count || 0) < MIN_STARS,
  );

  log.info(
    "[GithubHelper] Filtered for popularity threshold",
    {},
    {
      searchTerm,
      minStars: MIN_STARS,
      beforeFilterCount: exactMatches.length,
      afterFilterCount: popularMatches.length,
      belowThresholdCount: belowThreshold.length,
      popularMatches: popularMatches.map((item) => ({
        fullName: item.full_name,
        stars: item.stargazers_count,
      })),
      belowThreshold: belowThreshold.map((item) => ({
        fullName: item.full_name,
        stars: item.stargazers_count,
        reason: `below_${MIN_STARS}_stars`,
      })),
    },
  );

  if (popularMatches.length === 0) {
    const lowStarRepos = exactMatches.map((item) => ({
      fullName: item.full_name,
      stars: item.stargazers_count || 0,
    }));
    log.warn(
      "[GithubHelper] No repositories above star threshold",
      {},
      {
        searchTerm,
        minStars: MIN_STARS,
        lowStarRepos,
      },
    );
    throw new Error(
      `Found ${exactMatches.length} repositor${exactMatches.length === 1 ? "y" : "ies"} named "${searchTerm}" but ${exactMatches.length === 1 ? "it has" : "they have"} fewer than ${MIN_STARS} stars. Please specify the full owner/repo format (e.g., "${exactMatches[0].full_name}") to access ${exactMatches.length === 1 ? "this repository" : "one of these repositories"}.`,
    );
  }

  if (popularMatches.length > 1) {
    // Only show top 5 matches to avoid overwhelming the user
    const topMatches = popularMatches.slice(0, 5);
    const repoList = topMatches
      .map((item) => `"${item.full_name}" (${item.stargazers_count} stars)`)
      .join(", ");

    const totalMatchCount = popularMatches.length;
    const additionalCount = totalMatchCount - topMatches.length;
    const additionalText =
      additionalCount > 0 ? ` (and ${additionalCount} more)` : "";

    log.warn(
      "[GithubHelper] Multiple popular repositories found",
      {},
      {
        searchTerm,
        count: totalMatchCount,
        shownCount: topMatches.length,
        repos: popularMatches.map((item) => ({
          fullName: item.full_name,
          stars: item.stargazers_count,
        })),
      },
    );
    throw new Error(
      `Found ${totalMatchCount} popular repositories named "${searchTerm}": ${repoList}${additionalText}. Please specify which one you mean by using the full owner/repo format (e.g., "${topMatches[0].full_name}").`,
    );
  }

  // Single popular match found - use it
  const matchedRepo = popularMatches[0];
  const owner = matchedRepo.owner?.login;
  const repo = matchedRepo.name;

  if (!owner) {
    throw new Error(
      `Unexpected search result format for repository "${searchTerm}". The repository data is incomplete.`,
    );
  }

  // Check if we had owner/repo originally and if this matches
  if (repoIdentifier.includes("/")) {
    const [originalOwner] = repoIdentifier.split("/");
    const ownerLower = originalOwner.trim().toLowerCase();
    const isExactOwnerMatch = owner.toLowerCase() === ownerLower;

    log.info(
      "[GithubHelper] Found repository from owner/repo search",
      {},
      {
        originalInput: repoIdentifier,
        originalOwner,
        matchedOwner: owner,
        repo,
        isExactOwnerMatch,
        stars: matchedRepo.stargazers_count,
        fullName: `${owner}/${repo}`,
        finalResult: `${owner}/${repo}`,
        searchPath:
          "direct_lookup_failed -> search_fallback -> exact_match_filter -> star_threshold_filter -> single_match",
      },
    );
  } else {
    // Check if authenticated user owns this repo
    const isAuthenticatedUserRepo = authUser
      ? owner.toLowerCase() === authUser.toLowerCase()
      : false;

    log.info(
      "[GithubHelper] Found repository from name-only search",
      {},
      {
        originalInput: repoIdentifier,
        owner,
        repo,
        stars: matchedRepo.stargazers_count,
        fullName: `${owner}/${repo}`,
        finalResult: `${owner}/${repo}`,
        isAuthenticatedUserRepo,
        authenticatedUser: authUser || "none",
        searchPath:
          "name_only_search -> exact_match_filter -> star_threshold_filter -> single_match",
      },
    );
  }

  return `${owner}/${repo}`;
}

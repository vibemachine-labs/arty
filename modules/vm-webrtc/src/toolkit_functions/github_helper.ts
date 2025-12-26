// MARK: - GitHub Helper Functions

import { Octokit } from "@octokit/rest";
import { log } from "../../../../lib/logger";
import { getGithubToken } from "../../../../lib/secure-storage";
import { web_search } from "./web";

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
      // Use warn instead of error - Octokit logs 404s as errors, but they're expected
      // during repo lookup fallback and shouldn't show up as errors in the app
      log.warn(
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
        "[GithubHelper] Direct lookup failed - falling back to web search",
        {},
        {
          owner,
          repo,
          error: e instanceof Error ? e.message : String(e),
        },
      );
      // Fall through to web search with both owner and repo
      return await performWebSearchFallback(`${owner}/${repo}`, oct, authUser);
    }
  }

  // No slash in identifier - use web search to find the repository
  log.info(
    "[GithubHelper] Starting web search for repository",
    {},
    {
      repoIdentifier,
      authenticatedUser: authUser || "unauthenticated",
    },
  );

  return await performWebSearchFallback(repoIdentifier, oct, authUser);
}

/**
 * Use web search to find a GitHub repository when direct lookup fails.
 * Searches for the repository using GPT-4o with web search enabled,
 * then validates the result against GitHub API.
 */
async function performWebSearchFallback(
  searchQuery: string,
  oct: Octokit,
  authUser: string | null,
): Promise<string> {
  log.info(
    "[GithubHelper] Performing web search fallback",
    {},
    {
      searchQuery,
      authenticatedUser: authUser || "unauthenticated",
    },
  );

  // Parse the search query to extract owner and repo parts for a smarter search strategy
  let repoName = searchQuery;
  let ownerHint = "";

  if (searchQuery.includes("/")) {
    const [ownerPart, repoPart] = searchQuery.split("/");
    ownerHint = ownerPart.trim();
    repoName = repoPart.trim();
  }

  // Construct a search query that uses a two-step strategy for better results
  // Always mention the full search query first, then add hints for parsing
  const searchStrategy = ownerHint
    ? `Search for the GitHub repository "${searchQuery}". First search for a repo named "${repoName}", then narrow it down to any orgs that sound like "${ownerHint}".`
    : `Search for a GitHub repository named "${repoName}".`;

  const webSearchQuery = `${searchStrategy}

NOTE: The search terms come from voice input, so there may be typos or phonetic misunderstandings.
Consider similar-sounding or commonly confused variations. For example:
- A word like “pace” could be misheard as “base” or “bace” when spoken quickly.  
- A name like “Jordan” might be transcribed as “Jorden” due to slight pronunciation differences.  
- Homophones such as “flower” and “flour” or “right” and “write” can be swapped in text outputs.  
- Words may be run together or hyphenated differently

IMPORTANT: Your response MUST be ONLY a valid JSON array of GitHub repositories, nothing else.
Each item should have "owner" and "repo" fields.

Example response format:
[{"owner": "facebook", "repo": "react"}, {"owner": "vercel", "repo": "next.js"}]

Rules:
- Only include real GitHub repositories that exist
- Consider phonetically similar names and common transcription errors
- Return the most likely matches based on the search term
- Maximum 5 results, ordered by relevance
- No explanation text, no markdown, just the JSON array
- If no repositories found, return: []`;

  log.info(
    "[GithubHelper] Calling web_search",
    {},
    {
      query: webSearchQuery,
    },
  );

  const webSearchResult = await web_search({ query: webSearchQuery });
  const resultText = webSearchResult.result;

  log.info(
    "[GithubHelper] Web search completed",
    {},
    {
      resultLength: resultText.length,
      result: resultText,
    },
  );

  // Try to parse the result as JSON first (preferred path)
  let matches: { owner: string; repo: string }[] = [];

  try {
    // The result from web_search is JSON with { query, answer } structure
    const parsed = JSON.parse(resultText);
    const answer = parsed.answer || parsed;

    // Try to extract JSON array from the answer
    let jsonContent =
      typeof answer === "string" ? answer : JSON.stringify(answer);

    // Try to find a JSON array in the response (in case there's extra text)
    const jsonArrayMatch = jsonContent.match(/\[[\s\S]*?\]/);
    if (jsonArrayMatch) {
      jsonContent = jsonArrayMatch[0];
    }

    const repos = JSON.parse(jsonContent);
    if (Array.isArray(repos)) {
      for (const repo of repos) {
        if (repo.owner && repo.repo) {
          matches.push({
            owner: String(repo.owner).trim(),
            repo: String(repo.repo)
              .trim()
              .replace(/\.git$/, ""),
          });
        }
      }
    }

    log.info(
      "[GithubHelper] Parsed structured JSON response",
      {},
      {
        matchCount: matches.length,
        matches: matches,
      },
    );
  } catch (parseError) {
    log.warn(
      "[GithubHelper] Failed to parse structured JSON, falling back to regex extraction",
      {},
      {
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
        resultText: resultText.substring(0, 500),
      },
    );

    // Fallback: extract github.com URLs using regex
    // Use a more permissive pattern that handles Unicode hyphens
    const normalizedText = resultText.replace(
      /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g,
      "-",
    ); // Normalize all hyphen variants

    const githubUrlPattern =
      /github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)/gi;

    let urlMatch;
    while ((urlMatch = githubUrlPattern.exec(normalizedText)) !== null) {
      const owner = urlMatch[1];
      const repo = urlMatch[2].replace(/\.git$/, "");
      // Skip common non-repo paths
      if (
        ![
          "topics",
          "search",
          "explore",
          "settings",
          "notifications",
          "pulls",
          "issues",
          "orgs",
          "users",
          "about",
          "pricing",
          "features",
        ].includes(repo.toLowerCase()) &&
        owner.length > 1 &&
        repo.length > 1
      ) {
        matches.push({ owner, repo });
      }
    }

    log.info(
      "[GithubHelper] Extracted repositories via regex fallback",
      {},
      {
        matchCount: matches.length,
        matches: matches.slice(0, 10),
      },
    );
  }

  // Deduplicate matches
  const seen = new Set<string>();
  matches = matches.filter((m) => {
    const key = `${m.owner.toLowerCase()}/${m.repo.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (matches.length === 0) {
    log.warn(
      "[GithubHelper] Web search did not find any GitHub repositories",
      {},
      {
        searchQuery,
        resultText: resultText.substring(0, 500),
      },
    );
    throw new Error(
      `Could not find a GitHub repository matching "${searchQuery}". The web search did not return any valid repository URLs. Please check the spelling or provide the exact owner/repo format.`,
    );
  }

  // Try to validate each match against the GitHub API
  for (const match of matches) {
    log.info(
      "[GithubHelper] Validating candidate repository",
      {},
      {
        owner: match.owner,
        repo: match.repo,
      },
    );

    try {
      const { data } = await oct.rest.repos.get({
        owner: match.owner,
        repo: match.repo,
      });

      const actualOwner = data.owner?.login || match.owner;
      const actualRepo = data.name || match.repo;
      const stars = data.stargazers_count || 0;

      log.info(
        "[GithubHelper] Web search found valid repository",
        {},
        {
          searchQuery,
          foundOwner: actualOwner,
          foundRepo: actualRepo,
          stars,
          fullName: `${actualOwner}/${actualRepo}`,
          searchPath: "web_search -> github_api_validation",
        },
      );

      return `${actualOwner}/${actualRepo}`;
    } catch (e) {
      log.debug(
        `🔧 [GithubHelper] Candidate repository validation failed`,
        {},
        {
          owner: match.owner,
          repo: match.repo,
          error: e instanceof Error ? e.message : String(e),
        },
      );
      // Continue to next candidate
    }
  }

  // None of the candidates were valid
  log.warn(
    "[GithubHelper] Web search found candidates but none were valid repositories",
    {},
    {
      searchQuery,
      candidates: matches.slice(0, 5),
    },
  );

  throw new Error(
    `Could not find a valid GitHub repository matching "${searchQuery}". Web search found potential matches but none could be verified. Please provide the exact owner/repo format.`,
  );
}

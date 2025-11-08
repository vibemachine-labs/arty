import { Octokit } from '@octokit/rest';
import { log } from '../../../lib/logger';
import { getGithubToken } from '../../../lib/secure-storage';
import { type ToolNativeModule } from './ToolHelper';
import { type ToolDefinition } from './VmWebrtc.types';

export const githubConnectorDefinition: ToolDefinition = {
  type: 'function',
  name: 'github_connector',
  description: `This tool allows interaction with the GitHub API.

You can use this tool to perform any operation on GitHub, such as creating issues, managing repositories, or querying data.

This tool uses the following Octokit versions to interact with the GitHub API:
- @octokit/rest@22.0.0
- @octokit/core@7.0.5
- @octokit/request@10.0.5
- @octokit/types@15.0.0

This app is already connected to GitHub via an officially supported Github connector, and
the user is already authenticated and logged in. 

IMPORTANT: The following variables are pre-injected into the execution scope:
- 'octokit' (Octokit instance): An authenticated Octokit REST API client
- 'authenticated_github_user' (string): The GitHub username of the authenticated user, that can be used as the 'owner' for repo operations.

You do NOT need to create a new Octokit instance or fetch the authenticated user - these are already available.

AUTHENTICATION REQUIRED: If the user is not authenticated (authenticated_github_user is null) and they attempt 
operations that require authentication (like accessing private repos, creating issues, etc.), please inform them:
"To access private GitHub data, you need to authenticate. Please go to Settings in the hamburger menu, 
choose 'Configure Connectors', select GitHub, and add your Classic Personal Access Token with the required 
privileges (such as 'repo' scope for private repositories)."

IMPORTANT: In these versions of Octokit, REST methods are exposed under octokit.rest.* rather than octokit.* directly.
Use octokit.rest.* for all REST API calls, or use octokit.request() with string endpoints.

The snippet MUST be a single self-invoking expression that returns a JSON-serializable value.
  (() => { /* code that uses octokit and authenticated_github_user */ return ...; })()

The snippet must:
- Use the pre-injected 'octokit' variable for all GitHub API calls (do NOT create a new Octokit instance)
- Use the pre-injected 'authenticated_github_user' variable when needed (do NOT fetch it again)
- Use octokit.rest.* methods or octokit.request() for API calls
- Use octokit.paginate() for paginated results
- Return a JSON-serializable value
- Be a sync function, since async/await is not supported in the target environment
- Add console.log statements for debugging
- NOT declare or call named functions (no 'function foo()' or 'foo()')
- NOT reference external variables (inline all inputs you need as constants)
- NOT import any other modules or libraries that are not included by default in React Native

You should derive the snippet from the user's request, then call this tool with that snippet.

Example code snippets:

// Example 1: List repos for authenticated user with pagination
(() => {
  console.log('Fetching repos for:', authenticated_github_user);
  
  return octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
  })
  .then(repos => repos.map(repo => ({
    id: repo.id,
    name: repo.full_name,
    description: repo.description,
    stars: repo.stargazers_count,
    url: repo.html_url,
    language: repo.language,
  })));
})()

// Example 2: Search repositories using request method
(() => {
  const keyword = "keydeleter";
  
  return octokit.request('GET /search/repositories', {
    q: keyword + ' stars:>10',
    sort: 'stars',
    order: 'desc',
    per_page: 10,
  })
  .then(({ data }) => data.items.map(repo => ({
    id: repo.id,
    name: repo.full_name,
    description: repo.description,
    stars: repo.stargazers_count,
    url: repo.html_url,
    language: repo.language,
  })));
})()

// Example 3: List pull requests for authenticated user's repo
(() => {
  const owner = authenticated_github_user;
  const repo = "my-project";
  
  console.log('Fetching PRs for:', owner + '/' + repo);
  
  return octokit.paginate(octokit.rest.pulls.list, {
    owner: owner,
    repo: repo,
    state: "closed",
    per_page: 5
  })
  .then(pulls => pulls.map(pr => ({
    number: pr.number,
    title: pr.title,
    closed_at: pr.closed_at,
    merged_at: pr.merged_at,
    url: pr.html_url
  })));
})()

// Example 4: Get user's recent activity
(() => {
  console.log('Fetching activity for:', authenticated_github_user);
  
  return octokit.rest.activity.listPublicEventsForUser({
    username: authenticated_github_user,
    per_page: 10
  })
  .then(({ data }) => data.map(event => ({
    type: event.type,
    repo: event.repo.name,
    created_at: event.created_at
  })));
})()`,
  parameters: {
    type: 'object',
    properties: {
      self_contained_javascript_octokit_code_snippet: {
        type: 'string',
        description:
          "Provide the complete Octokit JavaScript snippet (logic + return). Return ONLY JSON-serializable data (objects, arrays, numbers, strings). This parameter should ONLY contain the JavaScript snippet, as a SINGLE self-invoking expression that returns JSON-serializable data. No imports, no exports, no named functions, no external variables. The authenticated 'octokit' instance is already available in scope.",
      },
    },
    required: ['self_contained_javascript_octokit_code_snippet'],
  },
};

export const githubListOrganizationsDefinition: ToolDefinition = {
  type: 'function',
  name: 'github_list_organizations',
  description: `Use this tool when the user simply needs to know which organizations their authenticated GitHub account can access.

It executes a pre-built Octokit snippet that lists up to 50 organizations via octokit.rest.orgs.listForAuthenticatedUser
and returns an array of { id, login, description, url } objects. No extra parameters are required.

Example snippet:

(() => {
  console.log('Listing organizations for', authenticated_github_user);
  return octokit
    .paginate(octokit.rest.orgs.listForAuthenticatedUser, { per_page: 50 })
    .then((orgs) => orgs.map((org) => ({
      id: org.id,
      login: org.login,
      description: org.description,
      url: org.html_url,
    })));
})()

This snippet uses the pre-injected octokit client and authenticated_github_user variables provided by the connector.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// MARK: - Types

export interface GithubConnectorParams {
  self_contained_javascript_octokit_code_snippet: string;
  [key: string]: string; // Index signature to satisfy ToolParams constraint
}

export interface GithubConnectorNativeModule extends ToolNativeModule {
  githubOperationFromSwift(codeSnippet: string): Promise<string>;
  sendGithubConnectorResponse(requestId: string, result: string): void;
}

// MARK: - Github Connector Tool Manager

/**
 * Manages github connector tool calls between JavaScript and native Swift code.
 * Uses the Github API.
 * Handles both OpenAI tool calls and direct Swift-to-JS testing.
 */
export class ToolGithubConnector {
  private readonly toolName = 'ToolGithubConnector';
  private readonly requestEventName = 'onGithubConnectorRequest';
  private readonly module: GithubConnectorNativeModule | null;

  constructor(nativeModule: GithubConnectorNativeModule | null) {
    this.module = nativeModule;

    if (this.module) {
      this.module.addListener(this.requestEventName, this.handleRequest.bind(this));
    }
  }

  // MARK: - Private Methods

  /**
   * Handle a github connector request from Swift.
   */
  private async handleRequest(event: { requestId: string; self_contained_javascript_octokit_code_snippet: string }) {
    const { requestId, self_contained_javascript_octokit_code_snippet } = event;
    log.info(`[${this.toolName}] 📥 Received request from Swift`, {}, {
      requestId,
      codeSnippet: self_contained_javascript_octokit_code_snippet,
      snippetLength: self_contained_javascript_octokit_code_snippet.length,
    });

    try {
      const result = await this.performOperation({ self_contained_javascript_octokit_code_snippet });
      log.info(`[${this.toolName}] ✅ Operation completed`, {}, {
        requestId,
        resultLength: String(result).length,
        result: result,
      });

      if (this.module) {
        this.module.sendGithubConnectorResponse(requestId, result);
        log.info(`[${this.toolName}] 📤 Sent response to Swift`, {}, {
          requestId,
          response: result,
          responseLength: String(result).length,
          is_native_logger: false,
        });
      }
    } catch (error) {
      log.error(`[${this.toolName}] ❌ Operation failed`, {}, {
        requestId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      }, error);

      if (this.module) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.module.sendGithubConnectorResponse(requestId, `Error: ${errorMessage}`);
        log.info(`[${this.toolName}] 📤 Sent error response to Swift`, {}, {
          requestId,
          errorMessage,
          is_native_logger: false,
        });
      }
    }
  }

  /**
   * Perform the actual github API operation.
   */
  private async performOperation(params: GithubConnectorParams): Promise<string> {
    const { self_contained_javascript_octokit_code_snippet } = params;
    log.info(`[${this.toolName}] 🔧 Performing github operation`, {}, {
      codeSnippet: self_contained_javascript_octokit_code_snippet,
      snippetLength: self_contained_javascript_octokit_code_snippet.length,
    });

    const snippet = self_contained_javascript_octokit_code_snippet.trim();

    // Get the GitHub token from secure storage
    const token = await getGithubToken();

    // Create an authenticated Octokit instance
    // If no token exists, create an anonymous instance (rate-limited)
    const octokit = token ? new Octokit({ auth: token }) : new Octokit();

    // Fetch authenticated user if token exists
    let authenticatedUser: string | null = null;
    if (token) {
      try {
        const { data } = await octokit.rest.users.getAuthenticated();
        authenticatedUser = data.login;
        log.info(`[${this.toolName}] 👤 Authenticated as GitHub user`, {}, { username: authenticatedUser });
      } catch (error) {
        log.warn(`[${this.toolName}] ⚠️ Failed to fetch authenticated user`, {}, {
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        }, error);
      }
    }
    
    // Make Octokit class AND authenticated instance available in the eval scope
    (globalThis as any).Octokit = Octokit;
    (globalThis as any).octokit = octokit;
    (globalThis as any).authenticated_github_user = authenticatedUser;

    // Add common stdlib-like globals if missing (best-effort)
    const stdlibModules: Record<string, any> = {};
    try { if (typeof Buffer !== 'undefined') stdlibModules.Buffer = Buffer; } catch {}
    try { if (typeof process !== 'undefined') stdlibModules.process = process; } catch {}
    stdlibModules.console = console;
    stdlibModules.setTimeout = setTimeout;
    stdlibModules.clearTimeout = clearTimeout;
    stdlibModules.setInterval = setInterval;
    stdlibModules.clearInterval = clearInterval;
    for (const [k, v] of Object.entries(stdlibModules)) {
      if (!(k in globalThis)) {
        (globalThis as any)[k] = v;
      }
    }

    // Validation (no transforms)
    if (/^\s*import\s/m.test(snippet) || /^\s*export\s/m.test(snippet)) {
      throw new Error('Snippet must not contain import/export.');
    }
    if (/function\s+\w+\s*\(/.test(snippet)) {
      throw new Error('Snippet must not declare named functions.');
    }

    let execResult: any;
    try {
      log.info(`[${this.toolName}] 🚀 Evaluating code snippet`, {}, {
        codeSnippet: snippet,
        snippetLength: snippet.length
      });
      execResult = eval(snippet); // may be value or Promise
    } catch (e) {
      log.error(`[${this.toolName}] ❌ Execution eval error`, {}, {
        errorMessage: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
        errorName: e instanceof Error ? e.name : undefined,
        snippetPreview: snippet.slice(0, 200),
        fullSnippet: snippet,
      }, e);
      return JSON.stringify({ error: String(e), snippet });
    }

    try {
      if (execResult && typeof execResult.then === 'function') {
        log.info(`[${this.toolName}] ⏳ Awaiting promise result`, {});
        execResult = await execResult;
      }
    } catch (e) {
      log.error(`[${this.toolName}] ❌ Awaiting promise failed`, {}, {
        errorMessage: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
        errorName: e instanceof Error ? e.name : undefined,
        snippetPreview: snippet.slice(0, 200),
      }, e);
      return JSON.stringify({ error: String(e), snippet });
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(execResult);
    } catch {
      serialized = JSON.stringify({ result: String(execResult) });
    }

    log.info(`[${this.toolName}] ✅ Execution complete`, {}, {
      serializedLength: serialized.length,
      result: serialized,
    });
    return serialized;
  }

  // MARK: - Public Methods

  /**
   * Core github connector function that performs the actual operation.
   * This is the business logic that can be called directly or via native bridge.
   */
  async execute(params: GithubConnectorParams): Promise<string> {
    return this.performOperation(params);
  }

  /**
   * Github connector bridge function - calls JS github connector from Swift via native bridge.
   * Used for testing the Swift → JS → Swift flow.
   */
  async executeFromSwift(codeSnippet: string): Promise<string> {
    if (!this.module) {
      throw new Error(`Native module not available for github connector bridge function`);
    }

    return this.module.githubOperationFromSwift(codeSnippet);
  }
}

// MARK: - Factory Function

/**
 * Creates a new ToolGithubConnector instance with the provided native module.
 * Returns null if the module is not available.
 */
export const createGithubConnectorTool = (nativeModule: GithubConnectorNativeModule | null): ToolGithubConnector | null => {
  if (!nativeModule) {
    log.warn('[ToolGithubConnector] Native module not available. Github connector tool will not be initialized.', {});
    return null;
  }

  return new ToolGithubConnector(nativeModule);
};

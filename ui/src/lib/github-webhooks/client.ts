/**
 * Shared GitHub repository client facade.
 *
 * The implementation predates this provider-neutral ingress and remains
 * binary-compatible for the legacy Agentic SDLC APIs while TOME reuses it.
 */

export {
  createGitHubClient,
  GitHubClientError,
  type GitHubClientErrorCode,
  type GitHubClientConfig,
  type IGitHubClient,
  type RepoMetadata,
  type RepoWebhook,
} from "@/lib/agentic-sdlc/github-client";

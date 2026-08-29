/** GitHub Discussions reads normalized into TOME's shared GitHub item shape. */

import { Octokit } from "@octokit/rest";

import {
  mapWithConcurrency,
} from "@/lib/github-issue-link";
import {
  displayStatusFromIssue,
  normalizeGitHubRepo,
  priorityFromLabels,
  type LinkedIssueStatus,
} from "@/lib/github-issue-snapshot";

interface DiscussionNode {
  number: number;
  title: string;
  bodyText: string;
  url: string;
  closed: boolean;
  stateReason: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: { login?: string | null } | null;
  category: { name: string };
  labels: { nodes: Array<{ name: string }> };
}

interface DiscussionsQuery {
  repository: {
    discussions: {
      nodes: DiscussionNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

function discussionFromGitHub(
  repo: string,
  discussion: DiscussionNode,
): LinkedIssueStatus {
  const labels = discussion.labels.nodes.map(({ name }) => name).filter(Boolean);
  const state = discussion.closed ? "closed" : "open";
  return {
    contentType: "discussion",
    repo,
    number: discussion.number,
    title: discussion.title,
    body: discussion.bodyText || null,
    url: discussion.url,
    state,
    stateReason: discussion.stateReason?.toLowerCase() ?? null,
    displayStatus: displayStatusFromIssue(state, labels),
    priority: priorityFromLabels(labels),
    labels,
    assignees: [],
    author: discussion.author?.login ?? null,
    milestone: null,
    category: discussion.category.name,
    createdAt: discussion.createdAt,
    updatedAt: discussion.updatedAt,
    closedAt: discussion.closedAt,
  };
}

async function listRepoDiscussions(
  octokit: Octokit,
  repo: string,
): Promise<LinkedIssueStatus[]> {
  const [owner, name] = repo.split("/");
  const discussions: LinkedIssueStatus[] = [];
  let after: string | null = null;
  do {
    const data = await octokit.graphql<DiscussionsQuery>(
      `query TomeRepositoryDiscussions(
        $owner: String!
        $name: String!
        $after: String
      ) {
        repository(owner: $owner, name: $name) {
          discussions(
            first: 100
            after: $after
            orderBy: { field: UPDATED_AT, direction: DESC }
          ) {
            nodes {
              number
              title
              bodyText
              url
              closed
              stateReason
              createdAt
              updatedAt
              closedAt
              author { login }
              category { name }
              labels(first: 100) { nodes { name } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { owner, name, after },
    );
    if (!data.repository) break;
    discussions.push(
      ...data.repository.discussions.nodes.map((item) =>
        discussionFromGitHub(repo, item),
      ),
    );
    const pageInfo = data.repository.discussions.pageInfo;
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after);
  return discussions;
}

export async function listDiscussionsAcrossRepos(
  token: string,
  repos: string[],
): Promise<LinkedIssueStatus[]> {
  const cleanRepos = [...new Set(repos.map(normalizeGitHubRepo))];
  if (!cleanRepos.length) return [];
  const octokit = new Octokit({ auth: token });
  const pages = await mapWithConcurrency(cleanRepos, 3, (repo) =>
    listRepoDiscussions(octokit, repo),
  );
  return pages
    .flat()
    .sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    );
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateWeekly,
  fetchGitHubRepoDashboard,
  GitHubDashboardError,
  normalizeRepoName,
} from "./github-dashboard.mjs";

test("normalizes owner/repo values and GitHub URLs", () => {
  assert.equal(normalizeRepoName("example-org/example-repo"), "example-org/example-repo");
  assert.equal(
    normalizeRepoName("https://github.com/example-org/example-repo.git"),
    "example-org/example-repo",
  );
  assert.throws(() => normalizeRepoName("example-repo"), GitHubDashboardError);
});

test("builds a source-backed repository dashboard from GitHub responses", async () => {
  const counts = new Map([
    ["is:issue is:open", 12],
    ["is:issue is:open updated:<", 4],
    ['is:issue is:open label:\"P0\"', 1],
    ["is:issue is:open no:label", 3],
    ["is:pr is:open", 5],
    ["is:pr is:open draft:false review:none", 2],
    ['is:pr is:open label:\"blocked\"', 1],
  ]);
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.authorization, "Bearer test-token");
    if (url.includes("/repos/example-org/example-repo")) {
      return jsonResponse({
        full_name: "example-org/example-repo",
        description: "Example repository",
        visibility: "private",
        default_branch: "main",
        stargazers_count: 8,
        forks_count: 2,
        archived: false,
        html_url: "https://github.com/example-org/example-repo",
        pushed_at: "2026-08-25T12:00:00Z",
      });
    }
    const query = new URL(url).searchParams.get("q") || "";
    const match = [...counts].sort(([left], [right]) => right.length - left.length).find(([needle]) => query.includes(needle));
    return jsonResponse({ total_count: match?.[1] ?? 0 });
  };

  const dashboard = await fetchGitHubRepoDashboard({
    repo: "example-org/example-repo",
    staleDays: 45,
    token: "test-token",
    fetchImpl,
  });

  assert.equal(dashboard.source, "github-api");
  assert.deepEqual(dashboard.issues, { open: 12, stale: 4, p0: 1, needsTriage: 3 });
  assert.deepEqual(dashboard.pullRequests, { open: 5, awaitingReview: 2, blocked: 1 });
  assert.equal(dashboard.repository.defaultBranch, "main");
  assert.equal(dashboard.provenance.accessMode, "server credential");
  assert.match(dashboard.summary, /2 critical or blocked items/);
});

test("returns a clear inaccessible-repository error", async () => {
  const fetchImpl = async () => jsonResponse({ message: "Not Found" }, 404);
  await assert.rejects(
    fetchGitHubRepoDashboard({ repo: "example-org/private-repo", fetchImpl }),
    (error) => error instanceof GitHubDashboardError && error.code === "repository_not_found",
  );
});

test("uses bounded core REST data without consuming the public Search API limit", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/repos/example-org/example-repo/issues?")) {
      return jsonResponse([
        { updated_at: "2026-01-01T00:00:00Z", labels: [{ name: "P0" }] },
        { updated_at: "2026-08-01T00:00:00Z", labels: [] },
        { pull_request: {}, updated_at: "2026-08-01T00:00:00Z", labels: [] },
      ]);
    }
    if (url.includes("/repos/example-org/example-repo/pulls?")) {
      return jsonResponse([
        { draft: false, requested_reviewers: [{ login: "reviewer" }], labels: [{ name: "blocked" }] },
      ]);
    }
    return jsonResponse({
      full_name: "example-org/example-repo",
      open_issues_count: 6,
      html_url: "https://github.com/example-org/example-repo",
    });
  };

  const dashboard = await fetchGitHubRepoDashboard({
    repo: "example-org/example-repo",
    staleDays: 30,
    fetchImpl,
  });

  assert.equal(urls.length, 10);
  assert.equal(urls.some((url) => url.includes("/search/issues")), false);
  assert.equal(dashboard.confidence, "bounded");
  assert.deepEqual(dashboard.issues, { open: 5, stale: 1, p0: 1, needsTriage: 1 });
  assert.deepEqual(dashboard.pullRequests, { open: 1, awaitingReview: 1, blocked: 1 });
  assert.equal(dashboard.trends.windowWeeks, 12);
  assert.equal(dashboard.security.githubAlerts.status, "credential-required");
  assert.match(dashboard.trends.coverage.stars, /timestamped report-card snapshots/);
});

test("aggregates pull requests and commits into UTC week buckets", () => {
  const points = aggregateWeekly(
    [
      { created_at: "2026-08-17T12:00:00Z" },
      { created_at: "2026-08-18T12:00:00Z" },
      { created_at: "2026-08-25T12:00:00Z" },
    ],
    (item) => item.created_at,
    new Date("2026-08-17T00:00:00Z"),
    new Date("2026-08-30T00:00:00Z"),
  );

  assert.deepEqual(points, [
    { week: "2026-08-17", value: 2 },
    { week: "2026-08-24", value: 1 },
  ]);
});

test("surfaces contributor, trend, community, and security signals when available", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://api.scorecard.dev/")) {
      return jsonResponse({ score: 8.4, date: "2026-08-24", checks: [{ name: "Branch-Protection", score: 6, reason: "Review settings" }] });
    }
    if (url.includes("/issues?state=open")) return jsonResponse([]);
    if (url.includes("/issues?state=all")) return jsonResponse([{ created_at: "2026-08-25T12:00:00Z", comments: 3 }]);
    if (url.includes("/pulls?state=open")) return jsonResponse([]);
    if (url.includes("/pulls?state=all")) return jsonResponse([{ created_at: "2026-08-25T12:00:00Z" }]);
    if (url.includes("/commits?")) return jsonResponse([{ author: { login: "example-user" }, commit: { author: { date: "2026-08-25T12:00:00Z" }, message: "feat: example\n\nSigned-off-by: Example User <user@example.com>" } }]);
    if (url.includes("/contributors?")) return jsonResponse([
      { login: "example-user", contributions: 42 },
      { login: "example-user-2", contributions: 17 },
    ]);
    if (url.includes("/community/profile")) return jsonResponse({ health_percentage: 88, files: { contributing: {}, security: {}, license: {} } });
    if (url.includes("/contents/MAINTAINERS.md")) {
      return jsonResponse({
        encoding: "base64",
        content: Buffer.from("# Maintainers\n- @example-maintainer\n- @example-reviewer\n").toString("base64"),
      });
    }
    if (url.includes("/contents/.github/CODEOWNERS")) {
      return jsonResponse({
        encoding: "base64",
        content: Buffer.from("* @example-maintainer\n/docs/ @example-docs-owner\n").toString("base64"),
      });
    }
    if (url.includes("/git/trees/")) return jsonResponse({ tree: [
      { type: "blob", path: "LICENSE" },
      { type: "blob", path: "CONTRIBUTING.md" },
      { type: "blob", path: "GOVERNANCE.md" },
      { type: "blob", path: ".github/CODEOWNERS" },
      { type: "blob", path: "MAINTAINERS.md" },
      { type: "blob", path: "SECURITY.md" },
    ] });
    return jsonResponse({
      full_name: "example-org/example-repo",
      stargazers_count: 20,
      forks_count: 4,
      subscribers_count: 3,
      default_branch: "main",
      license: { spdx_id: "Apache-2.0" },
      open_issues_count: 0,
      html_url: "https://github.com/example-org/example-repo",
    });
  };

  const dashboard = await fetchGitHubRepoDashboard({ repo: "example-org/example-repo", fetchImpl });
  assert.equal(dashboard.community.totalContributors, 2);
  assert.equal(dashboard.community.activeContributors, 1);
  assert.equal(dashboard.community.communityHealthPercent, 88);
  assert.equal(dashboard.community.engagementInteractions, 4);
  assert.equal(dashboard.security.scorecard.score, 8.4);
  assert.equal(dashboard.trends.pullRequestsPerWeek.at(-1).value, 1);
  assert.equal(dashboard.trends.commitsPerWeek.at(-1).value, 1);
  assert.equal(dashboard.trends.engagementPerWeek.at(-1).value, 4);
  assert.equal(dashboard.readiness.model, "oss-foundation-readiness.v1");
  assert.equal(dashboard.readiness.checks.find((check) => check.criterion === "Project license").status, "pass");
  assert.equal(dashboard.readiness.checks.find((check) => check.criterion === "DCO sign-off evidence").status, "pass");
  assert.equal(dashboard.readiness.checks.find((check) => check.criterion === "Governance document").status, "pass");
  assert.deepEqual(dashboard.ownership.maintainers.handles, ["@example-maintainer", "@example-reviewer"]);
  assert.deepEqual(dashboard.ownership.codeowners.handles, ["@example-maintainer", "@example-docs-owner"]);
  assert.deepEqual(dashboard.ownership.topContributors[0], { login: "example-user", contributions: 42 });
  assert.match(dashboard.ownership.caveat, /must not be described as maintainers/);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() {
      return payload;
    },
  };
}

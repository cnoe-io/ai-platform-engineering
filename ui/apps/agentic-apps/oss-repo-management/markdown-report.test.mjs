import assert from "node:assert/strict";
import test from "node:test";

import { buildOssRepoMarkdownReport } from "./markdown-report.mjs";

test("builds an evidence-based Markdown report card", () => {
  const report = buildOssRepoMarkdownReport({
    source: "github-api",
    generatedAt: "2026-08-26T12:00:00Z",
    repo: "example-org/example-repo",
    summary: "The repository has review work pending.",
    confidence: "bounded",
    repository: { stars: 120, forks: 14, watchers: 8, defaultBranch: "main", visibility: "public" },
    issues: { open: 7, p0: 0, stale: 1, needsTriage: 2 },
    pullRequests: { open: 5, awaitingReview: 3, blocked: 0 },
    community: { totalContributors: 18, activeContributors: 6, hasLicense: true },
    ownership: {
      maintainers: { path: "MAINTAINERS.md", handles: ["@example-maintainer"] },
      codeowners: { path: ".github/CODEOWNERS", handles: ["@example-team"] },
      topContributors: [{ login: "example-contributor", contributions: 24 }],
      caveat: "Contributor activity is not maintainer status.",
    },
    readiness: {
      summary: { pass: 2, warn: 1, manual: 1, unavailable: 0 },
      checks: [{ dimension: "Legal", criterion: "Project license", status: "pass", evidence: "Apache-2.0", source: "Repository metadata" }],
    },
    risks: [{ severity: "medium", title: "Review queue", rationale: "Three pull requests await review." }],
    recommendations: ["Review the oldest pull requests."],
    maintainerAsks: [{ title: "Balance reviews", priority: "medium", detail: "Assign reviewers." }],
    provenance: { provider: "GitHub REST API", accessMode: "public API", staleThresholdDays: 30 },
    frameworks: [{ name: "Example Framework", focus: "project health", url: "https://example.com/framework" }],
  });

  assert.match(report, /^# example-org\/example-repo: OSS Repo Report Card/);
  assert.match(report, /## Executive Summary/);
  assert.match(report, /## Maintainers and Ownership/);
  assert.match(report, /@example-maintainer/);
  assert.match(report, /Contributor activity is not maintainer status/);
  assert.match(report, /## Foundation Readiness/);
  assert.match(report, /## Recommended Actions/);
  assert.match(report, /## Methodology and Coverage/);
});

test("labels cached snapshots and handles missing evidence", () => {
  const report = buildOssRepoMarkdownReport(
    { repo: "example-org/example-repo", generatedAt: "2026-08-26T12:00:00Z" },
    { reportOrigin: "cached" },
  );

  assert.match(report, /\*\*Report type:\*\* Cached snapshot/);
  assert.match(report, /No readiness evidence available/);
  assert.match(report, /No standard MAINTAINERS file detected/);
});

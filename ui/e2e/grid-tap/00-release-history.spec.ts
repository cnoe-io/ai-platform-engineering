import { execFileSync } from "node:child_process";
import path from "node:path";

import { attachEvidence, expect, evidenceScreenshot, test } from "./_helpers";

type Commit = {
  sha: string;
  subject: string;
  domains: string[];
  tests: string[];
};

type ReleaseMatrix = {
  generatedAt: string;
  range: string;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  counts: { commits: number; mergeCommits: number; nonMergeCommits: number; unmappedCommits: number };
  coverage: Array<{ id: string; title: string; tests: string[]; commitCount: number }>;
  unmapped: Commit[];
  commits: Commit[];
};

function releaseMatrix(): ReleaseMatrix {
  const script = path.resolve(__dirname, "../../../.claude/skills/grid-tap/scripts/release-commit-matrix.mjs");
  const base = process.env.GRID_TAP_RELEASE_BASE_REF || "0.5.0";
  const head = process.env.GRID_TAP_RELEASE_HEAD_REF || "HEAD";
  const output = execFileSync(process.execPath, [script, "--base", base, "--head", head, "--format", "json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(output) as ReleaseMatrix;
}

test.describe("GRID TAP release-history coverage", () => {
  test("REL-01 maps every commit since the release boundary to the production matrix", async ({ page }, testInfo) => {
    const report = releaseMatrix();

    expect(report.counts.commits, "The selected release range must contain commits.").toBeGreaterThan(0);
    expect(report.commits).toHaveLength(report.counts.commits);
    expect(report.counts.mergeCommits + report.counts.nonMergeCommits).toBe(report.counts.commits);
    expect(report.unmapped, `Unmapped release commits: ${JSON.stringify(report.unmapped)}`).toEqual([]);
    expect(report.commits.every((commit) => commit.domains.length > 0 && commit.tests.length > 0)).toBe(true);

    await attachEvidence(testInfo, "release-commit-ledger", report);
    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>GRID TAP release coverage</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 32px; color: #17213a; }
            h1 { margin-bottom: 8px; }
            .range { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
            .summary { display: flex; gap: 16px; margin: 24px 0; }
            .card { border: 1px solid #ccd3df; border-radius: 10px; padding: 14px 18px; min-width: 130px; }
            .number { display: block; font-size: 28px; font-weight: 700; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border-bottom: 1px solid #dfe4ec; padding: 10px; text-align: left; vertical-align: top; }
            th { background: #f5f7fa; }
            .pass { color: #137333; font-weight: 700; }
          </style>
        </head>
        <body>
          <h1>GRID TAP release-history coverage</h1>
          <div class="range">${report.base.ref} (${report.base.sha}) → ${report.head.ref} (${report.head.sha})</div>
          <div class="summary">
            <div class="card"><span class="number">${report.counts.commits}</span>all commits</div>
            <div class="card"><span class="number">${report.counts.nonMergeCommits}</span>non-merge</div>
            <div class="card"><span class="number">${report.counts.mergeCommits}</span>merge</div>
            <div class="card"><span class="number">${report.counts.unmappedCommits}</span><span class="pass">unmapped</span></div>
          </div>
          <table>
            <thead><tr><th>Domain</th><th>Commits</th><th>GRID TAP rows</th><th>Coverage</th></tr></thead>
            <tbody>
              ${report.coverage.map((domain) => `<tr><td>${domain.id}</td><td>${domain.commitCount}</td><td>${domain.tests.join(", ")}</td><td>${domain.title}</td></tr>`).join("")}
            </tbody>
          </table>
        </body>
      </html>
    `);
    await evidenceScreenshot(page, testInfo, "release-history-matrix");
  });
});

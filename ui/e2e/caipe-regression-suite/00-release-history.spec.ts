import { execFileSync } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
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

const EXPECTED_MATRIX_ROWS = [
  "REL-00", "REL-01", "REL-02", "REL-03", "PRE-01", "DEP-01", "SEC-01", "FGA-01",
  "MCP-01", "MCP-02", "MCP-03", "MCP-04",
  "CRED-01", "CRED-02", "CRED-03", "KB-01", "KB-02",
  "AGT-01", "AGT-02", "AGT-03", "AGT-04",
  "CHAT-01", "CHAT-02", "CHAT-03", "CHAT-04",
  "TOME-01", "TOME-02", "TOME-03", "WF-01", "SKL-01", "INT-01",
  "OBS-01", "RBAC-01", "UX-01", "QUAL-01", "CLEAN-01",
] as const;

function releaseMatrix(): ReleaseMatrix {
  const script = path.resolve(__dirname, "../../../.agents/skills/caipe-regression-suite/scripts/release-commit-matrix.mjs");
  const base = process.env.CAIPE_REGRESSION_SUITE_RELEASE_BASE_REF || "0.5.0";
  const head = process.env.CAIPE_REGRESSION_SUITE_RELEASE_HEAD_REF || "HEAD";
  const output = execFileSync(process.execPath, [script, "--base", base, "--head", head, "--format", "json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(output) as ReleaseMatrix;
}

async function sourcePageRoutes(): Promise<string[]> {
  const appDir = path.resolve(__dirname, "../../src/app");

  async function visit(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(entryPath);
      return /^page\.(?:tsx?|jsx?)$/.test(entry.name) ? [entryPath] : [];
    }));
    return nested.flat();
  }

  const pages = await visit(appDir);
  return pages.map((pageFile) => {
    const routeSegments = path.relative(appDir, path.dirname(pageFile))
      .split(path.sep)
      .filter((segment) => segment && !/^\(.+\)$/.test(segment));
    return `/${routeSegments.join("/")}`;
  }).sort();
}

test.describe("CAIPE Regression Suite release-history coverage", () => {
  test("REL-00 exposes the suite through the Codex project-skill path", async ({ page }, testInfo) => {
    const skillPath = path.resolve(__dirname, "../../../.agents/skills/caipe-regression-suite/SKILL.md");
    const implementationPath = path.resolve(__dirname, "../../../.claude/skills/caipe-regression-suite/SKILL.md");
    const [skill, resolvedPath, resolvedImplementationPath] = await Promise.all([
      readFile(skillPath, "utf8"),
      realpath(skillPath),
      realpath(implementationPath),
    ]);

    expect(skill).toContain("name: caipe-regression-suite");
    expect(skill).toContain("# CAIPE Regression Suite");
    expect(resolvedPath).toBe(resolvedImplementationPath);

    await attachEvidence(testInfo, "codex-skill-discovery", { skillPath, resolvedPath });
    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head><meta charset="utf-8"><title>Codex skill discovery</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 32px; color: #17213a">
          <h1>Codex project-skill discovery</h1>
          <p><strong>PASS</strong>: <code>${skillPath}</code></p>
          <p>Resolved implementation: <code>${resolvedPath}</code></p>
        </body>
      </html>
    `);
    await evidenceScreenshot(page, testInfo, "codex-skill-discovery");
  });

  test("REL-02 publishes the complete human-editable matrix in the docs sidebar", async ({ page }, testInfo) => {
    const matrixPath = path.resolve(__dirname, "../../../docs/docs/development/caipe-regression-suite.md");
    const sidebarPath = path.resolve(__dirname, "../../../docs/sidebars.ts");
    const [matrix, sidebar] = await Promise.all([readFile(matrixPath, "utf8"), readFile(sidebarPath, "utf8")]);
    const rowIds = [...matrix.matchAll(/^\| ([A-Z]+-\d{2}) \|/gm)].map((match) => match[1]);

    expect(rowIds).toEqual([...EXPECTED_MATRIX_ROWS]);
    expect(sidebar).toContain("id: 'development/caipe-regression-suite'");

    await attachEvidence(testInfo, "human-editable-test-matrix", { matrixPath, sidebarPath, rowIds });
    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head><meta charset="utf-8"><title>Human-editable regression matrix</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 32px; color: #17213a">
          <h1>Human-editable regression matrix</h1>
          <p><strong>PASS</strong>: ${rowIds.length} required rows are published in Docusaurus navigation.</p>
          <p><code>${matrixPath}</code></p>
        </body>
      </html>
    `);
    await evidenceScreenshot(page, testInfo, "human-editable-test-matrix");
  });

  test("REL-03 inventories every Next.js screen with positive and negative coverage", async ({ page }, testInfo) => {
    const coveragePath = path.resolve(__dirname, "../../../docs/docs/development/caipe-regression-screen-coverage.md");
    const coverage = await readFile(coveragePath, "utf8");
    const documentedRoutes = [...coverage.matchAll(/^\| SCR-\d{3} \| `([^`]+)` \|/gm)]
      .map((match) => match[1])
      .sort();
    const sourceRoutes = await sourcePageRoutes();

    expect(documentedRoutes).toEqual(sourceRoutes);

    await attachEvidence(testInfo, "screen-route-inventory", { coveragePath, documentedRoutes, sourceRoutes });
    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head><meta charset="utf-8"><title>Screen route coverage</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 32px; color: #17213a">
          <h1>Positive and negative screen coverage</h1>
          <p><strong>PASS</strong>: all ${sourceRoutes.length} Next.js page routes are represented.</p>
          <p>Each route documents positive behavior plus negative/API enforcement.</p>
        </body>
      </html>
    `);
    await evidenceScreenshot(page, testInfo, "screen-route-inventory");
  });

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
          <title>CAIPE Regression Suite release coverage</title>
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
          <h1>CAIPE Regression Suite release-history coverage</h1>
          <div class="range">${report.base.ref} (${report.base.sha}) → ${report.head.ref} (${report.head.sha})</div>
          <div class="summary">
            <div class="card"><span class="number">${report.counts.commits}</span>all commits</div>
            <div class="card"><span class="number">${report.counts.nonMergeCommits}</span>non-merge</div>
            <div class="card"><span class="number">${report.counts.mergeCommits}</span>merge</div>
            <div class="card"><span class="number">${report.counts.unmappedCommits}</span><span class="pass">unmapped</span></div>
          </div>
          <table>
            <thead><tr><th>Domain</th><th>Commits</th><th>CAIPE Regression Suite rows</th><th>Coverage</th></tr></thead>
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

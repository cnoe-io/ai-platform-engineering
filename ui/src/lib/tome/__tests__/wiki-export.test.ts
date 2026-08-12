/** @jest-environment node */

import { buildTree } from "@/lib/tome/schema";
import { renderWikiPdf, toPdfSafeText } from "@/lib/tome/wiki-export-pdf";
import {
  buildWikiExportDocument,
  renderWikiHtml,
  renderWikiMarkdown,
  stripAgentHtmlComments,
} from "@/lib/tome/wiki-export";

const pages = {
  "charter.md": `---
title: Project Charter
kind: stable
---
# Purpose

Visible. <!-- agent-only source guidance -->

| Metric | Target |
| --- | --- |
| Adoption | 80% |

<script>alert("unsafe")</script>`,
  "standup.md": `---
title: Weekly Standup
kind: report
---
## Status

On track.`,
  "memory.md": `---
title: Memory
kind: hidden
---
Private project memory.`,
  "repos/example/overview.md": `---
title: Repository Overview
kind: dynamic
---
Repository details.`,
};

describe("Tome wiki export", () => {
  it("uses readable PDF fallbacks for unsupported emoji", () => {
    expect(toPdfSafeText("✅ ready 🟢 · ❌ failed 🚧")).toBe("✓ ready ● · × failed ◆");
  });

  it("strips multiline agent-only HTML comments", () => {
    expect(stripAgentHtmlComments("before <!-- hidden\nsource --> after")).toBe("before  after");
  });

  it("builds canonical order including report and hidden pages", () => {
    const document = buildWikiExportDocument({
      projectName: "Example Project",
      pages,
      tree: buildTree(pages),
      exportedAt: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(document.pages.map((page) => page.path)).toEqual([
      "standup.md",
      "charter.md",
      "memory.md",
      "repos/example/overview.md",
    ]);
    expect(document.pages.map((page) => page.kind)).toEqual([
      "report",
      "stable",
      "hidden",
      "dynamic",
    ]);
    expect(document.pages[1].body).not.toContain("agent-only source guidance");
  });

  it("renders safe, styled HTML and portable Markdown", () => {
    const document = buildWikiExportDocument({
      projectName: "Example Project",
      pages,
      tree: buildTree(pages),
      exportedAt: new Date("2026-08-11T12:00:00.000Z"),
    });
    const html = renderWikiHtml(document);
    const markdown = renderWikiMarkdown(document);

    expect(html).toContain("<table>");
    expect(html).toContain("badge-hidden");
    expect(html).not.toContain("agent-only source guidance");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
    expect(html).toContain("width: min(960px, calc(100% - 32px))");
    expect(html).toContain("@media print");
    expect(html).toContain("August 11, 2026 at 12:00 PM UTC");
    expect(markdown).toContain("`charter.md` · **stable**");
    expect(markdown).not.toContain("agent-only source guidance");
  });

  it("generates an actual PDF buffer", async () => {
    const document = buildWikiExportDocument({
      projectName: "Example Project",
      pages,
      tree: buildTree(pages),
      exportedAt: new Date("2026-08-11T12:00:00.000Z"),
    });
    const pdf = await renderWikiPdf(document);

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(2_000);
    const rawPdf = pdf.toString("latin1");
    expect(rawPdf).not.toContain("agent-only source guidance");
    expect(rawPdf).toContain("DejaVuSans");
    expect(rawPdf).not.toContain("/BaseFont /Helvetica");
    expect(rawPdf.match(/\/Type \/Page\b/g)).toHaveLength(6);
  });
});

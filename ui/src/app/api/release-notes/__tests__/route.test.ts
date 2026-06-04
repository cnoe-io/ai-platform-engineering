/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const RAW_BASE = "https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/docs/releases";

const LISTING = [
  { name: "README.md", type: "file", download_url: `${RAW_BASE}/README.md` },
  { name: "2026-05-29-release-0-5-4.md", type: "file", download_url: `${RAW_BASE}/2026-05-29-release-0-5-4.md` },
  { name: "2026-06-01-release-0-5-6.md", type: "file", download_url: `${RAW_BASE}/2026-06-01-release-0-5-6.md` },
  { name: "subdir", type: "dir", download_url: null },
];

const BODY_054 = `---
slug: release-0.5.4
title: "Release 0.5.4 — Admin UI Polish"
date: 2026-05-29
---

> Released: 2026-05-29

## Highlights

A small maintenance release.

<!-- truncate -->

## What's New

- **Admin UI**: shared pickers

## Upgrade Guide: 0.5.3 → 0.5.4

Run the migration runbook before applying schema changes.
`;

const BODY_056 = `---
title: "Release 0.5.6 — Big Stuff"
date: 2026-06-01
---

## Highlights

Newest available notes.
`;

function mockGithub() {
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("api.github.com")) {
      return { ok: true, json: async () => LISTING } as unknown as Response;
    }
    if (u.endsWith("0-5-4.md")) {
      return { ok: true, text: async () => BODY_054 } as unknown as Response;
    }
    if (u.endsWith("0-5-6.md")) {
      return { ok: true, text: async () => BODY_056 } as unknown as Response;
    }
    return { ok: false, status: 404, text: async () => "", json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

async function callGet(version: string) {
  jest.resetModules();
  mockGithub();
  const { GET } = await import("../route");
  const res = await GET(new NextRequest(`http://localhost/api/release-notes?version=${version}`));
  return res.json();
}

describe("/api/release-notes", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the exact curated notes with frontmatter and truncate marker stripped", async () => {
    const data = await callGet("0.5.4");
    expect(data.matchedVersion).toBe("0.5.4");
    expect(data.title).toBe("Release 0.5.4 — Admin UI Polish");
    // Frontmatter is removed.
    expect(data.body).not.toContain("slug: release-0.5.4");
    // Docusaurus truncate marker is removed.
    expect(data.body).not.toContain("<!-- truncate -->");
    // Real markdown content is preserved.
    expect(data.body).toContain("## What's New");
    expect(data.body).toContain("Run the migration runbook");
  });

  it("falls back to the nearest lower release when the exact version is missing", async () => {
    // 0.5.7 has no file; the newest at-or-below is 0.5.6.
    const data = await callGet("0.5.7-dev.14");
    expect(data.matchedVersion).toBe("0.5.6");
    expect(data.body).toContain("Newest available notes.");
  });

  it("returns 400 when no version is provided", async () => {
    jest.resetModules();
    mockGithub();
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("http://localhost/api/release-notes"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.body).toBeNull();
  });
});

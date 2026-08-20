/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import fs from "fs";

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

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
    let hostname = "";
    try {
      hostname = new URL(u).hostname;
    } catch {
      hostname = "";
    }
    if (hostname === "api.github.com") {
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
  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.RELEASE_NOTES_GITHUB_TOKEN;
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

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

  it("prefers exact generated mirror main increment notes over the stable base release", async () => {
    jest.resetModules();
    const version = "0.5.63-ui-main-a5ba46dd5";
    const generatedPath = "main-increment-release-notes.json";
    jest.spyOn(fs, "existsSync").mockImplementation((candidate) =>
      String(candidate).endsWith(generatedPath),
    );
    jest.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        version,
        previousVersion: "0.5.63-ui-main-9ea3d7d28",
        title: "Mirror main update a5ba46dd5",
        date: "2026-08-09",
        body: "## What's New\n\n- Mirror-only update",
        changelogUrl: "https://github.com/example/repository/compare/previous...current",
      }),
    );
    global.fetch = jest.fn(() => {
      throw new Error("Generated notes should not fetch upstream content");
    }) as unknown as typeof fetch;

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest(`http://localhost/api/release-notes?version=${version}`),
    );
    const data = await response.json();

    expect(data).toMatchObject({
      matchedVersion: version,
      source: "generated",
      body: expect.stringContaining("Mirror-only update"),
      changelogUrl: expect.stringContaining("example/repository/compare"),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("builds release notes from an explicitly configured GitHub commit range", async () => {
    jest.resetModules();
    process.env.RELEASE_NOTES_GITHUB_TOKEN = "test-token";
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "platform_settings",
        release_notes: {
          repository_url: "https://github.com/example/repository",
          previous_commit: "1111111",
          latest_commit: "3333333",
        },
      }),
    });
    global.fetch = jest.fn(async (_url: string | URL, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        html_url: "https://github.com/example/repository/compare/1111111...3333333",
        commits: [
          {
            sha: "2222222",
            commit: {
              message: "feat(ui): add a useful setting (#42)",
              committer: { date: "2026-08-14T12:00:00Z" },
            },
          },
          {
            sha: "3333333",
            commit: {
              message: "fix(api): handle invalid input",
              committer: { date: "2026-08-15T12:00:00Z" },
            },
          },
        ],
      }),
      headers: init?.headers,
    })) as unknown as typeof fetch;

    const { GET } = await import("../route");
    const params = new URLSearchParams({ version: "1.2.3", compare: "platform" });
    const response = await GET(
      new NextRequest(`http://localhost/api/release-notes?${params.toString()}`),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      requestedVersion: "1.2.3",
      matchedVersion: "1.2.3",
      source: "github-compare",
      date: "2026-08-15",
      changelogUrl: "https://github.com/example/repository/compare/1111111...3333333",
    });
    expect(data.body).toContain("## What's New");
    expect(data.body).toContain("add a useful setting");
    expect(data.body).toContain("## Bug Fixes");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/repos/example/repository/compare/1111111...3333333"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("uses the compose GitHub personal access token for private comparisons", async () => {
    jest.resetModules();
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = "compose-pat";
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "platform_settings",
        release_notes: {
          repository_url: "https://github.com/example/private-repository",
          previous_commit: "1111111",
          latest_commit: "2222222",
        },
      }),
    });
    global.fetch = jest.fn(async (_url: string | URL, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        html_url: "https://github.com/example/private-repository/compare/1111111...2222222",
        commits: [],
      }),
      headers: init?.headers,
    })) as unknown as typeof fetch;

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest("http://localhost/api/release-notes?version=1.2.3&compare=platform"),
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/repos/example/private-repository/compare/1111111...2222222"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer compose-pat" }),
      }),
    );
  });

  it("rejects an incomplete stored GitHub compare configuration", async () => {
    jest.resetModules();
    mockGithub();
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "platform_settings",
        release_notes: { previous_commit: "1111111" },
      }),
    });
    const { GET } = await import("../route");
    const res = await GET(
      new NextRequest("http://localhost/api/release-notes?version=1.2.3&compare=platform"),
    );
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not fall back to an older release when the exact version is missing", async () => {
    const data = await callGet("0.5.7-dev.14");
    expect(data.matchedVersion).toBeNull();
    expect(data.body).toBeNull();
    expect(data.source).toBe("none");
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

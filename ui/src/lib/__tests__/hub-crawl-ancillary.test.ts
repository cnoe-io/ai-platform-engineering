/**
 * Tests for the GitHub hub crawler's ancillary-file collection.
 *
 * These tests focus on the new behaviour added so multi-file Anthropic-style
 * skills (e.g. `pdf`, `docx`, `slack`) install verbatim. We mock the GitHub
 * REST API surface (`/git/trees/HEAD?recursive=1` and `/contents/...`) so
 * the crawler's fetch logic is exercised end-to-end without hitting the
 * network.
 */

// Avoid loading the real mongodb driver (ESM `bson`) — `hub-crawl` imports
// `getCollection`, but `crawlGitHubRepo` itself never touches Mongo.
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

jest.mock("@/lib/api-middleware", () => ({
  validateCredentialsRef: jest.fn(),
}));

import { crawlGitHubRepo } from "../hub-crawl";

type FetchInput = string | URL | Request;

interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

interface FakeRepo {
  tree: TreeEntry[];
  /** Map of path → UTF-8 file content. */
  files: Record<string, string>;
}

function buildContentsResponse(text: string) {
  return {
    content: Buffer.from(text, "utf-8").toString("base64"),
    encoding: "base64",
  };
}

/** Minimal stand-in for the bits of `Response` the hub crawler uses. */
function fakeResponse(body: unknown, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(typeof body === "string" ? body : JSON.parse(text)),
  } as unknown as Response;
}

function installFakeFetch(repo: FakeRepo) {
  const fetchMock = jest.fn(async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/git/trees/HEAD?recursive=1")) {
      return fakeResponse({ tree: repo.tree });
    }

    const m = url.match(/\/contents\/(.+)$/);
    if (m) {
      const path = decodeURIComponent(m[1]);
      const content = repo.files[path];
      if (content === undefined) {
        return fakeResponse("not found", 404);
      }
      return fakeResponse(buildContentsResponse(content));
    }

    return fakeResponse("unexpected url: " + url, 500);
  });

  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("crawlGitHubRepo (ancillary collection)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("captures sibling text files alongside SKILL.md", async () => {
    const skillMd = [
      "---",
      "name: pdf",
      "description: Process PDFs",
      "---",
      "",
      "# PDF",
      "Use scripts/extract.py to read PDFs.",
    ].join("\n");

    const extractPy = "#!/usr/bin/env python3\nprint('hello')\n";
    const refsJson = JSON.stringify({ formats: ["pdf"] });

    const repo: FakeRepo = {
      tree: [
        { path: "skills/pdf/SKILL.md", type: "blob", sha: "a", size: skillMd.length, url: "x" },
        { path: "skills/pdf/scripts/extract.py", type: "blob", sha: "b", size: extractPy.length, url: "x" },
        { path: "skills/pdf/references/forms.json", type: "blob", sha: "c", size: refsJson.length, url: "x" },
      ],
      files: {
        "skills/pdf/SKILL.md": skillMd,
        "skills/pdf/scripts/extract.py": extractPy,
        "skills/pdf/references/forms.json": refsJson,
      },
    };

    installFakeFetch(repo);

    const skills = await crawlGitHubRepo("anthropic", "skills");
    expect(skills).toHaveLength(1);
    const [skill] = skills;
    expect(skill.id).toBe("pdf");
    expect(skill.path).toBe("skills/pdf/SKILL.md");
    expect(skill.ancillary_files).toEqual({
      "scripts/extract.py": extractPy,
      "references/forms.json": refsJson,
    });
    expect(skill.ancillary_summary).toMatchObject({
      total_files: 2,
      skipped_binary: 0,
      skipped_too_large: 0,
      truncated_at_count_cap: false,
      truncated_at_size_cap: false,
    });
    expect(skill.ancillary_summary?.total_bytes).toBe(extractPy.length + refsJson.length);
  });

  it("skips binary files (by extension) and tallies them in the summary", async () => {
    const skillMd = "---\nname: pdf\ndescription: x\n---\n";
    const repo: FakeRepo = {
      tree: [
        { path: "pdf/SKILL.md", type: "blob", sha: "a", size: skillMd.length, url: "x" },
        { path: "pdf/assets/logo.png", type: "blob", sha: "b", size: 4096, url: "x" },
        { path: "pdf/scripts/run.sh", type: "blob", sha: "c", size: 20, url: "x" },
      ],
      files: {
        "pdf/SKILL.md": skillMd,
        "pdf/scripts/run.sh": "#!/bin/sh\necho hi\n",
        // logo.png intentionally omitted from `files` — the crawler must
        // skip it before issuing a contents request, so a missing entry
        // here would only matter if that pre-fetch skip regressed.
      },
    };
    installFakeFetch(repo);

    const [skill] = await crawlGitHubRepo("o", "r");
    expect(Object.keys(skill.ancillary_files ?? {})).toEqual(["scripts/run.sh"]);
    expect(skill.ancillary_summary?.skipped_binary).toBe(1);
  });

  it("does not pull files belonging to a nested skill into the parent", async () => {
    const parentMd = "---\nname: parent\ndescription: x\n---\n";
    const childMd = "---\nname: child\ndescription: y\n---\n";
    const repo: FakeRepo = {
      tree: [
        { path: "skills/parent/SKILL.md", type: "blob", sha: "a", size: parentMd.length, url: "x" },
        { path: "skills/parent/notes.md", type: "blob", sha: "b", size: 5, url: "x" },
        { path: "skills/parent/child/SKILL.md", type: "blob", sha: "c", size: childMd.length, url: "x" },
        { path: "skills/parent/child/extra.py", type: "blob", sha: "d", size: 8, url: "x" },
      ],
      files: {
        "skills/parent/SKILL.md": parentMd,
        "skills/parent/notes.md": "hello",
        "skills/parent/child/SKILL.md": childMd,
        "skills/parent/child/extra.py": "x = 1\n",
      },
    };
    installFakeFetch(repo);

    const skills = await crawlGitHubRepo("o", "r");
    expect(skills.map((s) => s.id).sort()).toEqual(["child", "parent"]);
    const parent = skills.find((s) => s.id === "parent")!;
    const child = skills.find((s) => s.id === "child")!;

    // Parent ONLY owns its own siblings — child's files belong to the
    // child skill and must not appear in the parent's ancillary map.
    expect(Object.keys(parent.ancillary_files ?? {})).toEqual(["notes.md"]);
    expect(Object.keys(child.ancillary_files ?? {})).toEqual(["extra.py"]);
  });

  it("extracts metadata.json from ancillary files without a second fetch", async () => {
    const skillMd = "---\nname: x\ndescription: y\n---\n";
    const meta = JSON.stringify({ category: "demo", tags: ["a"] });
    const repo: FakeRepo = {
      tree: [
        { path: "x/SKILL.md", type: "blob", sha: "a", size: skillMd.length, url: "u" },
        { path: "x/metadata.json", type: "blob", sha: "b", size: meta.length, url: "u" },
      ],
      files: {
        "x/SKILL.md": skillMd,
        "x/metadata.json": meta,
      },
    };
    installFakeFetch(repo);

    const [skill] = await crawlGitHubRepo("o", "r");
    expect(skill.metadata).toMatchObject({ category: "demo", tags: ["a"] });
    expect(skill.ancillary_files?.["metadata.json"]).toBe(meta);
  });
});

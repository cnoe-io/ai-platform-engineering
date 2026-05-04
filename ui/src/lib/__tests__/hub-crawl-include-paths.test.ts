/**
 * Tests for the optional `includePaths` filter on `crawlGitHubRepo` and
 * `crawlGitLabRepo` (FR-021).
 *
 * Confirms three things:
 *   1. With `includePaths: []` (or omitted), behavior matches today's
 *      "walk the whole repo" semantics — full back-compat.
 *   2. With non-empty `includePaths`, the SKILL.md candidate list is
 *      filtered to entries whose path begins with one of the prefixes,
 *      and each prefix is normalized to a trailing slash so `skills` does
 *      not match `skills-archive/SKILL.md`.
 *   3. The `belongsToNestedSkill` invariant still holds — a SKILL.md
 *      under a deeper directory still owns its own siblings (no leakage
 *      into a parent's `ancillary_files`) when both pass the filter.
 */

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

jest.mock("@/lib/api-middleware", () => ({
  validateCredentialsRef: jest.fn(),
}));

import { crawlGitHubRepo, crawlGitLabRepo } from "../hub-crawl";

type FetchInput = string | URL | Request;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

interface FakeGitHubRepo {
  tree: Array<{ path: string; type: "blob" | "tree"; sha: string; size?: number; url: string }>;
  files: Record<string, string>;
}

function installFakeGitHubFetch(repo: FakeGitHubRepo) {
  const mock = jest.fn(async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/git/trees/HEAD?recursive=1")) {
      return fakeResponse({ tree: repo.tree });
    }
    const m = url.match(/\/contents\/(.+)$/);
    if (m) {
      const path = decodeURIComponent(m[1]);
      const content = repo.files[path];
      if (content === undefined) return fakeResponse("not found", 404);
      return fakeResponse({
        content: Buffer.from(content, "utf-8").toString("base64"),
        encoding: "base64",
      });
    }
    return fakeResponse("unexpected url: " + url, 500);
  });
  (global as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

interface FakeGitLabRepo {
  tree: Array<{ id: string; name: string; type: "blob" | "tree"; path: string; mode: string }>;
  files: Record<string, string>;
}

function installFakeGitLabFetch(repo: FakeGitLabRepo) {
  const mock = jest.fn(async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/repository/tree?recursive=true")) {
      return fakeResponse(repo.tree);
    }
    const m = url.match(/\/repository\/files\/([^/]+)\/raw/);
    if (m) {
      const path = decodeURIComponent(m[1]);
      const content = repo.files[path];
      if (content === undefined) return fakeResponse("not found", 404);
      return fakeResponse(content);
    }
    return fakeResponse("unexpected url: " + url, 500);
  });
  (global as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

const SKILL_MD = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nbody`;

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

describe("crawlGitHubRepo includePaths filter", () => {
  const githubRepo: FakeGitHubRepo = {
    tree: [
      // In-prefix: skills/foo + skills/bar (two siblings)
      { path: "skills/foo/SKILL.md", type: "blob", sha: "1", size: 100, url: "" },
      { path: "skills/foo/helper.py", type: "blob", sha: "2", size: 50, url: "" },
      { path: "skills/bar/SKILL.md", type: "blob", sha: "3", size: 80, url: "" },

      // In a different in-prefix (agents/ops/skills/baz)
      { path: "agents/ops/skills/baz/SKILL.md", type: "blob", sha: "4", size: 120, url: "" },

      // OUT of prefix — `skills-archive` must not match `skills/`
      { path: "skills-archive/old/SKILL.md", type: "blob", sha: "5", size: 90, url: "" },
      // OUT of prefix — `vendor` is unrelated
      { path: "vendor/third-party/SKILL.md", type: "blob", sha: "6", size: 90, url: "" },
    ],
    files: {
      "skills/foo/SKILL.md": SKILL_MD("foo"),
      "skills/foo/helper.py": "print('hi')",
      "skills/bar/SKILL.md": SKILL_MD("bar"),
      "agents/ops/skills/baz/SKILL.md": SKILL_MD("baz"),
      "skills-archive/old/SKILL.md": SKILL_MD("old"),
      "vendor/third-party/SKILL.md": SKILL_MD("vendor"),
    },
  };

  beforeEach(() => {
    installFakeGitHubFetch(githubRepo);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("crawls every SKILL.md when includePaths is omitted", async () => {
    const skills = await crawlGitHubRepo("o", "r");
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["bar", "baz", "foo", "old", "vendor"]);
  });

  it("crawls every SKILL.md when includePaths is empty (back-compat)", async () => {
    const skills = await crawlGitHubRepo("o", "r", undefined, []);
    expect(skills.map((s) => s.name).sort()).toEqual([
      "bar",
      "baz",
      "foo",
      "old",
      "vendor",
    ]);
  });

  it("filters SKILL.md candidates to the configured prefixes", async () => {
    const skills = await crawlGitHubRepo("o", "r", undefined, [
      "skills/",
      "agents/ops/skills/",
    ]);
    expect(skills.map((s) => s.name).sort()).toEqual(["bar", "baz", "foo"]);
  });

  it("normalizes prefixes without trailing slash so 'skills' does not match 'skills-archive/'", async () => {
    const skills = await crawlGitHubRepo("o", "r", undefined, ["skills"]);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["bar", "foo"]);
    expect(names).not.toContain("old"); // skills-archive/...
  });

  it("returns an empty list when no SKILL.md matches", async () => {
    const skills = await crawlGitHubRepo("o", "r", undefined, [
      "no-such-prefix/",
    ]);
    expect(skills).toEqual([]);
  });

  it("preserves ancillary siblings of accepted SKILL.md files", async () => {
    const skills = await crawlGitHubRepo("o", "r", undefined, ["skills/"]);
    const foo = skills.find((s) => s.name === "foo");
    expect(foo).toBeDefined();
    expect(foo!.ancillary_files).toBeDefined();
    expect(Object.keys(foo!.ancillary_files!)).toContain("helper.py");
  });
});

// ---------------------------------------------------------------------------
// GitHub: belongsToNestedSkill invariant
// ---------------------------------------------------------------------------

describe("crawlGitHubRepo nested-skill invariant with includePaths", () => {
  const nestedRepo: FakeGitHubRepo = {
    tree: [
      // A parent skill at skills/parent/ with SKILL.md and a helper file.
      { path: "skills/parent/SKILL.md", type: "blob", sha: "1", size: 100, url: "" },
      { path: "skills/parent/parent-helper.py", type: "blob", sha: "2", size: 50, url: "" },
      // A nested skill at skills/parent/child/ with its own SKILL.md and
      // its own helper. The parent's `ancillary_files` MUST NOT contain
      // anything from the child path even when the include filter accepts both.
      { path: "skills/parent/child/SKILL.md", type: "blob", sha: "3", size: 80, url: "" },
      { path: "skills/parent/child/child-helper.py", type: "blob", sha: "4", size: 30, url: "" },
    ],
    files: {
      "skills/parent/SKILL.md": SKILL_MD("parent"),
      "skills/parent/parent-helper.py": "parent",
      "skills/parent/child/SKILL.md": SKILL_MD("child"),
      "skills/parent/child/child-helper.py": "child",
    },
  };

  beforeEach(() => {
    installFakeGitHubFetch(nestedRepo);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("does not leak nested skill files into the parent's ancillaries (filter accepts both)", async () => {
    const skills = await crawlGitHubRepo("o", "r", undefined, ["skills/"]);
    const parent = skills.find((s) => s.name === "parent");
    const child = skills.find((s) => s.name === "child");
    expect(parent).toBeDefined();
    expect(child).toBeDefined();

    // Parent has its own helper, NOT the child's
    expect(Object.keys(parent!.ancillary_files ?? {})).toEqual(["parent-helper.py"]);
    // Child has its own helper
    expect(Object.keys(child!.ancillary_files ?? {})).toEqual(["child-helper.py"]);
  });
});

// ---------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------

describe("crawlGitLabRepo includePaths filter", () => {
  const gitlabRepo: FakeGitLabRepo = {
    tree: [
      { id: "a", name: "SKILL.md", type: "blob", path: "skills/foo/SKILL.md", mode: "100644" },
      { id: "b", name: "SKILL.md", type: "blob", path: "skills/bar/SKILL.md", mode: "100644" },
      { id: "c", name: "SKILL.md", type: "blob", path: "vendor/third/SKILL.md", mode: "100644" },
      { id: "d", name: "SKILL.md", type: "blob", path: "skills-archive/old/SKILL.md", mode: "100644" },
    ],
    files: {
      "skills/foo/SKILL.md": SKILL_MD("foo"),
      "skills/bar/SKILL.md": SKILL_MD("bar"),
      "vendor/third/SKILL.md": SKILL_MD("vendor"),
      "skills-archive/old/SKILL.md": SKILL_MD("old"),
    },
  };

  beforeEach(() => {
    installFakeGitLabFetch(gitlabRepo);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("crawls every SKILL.md when includePaths is omitted", async () => {
    const skills = await crawlGitLabRepo("mycorp/platform");
    expect(skills.map((s) => s.name).sort()).toEqual([
      "bar",
      "foo",
      "old",
      "vendor",
    ]);
  });

  it("filters SKILL.md candidates to the configured prefixes", async () => {
    const skills = await crawlGitLabRepo("mycorp/platform", undefined, ["skills/"]);
    expect(skills.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
  });

  it("trailing-slash normalization prevents prefix bleed", async () => {
    // 'skills' (no trailing /) MUST behave the same as 'skills/' — i.e.
    // it does NOT match `skills-archive/`.
    const skills = await crawlGitLabRepo("mycorp/platform", undefined, ["skills"]);
    expect(skills.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
  });
});

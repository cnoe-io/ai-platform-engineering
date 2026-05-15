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

function fakeResponse(
  body: unknown,
  status = 200,
  responseHeaders: Record<string, string> = {},
) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  // Minimal Headers-like shim so callers using `res.headers.get(name)` work.
  // The GitLab crawler reads `x-next-page` for pagination — tests can set
  // it via `responseHeaders` to simulate multi-page tree responses.
  const lower = Object.fromEntries(
    Object.entries(responseHeaders).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const headers = {
    get: (name: string) => lower[name.toLowerCase()] ?? null,
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(typeof body === "string" ? body : JSON.parse(text)),
  } as unknown as Response;
}

interface FakeGitHubRepo {
  tree: Array<{ path: string; type: "blob" | "tree"; sha: string; size?: number; url: string }>;
  files: Record<string, string>;
}

function installFakeGitHubFetch(
  repo: FakeGitHubRepo,
  options: { truncated?: boolean } = {},
) {
  const mock = jest.fn(async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/git/trees/HEAD?recursive=1")) {
      // GitHub's Git Trees API sets `truncated: true` when it had to drop
      // entries from the response (>100k entries or >7MB). Tests opt in
      // via `options.truncated` to exercise the crawler's overflow guard.
      const body: { tree: typeof repo.tree; truncated?: boolean } = {
        tree: repo.tree,
      };
      if (options.truncated) body.truncated = true;
      return fakeResponse(body);
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

function installFakeGitLabFetch(
  repo: FakeGitLabRepo,
  options: { pageSize?: number } = {},
) {
  // GitLab returns up to `per_page=100` tree entries per request and
  // signals more pages via the `x-next-page` header. Mirror that here so
  // pagination logic in `crawlGitLabRepo` is actually exercised; tests
  // that don't care about pagination can leave repos under the page
  // size and still get a single-page response.
  const pageSize = options.pageSize ?? 100;
  const mock = jest.fn(async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/repository/tree?recursive=true")) {
      const pageMatch = url.match(/[?&]page=(\d+)/);
      const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
      const start = (page - 1) * pageSize;
      const slice = repo.tree.slice(start, start + pageSize);
      const totalPages = Math.max(1, Math.ceil(repo.tree.length / pageSize));
      const headers: Record<string, string> = {};
      if (page < totalPages) {
        headers["x-next-page"] = String(page + 1);
      }
      return fakeResponse(slice, 200, headers);
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
    const { skills } = await crawlGitHubRepo("o", "r");
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["bar", "baz", "foo", "old", "vendor"]);
  });

  it("crawls every SKILL.md when includePaths is empty (back-compat)", async () => {
    const { skills } = await crawlGitHubRepo("o", "r", undefined, []);
    expect(skills.map((s) => s.name).sort()).toEqual([
      "bar",
      "baz",
      "foo",
      "old",
      "vendor",
    ]);
  });

  it("filters SKILL.md candidates to the configured prefixes", async () => {
    const { skills } = await crawlGitHubRepo("o", "r", undefined, [
      "skills/",
      "agents/ops/skills/",
    ]);
    expect(skills.map((s) => s.name).sort()).toEqual(["bar", "baz", "foo"]);
  });

  it("normalizes prefixes without trailing slash so 'skills' does not match 'skills-archive/'", async () => {
    const { skills } = await crawlGitHubRepo("o", "r", undefined, ["skills"]);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["bar", "foo"]);
    expect(names).not.toContain("old"); // skills-archive/...
  });

  it("returns an empty list when no SKILL.md matches", async () => {
    const { skills } = await crawlGitHubRepo("o", "r", undefined, [
      "no-such-prefix/",
    ]);
    expect(skills).toEqual([]);
  });

  it("preserves ancillary siblings of accepted SKILL.md files", async () => {
    const { skills } = await crawlGitHubRepo("o", "r", undefined, ["skills/"]);
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
    const { skills } = await crawlGitHubRepo("o", "r", undefined, ["skills/"]);
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

describe("crawlGitHubRepo tree truncation", () => {
  // Regression: GitHub's Git Trees API caps responses at ~100k entries / 7MB
  // and signals overflow via `truncated: true`, silently dropping the rest.
  // The crawler now surfaces the truncation via the `CrawlResult.truncation`
  // discriminator (instead of throwing) so the admin UI can persist a
  // yellow "skills past the API limit may be missing" warning on the hub
  // doc and offer an "Add include_paths" CTA. Whatever entries DID come
  // back are still returned — a partial set is more useful than nothing.
  it("returns kind: 'platform' truncation when GitHub flags the tree as truncated", async () => {
    const repo: FakeGitHubRepo = {
      tree: [
        { path: "skills/foo/SKILL.md", type: "blob", sha: "1", size: 100, url: "" },
      ],
      files: { "skills/foo/SKILL.md": SKILL_MD("foo") },
    };
    installFakeGitHubFetch(repo, { truncated: true });

    const { skills, truncation } = await crawlGitHubRepo("o", "r");

    // We still return whatever entries fit in the response.
    expect(skills.map((s) => s.name)).toEqual(["foo"]);
    expect(truncation.kind).toBe("platform");
    if (truncation.kind === "platform") {
      expect(truncation.pages_walked).toBe(1);
      expect(truncation.reason).toMatch(/truncated/i);
    }
  });

  it("returns kind: 'ok' when GitHub does not flag the response as truncated", async () => {
    // Sanity: the default `truncated` flag is absent and the crawler
    // returns a clean `kind: 'ok'` signal. Guards against accidentally
    // making the truncation check fire on every crawl.
    const repo: FakeGitHubRepo = {
      tree: [
        { path: "skills/foo/SKILL.md", type: "blob", sha: "1", size: 100, url: "" },
      ],
      files: { "skills/foo/SKILL.md": SKILL_MD("foo") },
    };
    installFakeGitHubFetch(repo);

    const { skills, truncation } = await crawlGitHubRepo("o", "r");
    expect(skills.map((s) => s.name)).toEqual(["foo"]);
    expect(truncation.kind).toBe("ok");
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
    const { skills, truncation } = await crawlGitLabRepo("mycorp/platform");
    expect(skills.map((s) => s.name).sort()).toEqual([
      "bar",
      "foo",
      "old",
      "vendor",
    ]);
    expect(truncation.kind).toBe("ok");
  });

  it("filters SKILL.md candidates to the configured prefixes", async () => {
    const { skills } = await crawlGitLabRepo("mycorp/platform", undefined, ["skills/"]);
    expect(skills.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
  });

  it("trailing-slash normalization prevents prefix bleed", async () => {
    // 'skills' (no trailing /) MUST behave the same as 'skills/' — i.e.
    // it does NOT match `skills-archive/`.
    const { skills } = await crawlGitLabRepo("mycorp/platform", undefined, ["skills"]);
    expect(skills.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
  });
});

describe("crawlGitLabRepo tree pagination", () => {
  // Regression: real-world repos like `gitlab-org/ai/skills` ship enough
  // top-level files (e.g. `.claude-plugin/...`) to push every
  // `skills/<name>/SKILL.md` past page 1 of GitLab's recursive tree
  // endpoint. Without pagination the crawler returned 0 skills even
  // though the repo had 10. The mock pageSize is set tiny so the test
  // exercises the loop without needing a giant fixture.
  it("walks every page of the recursive tree to discover skills past page 1", async () => {
    const filler = Array.from({ length: 5 }, (_, i) => ({
      id: `f${i}`,
      name: "plugin.json",
      type: "blob" as const,
      path: `.claude-plugin/plugins/p${i}/plugin.json`,
      mode: "100644",
    }));
    const skillEntries = [
      { id: "s1", name: "SKILL.md", type: "blob" as const, path: "skills/foo/SKILL.md", mode: "100644" },
      { id: "s2", name: "SKILL.md", type: "blob" as const, path: "skills/bar/SKILL.md", mode: "100644" },
    ];
    const repo: FakeGitLabRepo = {
      // Filler entries first so they fill page 1 entirely; SKILL.md
      // entries land on page 2 with pageSize=3.
      tree: [...filler, ...skillEntries],
      files: {
        "skills/foo/SKILL.md": SKILL_MD("foo"),
        "skills/bar/SKILL.md": SKILL_MD("bar"),
      },
    };
    const fetchMock = installFakeGitLabFetch(repo, { pageSize: 3 });

    const { skills, truncation } = await crawlGitLabRepo("mycorp/platform");

    expect(skills.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
    expect(truncation.kind).toBe("ok");
    if (truncation.kind === "ok") {
      // 7-entry fixture at pageSize=3 → page 1 (3) + page 2 (3) + page 3 (1).
      expect(truncation.pages_walked).toBe(3);
    }

    // Confirm both pages were actually requested — guards against a
    // future regression where someone drops the loop.
    const treeCalls = fetchMock.mock.calls
      .map(([input]) => (typeof input === "string" ? input : (input as URL | Request).toString()))
      .filter((u) => u.includes("/repository/tree?recursive=true"));
    expect(treeCalls.length).toBeGreaterThanOrEqual(2);
    expect(treeCalls.some((u) => /[?&]page=1\b/.test(u))).toBe(true);
    expect(treeCalls.some((u) => /[?&]page=2\b/.test(u))).toBe(true);
  });

  it("stops at the per-hub maxTreePages cap and reports kind: 'cap' truncation", async () => {
    // Build a repo with enough fillers to span 4 pages at pageSize=3,
    // with the actual SKILL.md sitting on page 1 (so we can assert
    // skills come back even though we stopped early). The crawler
    // should walk exactly 2 pages before bailing.
    const filler = Array.from({ length: 11 }, (_, i) => ({
      id: `f${i}`,
      name: "plugin.json",
      type: "blob" as const,
      path: `.claude-plugin/plugins/p${i.toString().padStart(2, "0")}/plugin.json`,
      mode: "100644",
    }));
    const skillEntries = [
      { id: "s1", name: "SKILL.md", type: "blob" as const, path: "skills/foo/SKILL.md", mode: "100644" },
    ];
    const repo: FakeGitLabRepo = {
      // Skill on page 1 (pageSize=3, so page 1 = filler 0..1 + skill).
      tree: [filler[0], filler[1], ...skillEntries, ...filler.slice(2)],
      files: { "skills/foo/SKILL.md": SKILL_MD("foo") },
    };
    const fetchMock = installFakeGitLabFetch(repo, { pageSize: 3 });

    const { skills, truncation } = await crawlGitLabRepo(
      "mycorp/platform",
      undefined,
      undefined,
      2, // cap at 2 pages — will leave page 3+ unread
    );

    expect(skills.map((s) => s.name)).toEqual(["foo"]);
    expect(truncation.kind).toBe("cap");
    if (truncation.kind === "cap") {
      expect(truncation.pages_walked).toBe(2);
      expect(truncation.cap).toBe(2);
    }

    const treeCalls = fetchMock.mock.calls
      .map(([input]) => (typeof input === "string" ? input : (input as URL | Request).toString()))
      .filter((u) => u.includes("/repository/tree?recursive=true"));
    // Pages 1 + 2 only — page 3 must not have been requested.
    expect(treeCalls.some((u) => /[?&]page=2\b/.test(u))).toBe(true);
    expect(treeCalls.some((u) => /[?&]page=3\b/.test(u))).toBe(false);
  });
});

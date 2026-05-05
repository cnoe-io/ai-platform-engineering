/**
 * @jest-environment node
 *
 * Tests for the source-agnostic `runImport` helper that powers
 * `POST /api/skills/import`. Covers:
 *   - GitHub branch (matches legacy `import-github` behavior; SKILL.md excluded)
 *   - GitLab branch (PRIVATE-TOKEN header, encoded subgroup paths, raw blob fetch)
 *   - Multi-path merge with first-wins conflict reporting
 *   - Legacy single-`path` body shape (back-compat with `import-github` callers)
 *   - Validation errors (no paths, too many, bad source)
 *
 * Mirrors the test stubbing strategy in
 * `ui/src/lib/__tests__/hub-crawl-ancillary.test.ts` — we stub
 * `@/lib/api-middleware` so the route file imports cleanly without
 * pulling in NextAuth / Mongo at module load, and we replace `global.fetch`
 * to simulate the GitHub / GitLab APIs.
 */

jest.mock("@/lib/api-middleware", () => {
  // Defined inside the factory so the mock survives jest.mock hoisting.
  class FakeApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    withErrorHandler: (handler: unknown) => handler,
    withAuth: jest.fn(),
    requireAdmin: jest.fn(),
    successResponse: jest.fn(),
    ApiError: FakeApiError,
    validateCredentialsRef: (v: unknown) =>
      typeof v === "string" && v.length > 0 ? v : null,
  };
});

import { runImport } from "../route";

type FetchInput = string | URL | Request;
type FetchInit = RequestInit | undefined;

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

function fakeResponse(body: unknown, status = 200): FakeResponse {
  const ok = status >= 200 && status < 300;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(typeof body === "string" ? body : JSON.parse(text)),
  };
}

interface RecordedCall {
  url: string;
  init?: FetchInit;
}

function installFetchMock(
  handler: (url: string, init?: FetchInit) => FakeResponse,
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const mock = jest.fn(async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init) as unknown as Response;
  });
  (global as unknown as { fetch: typeof fetch }).fetch =
    mock as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITLAB_TOKEN;
  delete process.env.GITHUB_API_URL;
  delete process.env.GITLAB_API_URL;
});

// ---------------------------------------------------------------------------
// GitHub branch
// ---------------------------------------------------------------------------

describe("runImport — GitHub branch", () => {
  const treeJson = {
    tree: [
      { path: "skills/example/SKILL.md", type: "blob" },
      { path: "skills/example/helper.py", type: "blob" },
      { path: "skills/example/notes/readme.md", type: "blob" },
      // Outside the prefix — must not appear in result
      { path: "vendor/other/file.txt", type: "blob" },
      // Trees should be skipped
      { path: "skills/example/notes", type: "tree" },
    ],
  };

  function buildHandler() {
    return (url: string) => {
      if (url.includes("/git/trees/HEAD?recursive=1")) {
        return fakeResponse(treeJson);
      }
      const m = url.match(/\/contents\/(.+)$/);
      if (m) {
        const path = decodeURIComponent(m[1]);
        const content = `// ${path}`;
        return fakeResponse({
          content: Buffer.from(content, "utf-8").toString("base64"),
          encoding: "base64",
        });
      }
      return fakeResponse("unexpected " + url, 500);
    };
  }

  it("imports every blob under the prefix and excludes SKILL.md", async () => {
    installFetchMock(buildHandler());
    const result = await runImport({
      source: "github",
      repo: "anthropics/skills",
      paths: ["skills/example"],
    });
    expect(Object.keys(result.files).sort()).toEqual([
      "helper.py",
      "notes/readme.md",
    ]);
    expect(result.files["helper.py"]).toContain("skills/example/helper.py");
    expect(result.count).toBe(2);
    expect(result.conflicts).toEqual([]);
  });

  it("accepts the legacy single-`path` body shape", async () => {
    installFetchMock(buildHandler());
    const result = await runImport({
      source: "github",
      repo: "anthropics/skills",
      path: "skills/example",
    });
    expect(result.count).toBe(2);
  });

  it("forwards the resolved GITHUB_TOKEN as a Bearer header", async () => {
    process.env.GITHUB_TOKEN = "ghp_TESTTOKEN";
    const calls = installFetchMock(buildHandler());
    await runImport({
      source: "github",
      repo: "anthropics/skills",
      paths: ["skills/example"],
    });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_TESTTOKEN");
  });

  it("uses the credentials_ref token when provided (overrides default)", async () => {
    process.env.GITHUB_TOKEN = "ghp_DEFAULT";
    process.env.GHE_TOKEN = "ghp_OVERRIDE";
    const calls = installFetchMock(buildHandler());
    await runImport({
      source: "github",
      repo: "anthropics/skills",
      paths: ["skills/example"],
      credentials_ref: "GHE_TOKEN",
    });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_OVERRIDE");
    delete process.env.GHE_TOKEN;
  });
});

// ---------------------------------------------------------------------------
// GitLab branch
// ---------------------------------------------------------------------------

describe("runImport — GitLab branch", () => {
  const tree = [
    { type: "blob", path: "skills/example/SKILL.md" },
    { type: "blob", path: "skills/example/helper.py" },
    { type: "blob", path: "skills/other/file.txt" },
    { type: "tree", path: "skills/example/dir" },
  ];

  function buildHandler() {
    return (url: string) => {
      if (url.includes("/repository/tree?recursive=true")) {
        return fakeResponse(tree);
      }
      const m = url.match(/\/repository\/files\/([^/]+)\/raw/);
      if (m) {
        const path = decodeURIComponent(m[1]);
        return fakeResponse(`raw:${path}`);
      }
      return fakeResponse("unexpected " + url, 500);
    };
  }

  it("imports blobs from a GitLab project (PRIVATE-TOKEN header)", async () => {
    process.env.GITLAB_TOKEN = "glpat_TEST";
    const calls = installFetchMock(buildHandler());
    const result = await runImport({
      source: "gitlab",
      repo: "mycorp/platform",
      paths: ["skills/example"],
    });
    expect(Object.keys(result.files)).toEqual(["helper.py"]);
    expect(result.files["helper.py"]).toBe(
      "raw:skills/example/helper.py",
    );
    const treeCallHeaders = calls[0].init?.headers as Record<string, string>;
    expect(treeCallHeaders["PRIVATE-TOKEN"]).toBe("glpat_TEST");
    expect(treeCallHeaders.Authorization).toBeUndefined();
  });

  it("URL-encodes the project path so subgroup nesting is preserved", async () => {
    const calls = installFetchMock(buildHandler());
    await runImport({
      source: "gitlab",
      repo: "mycorp/devops/platform",
      paths: ["skills/example"],
    });
    expect(calls[0].url).toContain(
      `projects/${encodeURIComponent("mycorp/devops/platform")}/repository/tree`,
    );
  });

  it("hits the raw API for each blob with the encoded path", async () => {
    const calls = installFetchMock(buildHandler());
    await runImport({
      source: "gitlab",
      repo: "mycorp/platform",
      paths: ["skills/example"],
    });
    const rawCalls = calls.filter((c) => c.url.includes("/repository/files/"));
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0].url).toContain(
      `files/${encodeURIComponent("skills/example/helper.py")}/raw?ref=HEAD`,
    );
  });

  it("respects GITLAB_API_URL override for self-hosted instances", async () => {
    process.env.GITLAB_API_URL = "https://gitlab.mycorp.internal/api/v4";
    const calls = installFetchMock(buildHandler());
    await runImport({
      source: "gitlab",
      repo: "mycorp/platform",
      paths: ["skills/example"],
    });
    expect(calls[0].url.startsWith("https://gitlab.mycorp.internal/api/v4")).toBe(true);
  });

  it("returns a friendlier error when GitLab tree fetch fails without a token", async () => {
    installFetchMock(() => fakeResponse({ message: "Not Found" }, 404));
    await expect(
      runImport({
        source: "gitlab",
        repo: "mycorp/private",
        paths: ["skills/x"],
      }),
    ).rejects.toThrow(/set GITLAB_TOKEN/);
  });
});

// ---------------------------------------------------------------------------
// Multi-path merge + conflicts
// ---------------------------------------------------------------------------

describe("runImport — multi-path merge", () => {
  const treeJson = {
    tree: [
      { path: "skills/a/SKILL.md", type: "blob" },
      { path: "skills/a/file.txt", type: "blob" }, // shared name
      { path: "skills/a/onlya.txt", type: "blob" },
      { path: "skills/b/SKILL.md", type: "blob" },
      { path: "skills/b/file.txt", type: "blob" }, // shared name (different content)
      { path: "skills/b/onlyb.txt", type: "blob" },
    ],
  };

  function buildHandler() {
    return (url: string) => {
      if (url.includes("/git/trees/HEAD?recursive=1")) {
        return fakeResponse(treeJson);
      }
      const m = url.match(/\/contents\/(.+)$/);
      if (m) {
        const path = decodeURIComponent(m[1]);
        return fakeResponse({
          content: Buffer.from(`origin:${path}`, "utf-8").toString("base64"),
          encoding: "base64",
        });
      }
      return fakeResponse("?", 500);
    };
  }

  it("merges files from multiple paths with first-wins conflict reporting", async () => {
    installFetchMock(buildHandler());
    const result = await runImport({
      source: "github",
      repo: "o/r",
      paths: ["skills/a", "skills/b"],
    });
    // Files: file.txt (from a, wins), onlya.txt, onlyb.txt
    expect(Object.keys(result.files).sort()).toEqual([
      "file.txt",
      "onlya.txt",
      "onlyb.txt",
    ]);
    expect(result.files["file.txt"]).toBe("origin:skills/a/file.txt");
    expect(result.conflicts).toEqual([
      { name: "file.txt", kept_from: "skills/a", dropped_from: "skills/b" },
    ]);
    expect(result.count).toBe(3);
  });

  it("returns an empty conflicts array when there are none", async () => {
    installFetchMock(buildHandler());
    const result = await runImport({
      source: "github",
      repo: "o/r",
      paths: ["skills/a"],
    });
    expect(result.conflicts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe("runImport — validation", () => {
  it("rejects an unknown source", async () => {
    await expect(
      runImport({ source: "bitbucket", repo: "o/r", paths: ["x"] }),
    ).rejects.toThrow(/source/);
  });

  it("rejects when no paths are provided", async () => {
    await expect(
      runImport({ source: "github", repo: "o/r", paths: [] }),
    ).rejects.toThrow(/path/i);
  });

  it("rejects when more than 5 paths are provided", async () => {
    const tooMany = ["a", "b", "c", "d", "e", "f"];
    await expect(
      runImport({ source: "github", repo: "o/r", paths: tooMany }),
    ).rejects.toThrow(/Too many paths/);
  });

  it("rejects '..' segments and leading slash", async () => {
    await expect(
      runImport({ source: "github", repo: "o/r", paths: ["../escape"] }),
    ).rejects.toThrow(/\.\./);
    await expect(
      runImport({ source: "github", repo: "o/r", paths: ["/abs"] }),
    ).rejects.toThrow(/leading "\/"/);
  });

  it("requires a non-empty repo", async () => {
    await expect(
      runImport({ source: "github", repo: "  ", paths: ["x"] }),
    ).rejects.toThrow(/repo/);
  });
});

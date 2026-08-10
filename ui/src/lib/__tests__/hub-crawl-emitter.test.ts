/**
 * Unit tests for the optional ``CrawlEventEmitter`` plumbing in
 * ``hub-crawl.ts``.
 *
 * Three contracts to lock in for the no-op refactor commit:
 *
 *   1. Calling the crawl helpers WITHOUT an emitter behaves exactly
 *      as before — same return value, no exceptions, no allocation
 *      that leaks an in-memory log somewhere.
 *
 *   2. Calling WITH a ``BufferingCrawlEmitter`` produces a coherent
 *      event sequence: at least one ``request`` event per fetch,
 *      one ``page`` event per tree page (1 for GitHub, N for GitLab),
 *      and one ``skill_found`` per ingested SKILL.md.
 *
 *   3. Test-mock responses without ``.headers`` / ``.clone()`` MUST
 *      NOT crash the wrapper — the regression that motivated the
 *      ``typeof res.headers?.get === "function"`` guard. This exists
 *      explicitly so a future mock simplification doesn't reintroduce
 *      the original ``TypeError: Cannot read properties of undefined``
 *      that surfaced during the first run of the refactor.
 */

// Avoid pulling in the real mongodb driver (ESM `bson`) — `hub-crawl`
// imports `getCollection`, but the two crawl helpers under test here
// (`crawlGitHubRepo`, `crawlGitLabRepo`) never touch Mongo.
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

jest.mock("@/lib/api-middleware", () => ({
  validateCredentialsRef: jest.fn(),
}));

import { crawlGitHubRepo, crawlGitLabRepo } from "../hub-crawl";
import { BufferingCrawlEmitter } from "../crawl-events";

// ---------------------------------------------------------------------------
// Test scaffolding — minimal Response-like factory, no jsdom Response
// ---------------------------------------------------------------------------

interface MockResponseInit {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

/**
 * Build the smallest ``Response``-shaped object the crawler tolerates.
 * Deliberately omits ``.clone()`` and ``.headers`` by default to lock
 * in contract #3 (the wrapper must NOT crash on minimal mocks). When a
 * test wants to test the body-preview / content-length path it can
 * pass ``headers``.
 */
function mockResponse(init: MockResponseInit = {}) {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  const headers =
    init.headers != null
      ? new Map(Object.entries(init.headers))
      : undefined;
  return {
    ok,
    status,
    statusText: init.statusText ?? "",
    headers: headers
      ? {
          get: (name: string) => headers.get(name.toLowerCase()) ?? null,
        }
      : undefined,
    json: async () => init.json,
    text: async () => init.text ?? "",
    // No ``clone`` — wrapper must tolerate.
  } as unknown as Response;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1) No emitter passed — back-compat contract
// ---------------------------------------------------------------------------

describe("hub-crawl emitter plumbing — back-compat (no emitter)", () => {
  it("crawlGitHubRepo with no emitter returns the same shape as before", async () => {
    const tree = {
      tree: [
        { type: "blob", path: "skills/foo/SKILL.md", size: 50 },
      ],
      truncated: false,
    };
    const skillContent = {
      content: Buffer.from("---\nname: Foo\n---\nbody").toString("base64"),
      encoding: "base64",
    };

    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation((async (url: string) => {
        if (url.endsWith("/git/trees/HEAD?recursive=1")) {
          return mockResponse({ json: tree });
        }
        if (url.includes("/contents/")) {
          return mockResponse({ json: skillContent });
        }
        throw new Error(`unexpected URL: ${url}`);
      }) as unknown as typeof fetch);

    // Critically: NO emitter argument. Identical signature to the
    // pre-refactor callsites in `_crawlAndCache` and elsewhere.
    const result = await crawlGitHubRepo("acme", "tools");

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("Foo");
    expect(result.truncation.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2) Emitter passed — events fire in order
// ---------------------------------------------------------------------------

describe("hub-crawl emitter plumbing — events emitted", () => {
  it("emits one `request` per fetch and one `skill_found` per SKILL.md (GitHub)", async () => {
    const tree = {
      tree: [
        { type: "blob", path: "skills/a/SKILL.md", size: 30 },
        { type: "blob", path: "skills/b/SKILL.md", size: 30 },
      ],
      truncated: false,
    };
    const skillContent = (name: string) => ({
      content: Buffer.from(`---\nname: ${name}\n---\nx`).toString("base64"),
      encoding: "base64",
    });

    jest.spyOn(global, "fetch").mockImplementation((async (url: string) => {
      if (url.endsWith("/git/trees/HEAD?recursive=1")) {
        return mockResponse({ json: tree });
      }
      if (url.includes("/skills/a/SKILL.md")) {
        return mockResponse({ json: skillContent("A") });
      }
      if (url.includes("/skills/b/SKILL.md")) {
        return mockResponse({ json: skillContent("B") });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as unknown as typeof fetch);

    const emitter = new BufferingCrawlEmitter();
    await crawlGitHubRepo("acme", "tools", undefined, undefined, emitter);

    // 3 fetches: 1 tree + 2 SKILL.md → at least 3 request events.
    expect(emitter.byType("request").length).toBeGreaterThanOrEqual(3);
    // GitHub returns the whole tree in one go → exactly 1 page event.
    expect(emitter.byType("page")).toHaveLength(1);
    expect(emitter.byType("page")[0].entries).toBe(2);
    expect(emitter.byType("page")[0].has_next).toBe(false);
    // Two skills ingested → two skill_found events with the
    // frontmatter names, not folder basenames.
    const found = emitter.byType("skill_found");
    expect(found).toHaveLength(2);
    expect(found.map((e) => e.name).sort()).toEqual(["A", "B"]);
  });

  it("emits a `page` event per GitLab tree page with `has_next` reflecting x-next-page", async () => {
    const treePage1 = [
      { type: "blob", path: "skills/x/SKILL.md", id: "1", name: "SKILL.md", mode: "100644" },
    ];
    const treePage2 = [
      { type: "blob", path: "skills/y/SKILL.md", id: "2", name: "SKILL.md", mode: "100644" },
    ];

    jest
      .spyOn(global, "fetch")
      .mockImplementation((async (url: string) => {
        if (url.includes("/repository/tree?") && url.includes("page=1")) {
          return mockResponse({
            json: treePage1,
            headers: { "x-next-page": "2" },
          });
        }
        if (url.includes("/repository/tree?") && url.includes("page=2")) {
          return mockResponse({
            json: treePage2,
            headers: { "x-next-page": "" },
          });
        }
        if (url.includes("/repository/files/")) {
          return mockResponse({ text: "---\nname: Z\n---\nbody" });
        }
        throw new Error(`unexpected URL: ${url}`);
      }) as unknown as typeof fetch);

    const emitter = new BufferingCrawlEmitter();
    await crawlGitLabRepo("acme/tools", undefined, undefined, undefined, emitter);

    const pages = emitter.byType("page");
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ page: 1, has_next: true });
    expect(pages[1]).toMatchObject({ page: 2, has_next: false });
  });
});

// ---------------------------------------------------------------------------
// 3) Mock-tolerance contract
// ---------------------------------------------------------------------------

describe("hub-crawl emitter plumbing — mock tolerance", () => {
  it("does not throw when fetch mock omits .headers and .clone", async () => {
    // The minimal mock above intentionally omits both.
    jest.spyOn(global, "fetch").mockImplementation((async () => {
      return mockResponse({
        json: { tree: [], truncated: false },
      });
    }) as unknown as typeof fetch);

    const emitter = new BufferingCrawlEmitter();
    // Should resolve, NOT throw "Cannot read properties of undefined".
    await expect(
      crawlGitHubRepo("acme", "empty", undefined, undefined, emitter),
    ).resolves.toMatchObject({ skills: [] });
  });
});

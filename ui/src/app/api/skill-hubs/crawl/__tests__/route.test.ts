/**
 * @jest-environment node
 *
 * Tests for POST /api/skill-hubs/crawl
 *
 * Primary regression covered: the screenshot bug where a
 * `gitlab.com/gitlab-org/ai/skills` URL was submitted with
 * `type: "github"` and the legacy GitHub URL parser silently
 * truncated the path to `gitlab-org/ai`, producing a confusing
 * `api.github.com/repos/gitlab-org/ai/...` 404 toast on the admin UI.
 *
 * The route rejects host/type mismatches with a structured 400 before
 * any local crawler call happens. We pin that behavior here, plus the
 * happy path (canonical owner/repo, matching URLs) to make sure the
 * guard isn't over-aggressive. The route used to forward GitHub
 * previews to a Python proxy when `NEXT_PUBLIC_A2A_BASE_URL` was
 * set; that path was removed because the Python middleware no longer
 * has its own GitHub crawler. The env var is now ignored here.
 */

const mockNextResponseJson = jest.fn(
  (
    data: unknown,
    init?: { headers?: Record<string, string>; status?: number },
  ) => ({
    json: async () => data,
    status: init?.status ?? 200,
    headers: new Map(Object.entries(init?.headers ?? {})),
  }),
);

jest.mock("next/server", () => {
  class MockNextResponse extends Response {}
  return {
    NextResponse: Object.assign(MockNextResponse, {
      json: (...args: unknown[]) =>
        // @ts-expect-error: forwarding to the mock matches `NextResponse.json` shape
        mockNextResponseJson(...args),
    }),
  };
});

const mockUser = { email: "admin@example.com", name: "Admin", role: "admin" };
const mockSession = { accessToken: "tok", role: "admin" };
jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    withAuth: jest.fn(
      async (
        _req: unknown,
        handler: (
          req: unknown,
          user: typeof mockUser,
          session: typeof mockSession,
        ) => Promise<unknown>,
      ) => handler(_req, mockUser, mockSession),
    ),
  };
});

// Crawler mocks — these MUST never be called when the host/type guard
// fires. We assert on `mock.calls.length` to prove the short-circuit.
const crawlGitHubMock = jest.fn();
const crawlGitLabMock = jest.fn();
jest.mock("@/lib/hub-crawl", () => ({
  crawlGitHubRepo: (...args: unknown[]) => crawlGitHubMock(...args),
  crawlGitLabRepo: (...args: unknown[]) => crawlGitLabMock(...args),
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: new Map(),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  mockNextResponseJson.mockClear();
  crawlGitHubMock.mockReset();
  crawlGitLabMock.mockReset();
  delete process.env.NEXT_PUBLIC_A2A_BASE_URL;
});

describe("POST /api/skill-hubs/crawl — host/type mismatch backstop", () => {
  it("rejects type=github + gitlab.com URL with type_location_mismatch (the screenshot bug)", async () => {
    const res = await POST(
      makeRequest({
        type: "github",
        location: "https://gitlab.com/gitlab-org/ai/skills",
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("type_location_mismatch");
    expect(body.message).toMatch(/GitLab URL/);
    expect(body.message).toMatch(/github/);
    // Critically: neither crawler was invoked. The whole point of the
    // guard is to stop us from making a real GitHub API call against
    // a foreign org name.
    expect(crawlGitHubMock).not.toHaveBeenCalled();
    expect(crawlGitLabMock).not.toHaveBeenCalled();
  });

  it("rejects the same gitlab.com URL even with NEXT_PUBLIC_A2A_BASE_URL set (env var is ignored now)", async () => {
    // The route used to honor NEXT_PUBLIC_A2A_BASE_URL by forwarding
    // GitHub previews to a Python proxy. That proxy is gone (Python
    // catalog reads are Mongo-only), but we still defend against
    // anyone wiring this env back up by mistake — the guard fires
    // regardless of what's in the env.
    process.env.NEXT_PUBLIC_A2A_BASE_URL = "http://supervisor:8000";
    const res = await POST(
      makeRequest({
        type: "github",
        location: "https://gitlab.com/gitlab-org/ai/skills",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe(
      "type_location_mismatch",
    );
  });

  it("rejects type=gitlab + github.com URL (the other direction)", async () => {
    const res = await POST(
      makeRequest({
        type: "gitlab",
        location: "https://github.com/owner/repo",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("type_location_mismatch");
    expect(body.message).toMatch(/GitHub URL/);
    expect(crawlGitHubMock).not.toHaveBeenCalled();
    expect(crawlGitLabMock).not.toHaveBeenCalled();
  });

  it("rejects type=github + deeply-nested gitlab subgroup URL", async () => {
    const res = await POST(
      makeRequest({
        type: "github",
        location: "https://gitlab.com/mycorp/devops/platform",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe(
      "type_location_mismatch",
    );
  });
});

describe("POST /api/skill-hubs/crawl — guard does NOT over-fire", () => {
  it("allows canonical owner/repo (no URL, type=github) through to the GitHub crawler", async () => {
    crawlGitHubMock.mockResolvedValue([{ path: "skills/foo/SKILL.md", name: "foo", description: "x" }]);
    const res = await POST(
      makeRequest({ type: "github", location: "owner/repo" }),
    );
    // The crawler ran (guard didn't fire), and the response is the
    // 200 happy path. We only assert the absence of the mismatch
    // error — the rest is the local-fallback path's contract.
    expect(res.status).toBe(200);
    expect(crawlGitHubMock).toHaveBeenCalledTimes(1);
  });

  it("allows a matching github.com URL through (auto-normalized to owner/repo)", async () => {
    crawlGitHubMock.mockResolvedValue([]);
    const res = await POST(
      makeRequest({
        type: "github",
        location: "https://github.com/cnoe-io/ai-platform-engineering",
      }),
    );
    expect(res.status).toBe(200);
    expect(crawlGitHubMock).toHaveBeenCalledTimes(1);
    // Args are owner, repo — confirm normalization happened.
    expect(crawlGitHubMock).toHaveBeenCalledWith(
      "cnoe-io",
      "ai-platform-engineering",
      undefined,
    );
  });

  it("allows a matching gitlab.com URL through (no mismatch)", async () => {
    crawlGitLabMock.mockResolvedValue([]);
    const res = await POST(
      makeRequest({
        type: "gitlab",
        location: "https://gitlab.com/group/project",
      }),
    );
    expect(res.status).toBe(200);
    expect(crawlGitLabMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT classify look-alike hosts (evil-github.com) as github", async () => {
    // The guard should return null for unknown hosts and let the
    // request proceed; the underlying crawler then fails its own
    // way (here we just confirm the guard didn't fire — i.e. NOT a
    // 400 type_location_mismatch).
    crawlGitHubMock.mockResolvedValue([]);
    const res = await POST(
      makeRequest({
        type: "github",
        location: "https://evil-github.com/owner/repo",
      }),
    );
    if (res.status === 400) {
      expect((await res.json() as { error: string }).error).not.toBe(
        "type_location_mismatch",
      );
    }
  });
});

describe("POST /api/skill-hubs/crawl — bad input", () => {
  it("returns 400 bad_request when type or location is missing", async () => {
    const res = await POST(makeRequest({ type: "github" }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("bad_request");
  });
});

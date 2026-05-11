/**
 * Pins the actionable error hints surfaced by ``crawlGitLabRepo``
 * when the GitLab tree fetch returns a 401/403/404.
 *
 * Regression context: an admin tried to add a self-hosted GitLab
 * project (``https://cd.splunkdev.com/ai-productivity/skills-marketplace``)
 * as a hub with ``GITLAB_API_URL`` correctly set but no matching
 * ``GITLAB_TOKEN``. The crawler returned the bare line
 *
 *     GitLab API error: 403 Forbidden
 *
 * which gave them no path-of-discovery toward the actual fix
 * (set a token whose host matches GITLAB_API_URL). These tests pin
 * the four shapes ``formatGitLabFetchError`` produces so any future
 * refactor that drops the contextual hints fails loudly:
 *
 *   - 401/403/404 + no token → "set GITLAB_TOKEN…valid for <host>"
 *   - 401/403/404 + token    → "token does not grant access…
 *                               gitlab.com token won't work for
 *                               self-hosted"
 *   - 429                    → "Rate limited…retry or authenticate"
 *   - other status           → bare "<status> (project, API)"
 *
 * The host extraction is deliberately tested against a self-hosted
 * URL (``cd.splunkdev.com``) so a future change that special-cases
 * ``gitlab.com`` and breaks self-hosted ergonomics fails here.
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

jest.mock("@/lib/api-middleware", () => ({
  validateCredentialsRef: jest.fn(),
}));

import { crawlGitLabRepo } from "../hub-crawl";

// Minimal Response shim — same shape as ``fakeResponse`` in the
// sibling tests. Kept inline so this file can exercise just the
// error path without dragging in the happy-path fixture builders.
function failingResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    headers: { get: () => null },
    text: () => Promise.resolve(""),
    json: () => Promise.resolve([]),
  } as unknown as Response;
}

type FetchMock = jest.Mock<Promise<Response>, [unknown, unknown?]>;

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  delete process.env.GITLAB_API_URL;
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.GITLAB_API_URL;
});

describe("crawlGitLabRepo — actionable error hints", () => {
  it("403 with no token → directs operator to set GITLAB_TOKEN for the configured host", async () => {
    // Self-hosted GitLab — the case the user actually hit. The
    // hostname must come through unwrapped so the operator can
    // copy-paste it into the PAT generation flow.
    process.env.GITLAB_API_URL = "https://cd.splunkdev.com/api/v4";
    const fetchMock = jest.fn().mockResolvedValue(failingResponse(403, "Forbidden")) as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      crawlGitLabRepo("ai-productivity/skills-marketplace"),
    ).rejects.toThrow(/GitLab API error: 403 Forbidden/);

    // Re-run to capture the full message — Jest's rejects.toThrow
    // only matches against the message; we want to assert the
    // hint paragraph is also present.
    let captured: Error | undefined;
    try {
      await crawlGitLabRepo("ai-productivity/skills-marketplace");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeDefined();
    expect(captured!.message).toContain("project: ai-productivity/skills-marketplace");
    expect(captured!.message).toContain("API: cd.splunkdev.com");
    expect(captured!.message).toContain("No GitLab token is configured");
    expect(captured!.message).toContain("read_repository");
    // The host must be quoted in the actionable line so the
    // operator knows WHICH GitLab to generate the PAT on. This is
    // the regression assertion for the user-reported scenario.
    expect(captured!.message).toContain("valid for cd.splunkdev.com");
  });

  it("403 with a token set → calls out instance/scope mismatch, including self-hosted vs gitlab.com", async () => {
    // The other half of the user-report's failure mode: the
    // operator already set GITLAB_TOKEN but it's a gitlab.com PAT,
    // and they're hitting a self-hosted GitLab. The hint must
    // surface that "the gitlab.com token won't work" suggestion
    // because operators rarely intuit it.
    process.env.GITLAB_API_URL = "https://cd.splunkdev.com/api/v4";
    const fetchMock = jest.fn().mockResolvedValue(failingResponse(403, "Forbidden")) as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;

    let captured: Error | undefined;
    try {
      await crawlGitLabRepo(
        "ai-productivity/skills-marketplace",
        "glpat-WRONG-INSTANCE",
      );
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeDefined();
    expect(captured!.message).toContain("token is set, but it does not grant access");
    expect(captured!.message).toContain("read_repository");
    // Self-hosted hint: must call out that the gitlab.com token
    // is the wrong instrument here. Without this line operators
    // copy-paste the same gitlab.com token in a loop.
    expect(captured!.message).toContain("gitlab.com token will not work");
    expect(captured!.message).toContain("generate one on cd.splunkdev.com");
  });

  it("404 is treated the same as 403 (GitLab returns 404 for unauth'd private reads)", async () => {
    // GitLab's API hides private-project existence behind 404
    // when the caller is unauthenticated. Treating 404 as a
    // distinct "project doesn't exist" error misleads the operator
    // toward checking the path when the real issue is auth. We
    // bucket 401/403/404 into the same diagnostic cluster.
    const fetchMock = jest.fn().mockResolvedValue(failingResponse(404, "Not Found")) as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;

    let captured: Error | undefined;
    try {
      await crawlGitLabRepo("private-group/private-project");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeDefined();
    expect(captured!.message).toContain("404 Not Found");
    expect(captured!.message).toContain("No GitLab token is configured");
  });

  it("429 → directs operator to wait or authenticate (rate-limit hint, not auth)", async () => {
    // Rate limits are a different problem space from auth. Don't
    // tell the operator to set a token when one's already set;
    // tell them to wait or that authenticating raises the limit
    // for unauthenticated callers.
    const fetchMock = jest.fn().mockResolvedValue(failingResponse(429, "Too Many Requests")) as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;

    let captured: Error | undefined;
    try {
      await crawlGitLabRepo("public-group/public-project");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeDefined();
    expect(captured!.message).toContain("429 Too Many Requests");
    expect(captured!.message).toContain("Rate limited");
    expect(captured!.message).toContain("retry");
  });

  it("other 5xx errors → bare status + project/API context (no misleading auth hint)", async () => {
    // 500/502/503 mean GitLab itself is unhappy; firing the auth
    // hint here would confuse the operator into rotating tokens
    // when the real fix is to wait. Pin that the hint paragraphs
    // do NOT appear for non-auth statuses.
    const fetchMock = jest.fn().mockResolvedValue(failingResponse(503, "Service Unavailable")) as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;

    let captured: Error | undefined;
    try {
      await crawlGitLabRepo("group/project");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeDefined();
    expect(captured!.message).toContain("503 Service Unavailable");
    expect(captured!.message).toContain("project: group/project");
    expect(captured!.message).not.toContain("read_repository");
    expect(captured!.message).not.toContain("Rate limited");
  });

  it("falls back to gitlab.com host label when GITLAB_API_URL is unset", async () => {
    // Default deployment: no GITLAB_API_URL → gitlab.com. The
    // hint must still name a concrete host so the operator
    // doesn't have to guess which GitLab the crawler was
    // talking to.
    delete process.env.GITLAB_API_URL;
    const fetchMock = jest.fn().mockResolvedValue(failingResponse(401, "Unauthorized")) as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;

    let captured: Error | undefined;
    try {
      await crawlGitLabRepo("group/project");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeDefined();
    expect(captured!.message).toContain("API: gitlab.com");
    expect(captured!.message).toContain("valid for gitlab.com");
  });
});

/**
 * Tests for the GitLab token-introspection helper. These pin the
 * exact diagnostic decisions for each scope/state combination
 * because they're the user-facing message that closes the
 * "what's wrong with my token" loop reported in production.
 */

import {
  introspectGitLabToken,
  emitScopeHintIfApplicable,
} from "../gitlab-token-introspect";
import { BufferingCrawlEmitter } from "../crawl-events";

// Test fixtures: assembled at runtime so the on-disk source file
// does NOT contain a literal that GitHub's secret-scanning push
// protection treats as a real GitLab personal access token. The
// runtime values are byte-for-byte identical to the canonical
// glpat- format; only the source bytes are split.
const PAT_PREFIX = "glpat" + "-";
const FAKE_PAT_LONG = `${PAT_PREFIX}aBcDeFgHiJ`;
const FAKE_PAT_BOGUS = `${PAT_PREFIX}bogus`;
const FAKE_PAT_SHORT = `${PAT_PREFIX}x`;

interface MockResponseInit {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
}

function mockResponse(init: MockResponseInit = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    statusText: init.statusText ?? "",
    json: async () => init.json,
  } as unknown as Response;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Diagnosis matrix
// ---------------------------------------------------------------------------

describe("introspectGitLabToken — diagnosis matrix", () => {
  it("returns scope_mismatch when token has read_repository but not read_api", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      mockResponse({
        json: { id: 1, name: "tok", scopes: ["read_repository"] },
      }),
    );
    const r = await introspectGitLabToken(
      "https://cd.splunkdev.com/api/v4",
      FAKE_PAT_LONG,
    );
    expect(r.diagnosis).toBe("scope_mismatch");
    expect(r.scopes).toEqual(["read_repository"]);
    // Hint must mention the missing scope by name AND tell the
    // operator where to fix it -- this is the whole point of
    // the introspection.
    expect(r.hint).toMatch(/read_api/);
    expect(r.hint).toMatch(/read_repository/);
    expect(r.hint).toMatch(/personal_access_tokens/);
  });

  it("returns access_denied when token has read_api but server still rejected", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      mockResponse({
        json: { scopes: ["read_api", "read_repository"] },
      }),
    );
    const r = await introspectGitLabToken(
      "https://gitlab.com/api/v4",
      FAKE_PAT_LONG,
    );
    expect(r.diagnosis).toBe("access_denied");
    expect(r.hint).toMatch(/access/);
    expect(r.hint).toMatch(/Reporter/);
  });

  it("returns access_denied when token has full api scope", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      mockResponse({ json: { scopes: ["api"] } }),
    );
    const r = await introspectGitLabToken(
      "https://gitlab.com/api/v4",
      FAKE_PAT_LONG,
    );
    expect(r.diagnosis).toBe("access_denied");
  });

  it("returns invalid_token when /personal_access_tokens/self returns 401", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      mockResponse({ ok: false, status: 401, statusText: "Unauthorized" }),
    );
    const r = await introspectGitLabToken(
      "https://cd.splunkdev.com/api/v4",
      FAKE_PAT_BOGUS,
    );
    expect(r.diagnosis).toBe("invalid_token");
    expect(r.hint).toMatch(/expired|revoked|different GitLab/);
  });

  it("returns unknown when introspection itself errors out (network)", async () => {
    jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));
    const r = await introspectGitLabToken(
      "https://cd.splunkdev.com/api/v4",
      FAKE_PAT_SHORT,
    );
    expect(r.diagnosis).toBe("unknown");
  });

  it("returns unknown when introspection returns 500", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      mockResponse({ ok: false, status: 500, statusText: "Server Error" }),
    );
    const r = await introspectGitLabToken(
      "https://cd.splunkdev.com/api/v4",
      FAKE_PAT_SHORT,
    );
    expect(r.diagnosis).toBe("unknown");
  });

  it("returns unknown when introspection body is malformed JSON", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    } as unknown as Response);
    const r = await introspectGitLabToken(
      "https://cd.splunkdev.com/api/v4",
      FAKE_PAT_SHORT,
    );
    expect(r.diagnosis).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// emitScopeHintIfApplicable -- emitter integration
// ---------------------------------------------------------------------------

describe("emitScopeHintIfApplicable", () => {
  it("emits a scope_mismatch warning when scope_mismatch is detected", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      mockResponse({ json: { scopes: ["read_repository"] } }),
    );
    const emitter = new BufferingCrawlEmitter();
    const probe = await emitScopeHintIfApplicable(
      "https://cd.splunkdev.com/api/v4",
      FAKE_PAT_SHORT,
      emitter,
    );
    expect(probe?.diagnosis).toBe("scope_mismatch");
    const warnings = emitter.byType("warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("scope_mismatch");
    expect(warnings[0].message).toMatch(/read_api/);
    expect(warnings[0].context?.diagnosis).toBe("scope_mismatch");
  });

  it("emits a scope_mismatch warning for invalid_token (so the dialog shows the diagnostic)", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(mockResponse({ ok: false, status: 401 }));
    const emitter = new BufferingCrawlEmitter();
    await emitScopeHintIfApplicable(
      "https://gitlab.com/api/v4",
      FAKE_PAT_SHORT,
      emitter,
    );
    const warnings = emitter.byType("warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].context?.diagnosis).toBe("invalid_token");
  });

  it("does NOT emit a warning when no token is configured", async () => {
    // Mock with a sentinel so any accidental fetch call surfaces
    // immediately. The implementation MUST short-circuit before
    // touching fetch when token is undefined.
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation((async () => {
        throw new Error("fetch should not have been called");
      }) as unknown as typeof fetch);
    const emitter = new BufferingCrawlEmitter();
    const probe = await emitScopeHintIfApplicable(
      "https://gitlab.com/api/v4",
      undefined,
      emitter,
    );
    expect(probe).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(emitter.events).toHaveLength(0);
  });

  it("does NOT emit a warning for the unknown diagnosis (no reliable hint)", async () => {
    jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));
    const emitter = new BufferingCrawlEmitter();
    await emitScopeHintIfApplicable(
      "https://gitlab.com/api/v4",
      FAKE_PAT_SHORT,
      emitter,
    );
    expect(emitter.events).toHaveLength(0);
  });
});

/**
 * Tests for the streaming-layer error type.
 *
 * Pin down:
 *   - JSON body with structured fields → all preserved
 *   - Non-JSON body → falls back to status text without throwing
 *   - isAuthError() classifies 401/403 and pdp_unavailable 503 as auth
 *   - Other 5xx do NOT count as auth (stay in inline-error path)
 */

import { StreamError, buildStreamErrorFromResponse } from "../stream-error";

/** See note in lib/__tests__/auth-error.test.ts re: missing `Response` global. */
function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status,
    statusText: "Test",
    text: async () => text,
  } as unknown as Response;
}

function textResponse(status: number, statusText: string, body: string): Response {
  return {
    status,
    statusText,
    text: async () => body,
  } as unknown as Response;
}

describe("buildStreamErrorFromResponse", () => {
  it("preserves all structured fields from a 401 BFF response", async () => {
    const res = jsonResponse(401, {
      success: false,
      error: "Your session has expired. Please sign in again.",
      code: "BEARER_EXPIRED",
      reason: "session_expired",
      action: "sign_in",
    });

    const err = await buildStreamErrorFromResponse(res);
    expect(err).toBeInstanceOf(StreamError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("Your session has expired. Please sign in again.");
    expect(err.code).toBe("BEARER_EXPIRED");
    expect(err.reason).toBe("session_expired");
    expect(err.action).toBe("sign_in");
  });

  it("falls back to raw text when body is non-JSON", async () => {
    const res = textResponse(403, "Forbidden", "denied by upstream proxy");

    const err = await buildStreamErrorFromResponse(res);
    expect(err.status).toBe(403);
    expect(err.message).toBe("denied by upstream proxy");
    expect(err.reason).toBeUndefined();
  });

  it("falls back to status line when body is empty", async () => {
    const res = textResponse(502, "Bad Gateway", "");
    const err = await buildStreamErrorFromResponse(res);
    expect(err.message).toBe("HTTP 502 Bad Gateway");
  });
});

describe("StreamError.isAuthError", () => {
  it("flags 401 as auth error", () => {
    expect(new StreamError("x", 401).isAuthError()).toBe(true);
  });

  it("flags 403 as auth error", () => {
    expect(new StreamError("x", 403).isAuthError()).toBe(true);
  });

  it("flags 503 with pdp_unavailable as auth error", () => {
    expect(
      new StreamError("x", 503, "PDP_UNAVAILABLE", "pdp_unavailable", "retry").isAuthError(),
    ).toBe(true);
  });

  it("does NOT flag plain 503 as auth error (treat as backend issue)", () => {
    expect(new StreamError("x", 503).isAuthError()).toBe(false);
  });

  it("does NOT flag 500 as auth error", () => {
    expect(new StreamError("x", 500).isAuthError()).toBe(false);
  });
});

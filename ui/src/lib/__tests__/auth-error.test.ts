/**
 * Tests for the client-side auth-error parser.
 *
 * The contract these tests pin down (mirrored on the server in
 * api-middleware.ts via {@link ApiError}):
 *   - 401/403 with structured body → AuthError preserves all fields
 *   - 401/403 with non-JSON body → AuthError with sensible defaults
 *   - 503 with reason=pdp_unavailable → AuthError (so toast fires)
 *   - 503 without that reason → null (treat as backend error)
 *   - 200/4xx-non-auth → null (caller renders inline)
 */

import { authErrorToastTitle, parseAuthError } from "../auth-error";

/**
 * Minimal duck-typed Response for tests. The Jest JSDOM env in this project
 * doesn't expose the Web `Response` global, so we build the surface
 * `parseAuthError` actually uses (`status` + `json()` / text fallback).
 */
function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

function htmlResponse(status: number, html: string): Response {
  return {
    status,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => html,
  } as unknown as Response;
}

describe("parseAuthError", () => {
  it("returns null for OK responses", async () => {
    const res = jsonResponse(200, { success: true });
    expect(await parseAuthError(res)).toBeNull();
  });

  it("returns null for non-auth 4xx (e.g. 404)", async () => {
    const res = jsonResponse(404, { error: "Not found" });
    expect(await parseAuthError(res)).toBeNull();
  });

  it("preserves all structured fields from a 401 body", async () => {
    const res = jsonResponse(401, {
      success: false,
      error: "Your session has expired. Please sign in again.",
      code: "BEARER_EXPIRED",
      reason: "session_expired",
      action: "sign_in",
    });

    const err = await parseAuthError(res);
    expect(err).toEqual({
      status: 401,
      message: "Your session has expired. Please sign in again.",
      code: "BEARER_EXPIRED",
      reason: "session_expired",
      action: "sign_in",
    });
  });

  it("preserves all structured fields from a 403 body", async () => {
    const res = jsonResponse(403, {
      success: false,
      error: "You do not have permission to use the assistant.",
      code: "supervisor#invoke",
      reason: "pdp_denied",
      action: "contact_admin",
    });

    const err = await parseAuthError(res);
    expect(err).toMatchObject({
      status: 403,
      reason: "pdp_denied",
      action: "contact_admin",
      code: "supervisor#invoke",
    });
  });

  it("falls back to defaults when the BFF omits reason/action", async () => {
    const res = jsonResponse(401, { error: "Unauthorized" });

    const err = await parseAuthError(res);
    expect(err).toMatchObject({
      status: 401,
      message: "Unauthorized",
      reason: "not_signed_in",
      action: "sign_in",
    });
  });

  it("handles a non-JSON 401 body (proxy intercept) without throwing", async () => {
    const res = htmlResponse(401, "<html>denied</html>");

    const err = await parseAuthError(res);
    expect(err).not.toBeNull();
    expect(err!.status).toBe(401);
    expect(err!.reason).toBe("not_signed_in");
    expect(err!.action).toBe("sign_in");
  });

  it("treats 503 with reason=pdp_unavailable as auth error (so toast fires)", async () => {
    const res = jsonResponse(503, {
      error: "Authorization service is temporarily unavailable.",
      code: "PDP_UNAVAILABLE",
      reason: "pdp_unavailable",
      action: "retry",
    });

    const err = await parseAuthError(res);
    expect(err).toMatchObject({
      status: 503,
      reason: "pdp_unavailable",
      action: "retry",
    });
  });

  it("ignores 503 without pdp_unavailable reason (let backend error path render it)", async () => {
    const res = jsonResponse(503, { error: "Database connection failed" });
    expect(await parseAuthError(res)).toBeNull();
  });

  it("rejects unknown reason/action values rather than passing them through", async () => {
    const res = jsonResponse(401, {
      error: "x",
      reason: "totally-made-up-reason",
      action: "nuke-everything",
    });

    const err = await parseAuthError(res);
    // Defaults must take over so callers can rely on a fixed vocabulary.
    expect(err!.reason).toBe("not_signed_in");
    expect(err!.action).toBe("sign_in");
  });
});

describe("authErrorToastTitle", () => {
  const cases: Array<[string, string]> = [
    ["not_signed_in", "Sign in required"],
    ["session_expired", "Session expired"],
    ["bearer_invalid", "Authentication failed"],
    ["audience_mismatch", "Authentication failed"],
    ["missing_role", "Access denied"],
    ["pdp_denied", "Access denied"],
    ["cel_denied", "Access denied"],
    ["forbidden", "Access denied"],
    ["pdp_unavailable", "Authorization service unavailable"],
  ];

  it.each(cases)("renders title for reason=%s", (reason, expected) => {
    expect(
      authErrorToastTitle({
        status: 401,
        message: "x",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reason: reason as any,
      }),
    ).toBe(expected);
  });

  it("falls back to status-based title when reason missing", () => {
    expect(authErrorToastTitle({ status: 403, message: "x" })).toBe(
      "Access denied",
    );
    expect(authErrorToastTitle({ status: 401, message: "x" })).toBe(
      "Authentication failed",
    );
  });
});

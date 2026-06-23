/**
 * @jest-environment jsdom
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  ASSISTANT_CONTEXT_MESSAGE_TYPE,
  authorizeAppResource,
  parseAppScopedTokenClaims,
  publishAssistantContext,
} from "../index";

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    btoa(JSON.stringify({ alg: "none", typ: "JWT" })),
    btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    "",
  ].join(".");
}

describe("agentic app SDK", () => {
  it("publishes versioned assistant bridge messages", () => {
    const targetWindow = { postMessage: jest.fn() };

    publishAssistantContext({
      appId: "weather",
      targetWindow,
      targetOrigin: "http://localhost:3000",
      context: { route: "/forecast", title: "Forecast" },
    });

    expect(targetWindow.postMessage).toHaveBeenCalledWith(
      {
        type: ASSISTANT_CONTEXT_MESSAGE_TYPE,
        version: "1.0",
        appId: "weather",
        context: { route: "/forecast", title: "Forecast" },
      },
      "http://localhost:3000",
    );
  });

  it("parses app-scoped token claims without verifying signatures", () => {
    const claims = parseAppScopedTokenClaims(
      unsignedJwt({ app_id: "weather", scp: ["weather:read"], decision_id: "dec-1" }),
    );

    expect(claims).toEqual(
      expect.objectContaining({ app_id: "weather", scp: ["weather:read"], decision_id: "dec-1" }),
    );
  });

  it("requests app-owned authorization", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        decisionId: "dec-1",
        correlationId: "corr-1",
        token: "token",
        expiresAt: "2026-05-09T00:00:00Z",
        scopes: ["weather:read"],
      }),
    });

    const result = await authorizeAppResource({
      appId: "weather",
      action: "weather:read",
      scopes: ["weather:read"],
      correlationId: "corr-1",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/agentic-apps/weather/authorize",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-correlation-id": "corr-1" }),
      }),
    );
    expect(result.token).toBe("token");
  });
});

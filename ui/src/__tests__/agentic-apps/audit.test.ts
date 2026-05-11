/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  buildAgenticAppAuditEvent,
  redactAgenticAppAuditPayload,
} from "@/lib/agentic-apps/audit";

describe("agentic app audit helpers", () => {
  it("redacts forbidden token, cookie, secret, and provider payload fields recursively", () => {
    const safe = redactAgenticAppAuditPayload({
      method: "POST",
      authorization: "dummy-token",
      Cookie: "dummy-cookie",
      nested: {
        providerSecret: "dummy-secret",
        providerPayload: { private: "raw-provider-body" },
        keep: "safe",
      },
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": "dummy-signature",
      },
    });

    expect(safe).toEqual({
      method: "POST",
      authorization: "[REDACTED]",
      Cookie: "[REDACTED]",
      nested: {
        providerSecret: "[REDACTED]",
        providerPayload: "[REDACTED]",
        keep: "safe",
      },
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": "[REDACTED]",
      },
    });
  });

  it("builds safe audit events with stable trace fields and redacted payload", () => {
    const event = buildAgenticAppAuditEvent({
      type: "agentic_app.pdp.denied",
      actorEmail: "admin@example.com",
      appId: "neutral-app",
      decisionId: "dec_1",
      correlationId: "corr_1",
      outcome: "denied",
      reasonCode: "unauthorized",
      payload: {
        route: "/apps/neutral-app/private",
        accessToken: "dummy-token",
      },
    });

    expect(event).toEqual(
      expect.objectContaining({
        type: "agentic_app.pdp.denied",
        actorEmail: "admin@example.com",
        appId: "neutral-app",
        decisionId: "dec_1",
        correlationId: "corr_1",
        outcome: "denied",
        reasonCode: "unauthorized",
        payload: {
          route: "/apps/neutral-app/private",
          accessToken: "[REDACTED]",
        },
      }),
    );
    expect(typeof event.createdAt).toBe("string");
  });
});

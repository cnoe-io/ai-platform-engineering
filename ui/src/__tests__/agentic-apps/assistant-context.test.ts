/**
 * @jest-environment jsdom
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  ASSISTANT_CONTEXT_MESSAGE_TYPE,
  buildAssistantClientContext,
  validateAssistantContextMessage,
} from "@/lib/agentic-apps/assistant-context";

describe("agentic app assistant context validation", () => {
  const validMessage = {
    type: ASSISTANT_CONTEXT_MESSAGE_TYPE,
    version: "1.0",
    appId: "weather",
    context: {
      route: "/forecast",
      title: "Forecast",
      summary: "User is viewing San Jose weather.",
      selection: "Saturday has rain risk.",
      resourceRefs: [{ type: "weather-location", id: "san-jose-ca", label: "San Jose" }],
      suggestedPrompts: ["Explain this forecast"],
    },
  };

  it("accepts bounded context and produces untrusted chat metadata", () => {
    const result = validateAssistantContextMessage({
      message: validMessage,
      appId: "weather",
      origin: "http://localhost",
      expectedOrigin: "http://localhost",
      now: new Date("2026-05-09T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected context acceptance");
    expect(result.record.validationStatus).toBe("accepted");
    expect(result.record.payloadSizeBytes).toBeGreaterThan(0);
    expect(buildAssistantClientContext(result.record)).toEqual(
      expect.objectContaining({
        source: "agentic_app_context",
        trust: "untrusted_user_visible_data",
        appId: "weather",
        route: "/forecast",
      }),
    );
  });

  it("rejects source, app, version, size, shape, and secret-like failures", () => {
    expect(
      validateAssistantContextMessage({
        message: validMessage,
        appId: "weather",
        origin: "https://evil.example",
        expectedOrigin: "http://localhost",
      }),
    ).toEqual({ ok: false, reasonCode: "invalid_origin" });

    expect(validateAssistantContextMessage({ message: validMessage, appId: "finops" })).toEqual({
      ok: false,
      reasonCode: "app_mismatch",
    });

    expect(
      validateAssistantContextMessage({
        message: { ...validMessage, version: "2.0" },
        appId: "weather",
      }),
    ).toEqual({ ok: false, reasonCode: "unsupported_version" });

    expect(
      validateAssistantContextMessage({
        message: { ...validMessage, context: { route: "forecast" } },
        appId: "weather",
      }),
    ).toEqual({ ok: false, reasonCode: "invalid_route" });

    expect(validateAssistantContextMessage({ message: validMessage, appId: "weather", maxBytes: 10 })).toEqual({
      ok: false,
      reasonCode: "payload_too_large",
    });

    expect(
      validateAssistantContextMessage({
        message: {
          ...validMessage,
          context: { route: "/forecast", summary: "Bearer abc.def.ghi" },
        },
        appId: "weather",
      }),
    ).toEqual({ ok: false, reasonCode: "secret_like_context" });
  });
});

import {
  evaluateAgenticAppCasCompatibility,
  resolveAgenticAppCasMode,
} from "../cas-compat";

describe("Agentic App CAS compatibility", () => {
  it("defaults to enforce mode", () => {
    expect(resolveAgenticAppCasMode(undefined)).toBe("enforce");
  });

  it("records a shadow denial without changing the local allow", async () => {
    const authorizer = jest.fn().mockResolvedValue({
      decision: "DENY",
      reason: "NO_CAPABILITY",
      retriable: false,
    });
    const result = await evaluateAgenticAppCasCompatibility({
      appId: "example-app",
      subjectId: "test-user",
      localEffect: "allow",
      correlationId: "correlation-example",
      mode: "shadow",
      authorizer,
    });

    expect(result).toEqual({
      mode: "shadow",
      casDecision: "DENY",
      casReason: "NO_CAPABILITY",
      effectiveEffect: "allow",
    });
    expect(authorizer).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: { type: "agentic_app", id: "example-app" },
        action: "use",
      }),
      { correlationId: "correlation-example" },
    );
  });

  it("fails closed on a CAS denial in enforce mode", async () => {
    const result = await evaluateAgenticAppCasCompatibility({
      appId: "example-app",
      subjectId: "test-user",
      localEffect: "allow",
      correlationId: "correlation-example",
      mode: "enforce",
      authorizer: async () => ({
        decision: "DENY",
        reason: "NO_CAPABILITY",
        retriable: false,
      }),
    });
    expect(result.effectiveEffect).toBe("deny");
  });
});

/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mocks = {
  appendAppTokenGrant: jest.fn(),
  appendPdpDecision: jest.fn(),
  cas: jest.fn(),
  decide: jest.fn(),
  mint: jest.fn(),
  resolveBinding: jest.fn(),
};

jest.mock("@/lib/api-middleware", () => ({
  getAuthenticatedUser: jest.fn(async () => ({
    user: { email: "test-user@example.com", name: "Test User", role: "user" },
    session: { sub: "test-user", role: "user" },
  })),
}));

jest.mock("@/lib/agentic-apps/execution-binding", () => ({
  resolveAgenticAppExecutionBinding: (...args: unknown[]) => mocks.resolveBinding(...args),
}));

jest.mock("@/lib/agentic-apps/cas-compat", () => ({
  evaluateAgenticAppCasCompatibility: (...args: unknown[]) => mocks.cas(...args),
}));

jest.mock("@/lib/agentic-apps/pdp", () => ({
  decideAgenticAppPdp: (...args: unknown[]) => mocks.decide(...args),
  buildPdpDecisionRecord: (input: unknown) => input,
}));

jest.mock("@/lib/agentic-apps/store", () => ({
  appendAppTokenGrant: (...args: unknown[]) => mocks.appendAppTokenGrant(...args),
  appendPdpDecision: (...args: unknown[]) => mocks.appendPdpDecision(...args),
}));

jest.mock("@/lib/agentic-apps/tokens", () => ({
  mintAppScopedToken: (...args: unknown[]) => mocks.mint(...args),
}));

const binding = {
  pkg: {
    packageId: "weather",
    source: "builtin",
    manifest: {
      id: "weather",
      authorization: { resourceType: "agentic_app", launchAction: "use" },
    },
  },
  installation: { appId: "weather", packageId: "weather" },
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/agentic-apps/weather/authorize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "correlation-example",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agentic-apps/[appId]/authorize", () => {
  const previousEnabled = process.env.AGENTIC_APPS_INSTALL_ENABLED;

  beforeAll(() => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
  });

  afterAll(() => {
    if (previousEnabled === undefined) delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    else process.env.AGENTIC_APPS_INSTALL_ENABLED = previousEnabled;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mocks.resolveBinding.mockResolvedValue(binding);
    mocks.decide.mockReturnValue({
      decisionId: "decision-example",
      effect: "allow",
      reasonCode: "allowed",
      scopes: ["weather:read"],
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    mocks.cas.mockResolvedValue({
      mode: "enforce",
      casDecision: "ALLOW",
      effectiveEffect: "allow",
    });
    mocks.mint.mockResolvedValue({
      token: "header.payload.signature",
      jti: "token-example",
      audience: "agentic-app:weather",
      tokenHash: "token-hash-example",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("exchanges an authenticated CAS allow for a scoped app token", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      request({ action: "proxy:GET", scopes: ["weather:read"] }),
      { params: Promise.resolve({ appId: "weather" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      decisionId: "decision-example",
      correlationId: "correlation-example",
      token: "header.payload.signature",
      expiresAt: "2030-01-01T00:00:00.000Z",
      scopes: ["weather:read"],
    });
    expect(response.headers.get("x-caipe-cas-mode")).toBe("enforce");
    expect(response.headers.get("x-caipe-cas-decision")).toBe("ALLOW");
    expect(mocks.cas).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "weather",
        subjectId: "test-user",
        localEffect: "allow",
        mode: "enforce",
      }),
    );
    expect(mocks.mint).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "weather",
        subject: "test-user",
        scopes: ["weather:read"],
      }),
    );
    expect(mocks.appendAppTokenGrant).toHaveBeenCalledTimes(1);
  });

  it("fails closed and does not mint when CAS denies", async () => {
    mocks.cas.mockResolvedValue({
      mode: "enforce",
      casDecision: "DENY",
      casReason: "NO_CAPABILITY",
      effectiveEffect: "deny",
    });
    const { POST } = await import("../route");
    const response = await POST(
      request({ action: "proxy:GET", scopes: ["weather:read"] }),
      { params: Promise.resolve({ appId: "weather" }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: "pdp_denied",
        decisionId: "decision-example",
        reasonCode: "cas_no_capability",
      }),
    );
    expect(mocks.mint).not.toHaveBeenCalled();
    expect(mocks.appendAppTokenGrant).not.toHaveBeenCalled();
    expect(mocks.appendPdpDecision).toHaveBeenCalledTimes(1);
  });

  it("checks the route-declared CAS capability before minting an approval scope", async () => {
    mocks.resolveBinding.mockResolvedValue({
      ...binding,
      pkg: {
        ...binding.pkg,
        manifest: {
          ...binding.pkg.manifest,
          access: {
            tokenScopes: ["example-app:approve"],
            policyActions: [{
              action: "proposal:review",
              requiredScopes: ["example-app:approve"],
              casAction: "approve",
            }],
          },
        },
      },
    });
    mocks.decide.mockReturnValue({
      decisionId: "decision-approve",
      effect: "allow",
      reasonCode: "allowed",
      scopes: ["example-app:approve"],
      expiresAt: "2030-01-01T00:00:00.000Z",
    });

    const { POST } = await import("../route");
    const response = await POST(
      request({ action: "proposal:review", scopes: ["example-app:approve"] }),
      { params: Promise.resolve({ appId: "weather" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.cas).toHaveBeenCalledWith(expect.objectContaining({ action: "approve" }));
    expect(mocks.mint).toHaveBeenCalledWith(expect.objectContaining({
      scopes: ["example-app:approve"],
    }));
  });

  it("rejects malformed scopes before evaluating policy", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      request({ action: "proxy:GET", scopes: "weather:read" }),
      { params: Promise.resolve({ appId: "weather" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scopes" });
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.cas).not.toHaveBeenCalled();
  });

  it("rejects a resource other than the requested app", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      request({
        action: "proxy:GET",
        scopes: ["weather:read"],
        resource: { type: "agentic_app", id: "finops" },
      }),
      { params: Promise.resolve({ appId: "weather" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "resource_mismatch" });
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.cas).not.toHaveBeenCalled();
  });
});

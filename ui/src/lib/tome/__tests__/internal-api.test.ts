/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

import { requireAgentToken } from "@/lib/tome/internal-api";

const originalToken = process.env.TOME_AGENT_TOKEN;

function request(token?: string, scheme = "Bearer"): NextRequest {
  return new NextRequest("http://example.test/api/tome/api/internal/projects", {
    headers: token ? { authorization: `${scheme} ${token}` } : {},
  });
}

describe("internal Tome callback authentication", () => {
  afterEach(() => {
    if (originalToken === undefined) delete process.env.TOME_AGENT_TOKEN;
    else process.env.TOME_AGENT_TOKEN = originalToken;
  });

  it("fails closed when TOME_AGENT_TOKEN is missing", () => {
    delete process.env.TOME_AGENT_TOKEN;
    try {
      requireAgentToken(request());
      throw new Error("expected missing-token configuration failure");
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 503,
        code: "TOME_AGENT_TOKEN_REQUIRED",
      });
    }
  });

  it.each(["", "   ", "\t"])(
    "fails closed when TOME_AGENT_TOKEN is blank (%p)",
    (configuredToken) => {
      process.env.TOME_AGENT_TOKEN = configuredToken;
      expect(() => requireAgentToken(request("anything"))).toThrow(
        expect.objectContaining({
          statusCode: 503,
          code: "TOME_AGENT_TOKEN_REQUIRED",
        }),
      );
    },
  );

  it("rejects an invalid token", () => {
    process.env.TOME_AGENT_TOKEN = "expected-token";
    try {
      requireAgentToken(request("wrong-token"));
      throw new Error("expected invalid-token rejection");
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 401, code: "AGENT_UNAUTHORIZED" });
    }
  });

  it("rejects a valid token sent with the wrong authentication scheme", () => {
    process.env.TOME_AGENT_TOKEN = "expected-token";
    expect(() => requireAgentToken(request("expected-token", "Basic"))).toThrow(
      expect.objectContaining({ statusCode: 401, code: "AGENT_UNAUTHORIZED" }),
    );
  });

  it("rejects a missing authorization header", () => {
    process.env.TOME_AGENT_TOKEN = "expected-token";
    expect(() => requireAgentToken(request())).toThrow(
      expect.objectContaining({ statusCode: 401, code: "AGENT_UNAUTHORIZED" }),
    );
  });

  it("accepts the configured token", () => {
    process.env.TOME_AGENT_TOKEN = "expected-token";
    expect(() => requireAgentToken(request("expected-token"))).not.toThrow();
  });

  it("accepts the bearer scheme case-insensitively", () => {
    process.env.TOME_AGENT_TOKEN = "expected-token";
    expect(() => requireAgentToken(request("expected-token", "bEaReR"))).not.toThrow();
  });
});

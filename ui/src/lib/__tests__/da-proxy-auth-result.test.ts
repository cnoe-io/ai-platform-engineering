/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "../da-proxy";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();

jest.mock("../api-middleware", () => ({
  ApiError: class ApiError extends Error {
    statusCode: number;
    code?: string;
    reason?: string;
    action?: string;

    constructor(message: string, statusCode: number, code?: string, reason?: string, action?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.reason = reason;
      this.action = action;
    }
  },
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
}));

jest.mock("../config", () => ({
  getServerConfig: () => ({ dynamicAgentsUrl: "http://dynamic-agents:8000" }),
}));

function request(path = "/api/v1/chat/invoke"): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

describe("authenticateRequest auth result", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes stable subject and bearer token for downstream OpenFGA checks", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "alice@example.com", name: "Alice", role: "user" },
      session: {
        sub: "alice-sub",
        accessToken: "access-token",
        canViewAdmin: false,
        canAccessDynamicAgents: true,
      },
    });

    const result = await authenticateRequest(request());

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toMatchObject({
      subject: "alice-sub",
      bearerToken: "access-token",
      role: "user",
    });
  });

  it("falls back to email as subject only when the session sub is missing", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "alice@example.com", name: "Alice", role: "user" },
      session: {
        accessToken: "access-token",
        canViewAdmin: false,
        canAccessDynamicAgents: true,
      },
    });

    const result = await authenticateRequest(request());

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toMatchObject({
      subject: "alice@example.com",
      bearerToken: "access-token",
      role: "user",
    });
  });

  it("allows browser session fallback without a bearer token for DA backend calls", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "alice@example.com", name: "Alice", role: "admin" },
      session: {
        sub: "alice-sub",
        canViewAdmin: true,
        canAccessDynamicAgents: true,
      },
    });

    const result = await authenticateRequest(request("/api/dynamic-agents/middleware"));

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toMatchObject({
      subject: "alice-sub",
      email: "alice@example.com",
      role: "admin",
      bearerToken: undefined,
    });
  });
});

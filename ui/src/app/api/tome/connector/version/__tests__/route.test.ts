/** @jest-environment node */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireInteractiveTomePrincipal = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) =>
    mockGetAuthFromBearerOrSession(...args),
}));

jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => true,
}));

jest.mock("@/lib/tome/principal", () => ({
  requireInteractiveTomePrincipal: (...args: unknown[]) =>
    mockRequireInteractiveTomePrincipal(...args),
}));

import { GET } from "../route";

describe("TOME REST connector version endpoint", () => {
  beforeEach(() => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      session: { principalType: "tome_api_key", sub: "viewer-subject" },
    });
    mockRequireInteractiveTomePrincipal.mockReset();
  });

  it("returns a minimal authenticated version response", async () => {
    const response = await GET(
      new NextRequest("https://example.test/api/tome/connector/version", {
        headers: { "x-caipe-token": "Bearer redacted" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "tome",
      version: "0.1.0",
      status: "ok",
    });
  });

  it("returns 401 without a valid principal", async () => {
    mockGetAuthFromBearerOrSession.mockRejectedValue(new Error("unauthorized"));

    const response = await GET(
      new NextRequest("https://example.test/api/tome/connector/version"),
    );

    expect(response.status).toBe(401);
  });
});

/** @jest-environment node */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireInteractiveTomePrincipal = jest.fn();
const mockGetTomeMcpTool = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
}));

jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => true,
}));

jest.mock("@/lib/tome/principal", () => ({
  requireInteractiveTomePrincipal: (...args: unknown[]) =>
    mockRequireInteractiveTomePrincipal(...args),
}));

jest.mock("@/app/api/tome/mcp/route", () => ({
  getTomeMcpTool: (...args: unknown[]) => mockGetTomeMcpTool(...args),
}));

import { POST } from "../[toolName]/route";

beforeEach(() => {
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    session: { principalType: "tome_api_key", sub: "viewer-subject" },
  });
  mockRequireInteractiveTomePrincipal.mockReset();
});

describe("TOME REST connector operation", () => {
  it("executes a tool as a JSON REST response", async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ projects: [] }) }],
    });
    mockGetTomeMcpTool.mockReturnValue({
      name: "tome_list_projects",
      inputSchema: { type: "object", required: [] },
      handler,
    });

    const response = await POST(
      new NextRequest("https://example.test/api/tome/connector/tome_list_projects", {
        method: "POST",
        headers: { "x-caipe-token": "Bearer redacted" },
        body: "{}",
      }),
      { params: Promise.resolve({ toolName: "tome_list_projects" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { projects: [] } });
    expect(handler).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
      {},
    );
  });

  it("rejects missing required arguments before invoking a tool", async () => {
    const handler = jest.fn();
    mockGetTomeMcpTool.mockReturnValue({
      name: "tome_get_project",
      inputSchema: { type: "object", required: ["project_slug"] },
      handler,
    });

    const response = await POST(
      new NextRequest("https://example.test/api/tome/connector/tome_get_project", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ toolName: "tome_get_project" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Missing required argument(s): project_slug",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("requires an interactive authenticated principal", async () => {
    mockGetTomeMcpTool.mockReturnValue({
      name: "tome_list_projects",
      inputSchema: { type: "object", required: [] },
      handler: jest.fn(),
    });
    mockGetAuthFromBearerOrSession.mockRejectedValue(new Error("unauthorized"));

    const response = await POST(
      new NextRequest("https://example.test/api/tome/connector/tome_list_projects", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ toolName: "tome_list_projects" }) },
    );

    expect(response.status).toBe(401);
  });
});

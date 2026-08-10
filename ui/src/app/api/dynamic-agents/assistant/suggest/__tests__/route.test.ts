/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockAuthenticateRequest = jest.fn();
const mockFetch = jest.fn();

jest.mock("@/lib/da-proxy", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
  buildBackendHeaders: () => ({ "Content-Type": "application/json" }),
}));

global.fetch = mockFetch as unknown as typeof fetch;

describe("POST /api/dynamic-agents/assistant/suggest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ subject: "alice-sub", bearerToken: "token" });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: "Suggested prompt" }),
    });
  });

  it("allows org members via ai_assist invoke, not dynamic_agent manage", async () => {
    const { POST } = await import("../route");

    const response = await POST(
      new NextRequest("http://localhost/api/dynamic-agents/assistant/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: "system_prompt",
          context: { name: "ArgoCD Agent" },
          model: { id: "gpt-4.1", provider: "openai" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockAuthenticateRequest).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { resource: "ai_assist", scope: "invoke" },
    );
  });
});

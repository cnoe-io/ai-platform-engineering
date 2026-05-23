/**
 * @jest-environment node
 */

const mockGetInternalA2AUrl = jest.fn();

jest.mock("@/lib/config", () => ({
  getInternalA2AUrl: (...args: unknown[]) => mockGetInternalA2AUrl(...args),
}));

import { GET, POST } from "../a2a/[[...path]]/route";

describe("/api/a2a proxy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInternalA2AUrl.mockReturnValue("http://supervisor-agent:8000");
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "CAIPE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("proxies agent-card GET requests to the internal supervisor service", async () => {
    const request = new Request("https://caipe.example.com/api/a2a/.well-known/agent-card.json");

    const response = await GET(request, {
      params: Promise.resolve({ path: [".well-known", "agent-card.json"] }),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://supervisor-agent:8000/.well-known/agent-card.json",
      expect.objectContaining({ method: "GET" }),
    );
    expect(response.status).toBe(200);
  });

  it("proxies A2A JSON-RPC POST requests to the internal supervisor root", async () => {
    const request = new Request("https://caipe.example.com/api/a2a", {
      method: "POST",
      headers: {
        authorization: "Bearer user-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "message/stream", id: "1" }),
    });

    await POST(request, {
      params: Promise.resolve({ path: [] }),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://supervisor-agent:8000/",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer user-token");
    expect(headers.get("content-type")).toBe("application/json");
  });
});

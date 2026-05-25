/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireConversationResourcePermission = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
}));

jest.mock("@/lib/rbac/conversation-implicit-authz", () => ({
  requireConversationResourcePermission: (...args: unknown[]) =>
    mockRequireConversationResourcePermission(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

function request(body: Record<string, unknown>, headers?: Record<string, string>): NextRequest {
  return new NextRequest(new URL("/api/chat/stream", "http://localhost:3000"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPERVISOR_SSE_URL = "http://supervisor:8000/chat/stream";
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      session: {
        accessToken: "session-token",
        sub: "alice-sub",
        user: { email: "alice@example.com" },
      },
      user: { email: "alice@example.com", name: "Alice", role: "user" },
    });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn(async () => ({
        _id: "conv-1",
        owner_id: "alice@example.com",
        owner_subject: "alice-sub",
      })),
    });
    mockRequireConversationResourcePermission.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue(
      new Response("event: done\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  });

  it("uses implicit conversation write auth and forwards the session token to the backend", async () => {
    const { POST } = await import("../chat/stream/route");

    const response = await POST(request({ conversation_id: "conv-1", message: "hi" }));

    expect(response.status).toBe(200);
    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "alice-sub" }),
      "alice@example.com",
      expect.objectContaining({ _id: "conv-1" }),
      "write",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://supervisor:8000/chat/stream",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
        }),
      }),
    );
  });

  it("does not call the backend when conversation write auth is denied", async () => {
    mockRequireConversationResourcePermission.mockRejectedValue(
      Object.assign(new Error("conversation denied"), {
        statusCode: 403,
        code: "conversation#write",
      }),
    );
    const { POST } = await import("../chat/stream/route");

    const response = await POST(request({ conversation_id: "conv-1", message: "hi" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      success: false,
      error: "conversation denied",
      code: "conversation#write",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

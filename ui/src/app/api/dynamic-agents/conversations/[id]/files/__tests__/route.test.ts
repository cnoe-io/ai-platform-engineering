/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from "next/server";

import { ApiError } from "@/lib/api-middleware";

const mockAuthenticateRequest = jest.fn();
const mockGetCollection = jest.fn();
const mockGetDynamicAgentsConfig = jest.fn();
const mockProxyRequest = jest.fn();
const mockRequireConversationResourcePermission = jest.fn();

jest.mock("@/lib/da-proxy", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
  getDynamicAgentsConfig: () => mockGetDynamicAgentsConfig(),
  proxyRequest: (...args: unknown[]) => mockProxyRequest(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/conversation-implicit-authz", () => ({
  requireConversationResourcePermission: (...args: unknown[]) =>
    mockRequireConversationResourcePermission(...args),
}));

const conversation = {
  _id: "conversation-primary",
  owner_id: "owner@example.com",
  participants: [
    { type: "user", id: "owner@example.com" },
    { type: "agent", id: "agent-authoritative" },
  ],
};

describe("conversation file routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({
      authzSession: { sub: "user-primary" },
      email: "owner@example.com",
      bearerToken: "token-primary",
    });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(conversation),
    });
    mockGetDynamicAgentsConfig.mockReturnValue({
      dynamicAgentsUrl: "http://dynamic-agents:8000",
    });
    mockProxyRequest.mockResolvedValue(Response.json({ success: true }));
    mockRequireConversationResourcePermission.mockResolvedValue(undefined);
  });

  it("derives the namespace agent from the authorized conversation", async () => {
    const { GET } = await import("../content/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/content" +
        "?agent_id=agent-client&path=report.txt",
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(response.status).toBe(200);
    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      { sub: "user-primary" },
      "owner@example.com",
      conversation,
      "read",
    );
    const backendUrl = new URL(mockProxyRequest.mock.calls[0][0]);
    expect(JSON.parse(backendUrl.searchParams.get("fs_namespace") ?? "[]")).toEqual([
      "agent-authoritative",
      "conversation-primary",
      "filesystem",
    ]);
  });

  it("requires write permission before deleting content", async () => {
    const { DELETE } = await import("../content/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/content?path=report.txt",
      { method: "DELETE" },
    );

    await DELETE(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      "owner@example.com",
      conversation,
      "write",
    );
  });

  it("authorizes list access before proxying", async () => {
    const { GET } = await import("../list/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/list",
    );

    await GET(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      "owner@example.com",
      conversation,
      "read",
    );
  });

  it("returns the coarse authorization response without loading the conversation", async () => {
    mockAuthenticateRequest.mockResolvedValue(
      NextResponse.json({ success: false }, { status: 403 }),
    );
    const { GET } = await import("../list/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/list",
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(response.status).toBe(403);
    expect(mockGetCollection).not.toHaveBeenCalled();
    expect(mockProxyRequest).not.toHaveBeenCalled();
  });

  it("fails closed when authenticated identity context is incomplete", async () => {
    mockAuthenticateRequest.mockResolvedValue({ bearerToken: "token-primary" });
    const { GET } = await import("../list/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/list",
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(response.status).toBe(401);
    expect(mockGetCollection).not.toHaveBeenCalled();
    expect(mockProxyRequest).not.toHaveBeenCalled();
  });

  it("returns not found without probing or proxying a missing conversation", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });
    const { GET } = await import("../list/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-missing/files/list",
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: "conversation-missing" }),
    });

    expect(response.status).toBe(404);
    expect(mockRequireConversationResourcePermission).not.toHaveBeenCalled();
    expect(mockProxyRequest).not.toHaveBeenCalled();
  });

  it("does not proxy when object-level read permission is denied", async () => {
    mockRequireConversationResourcePermission.mockRejectedValue(
      new ApiError("Permission denied", 403, "FORBIDDEN"),
    );
    const { GET } = await import("../content/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/content?path=report.txt",
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(response.status).toBe(403);
    expect(mockGetDynamicAgentsConfig).not.toHaveBeenCalled();
    expect(mockProxyRequest).not.toHaveBeenCalled();
  });

  it("does not proxy when object-level write permission is denied", async () => {
    mockRequireConversationResourcePermission.mockRejectedValue(
      new ApiError("Permission denied", 403, "FORBIDDEN"),
    );
    const { DELETE } = await import("../content/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/content?path=report.txt",
      { method: "DELETE" },
    );

    const response = await DELETE(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(response.status).toBe(403);
    expect(mockProxyRequest).not.toHaveBeenCalled();
  });

  it("rejects a conversation without an authoritative agent", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "conversation-primary",
        owner_id: "owner@example.com",
        participants: [{ type: "user", id: "owner@example.com" }],
      }),
    });
    const { GET } = await import("../list/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/list",
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(response.status).toBe(409);
    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      "owner@example.com",
      expect.anything(),
      "read",
    );
    expect(mockProxyRequest).not.toHaveBeenCalled();
  });

  it("validates the path before any authorization work", async () => {
    const { GET } = await import("../content/route");
    const request = new NextRequest(
      "http://localhost/api/dynamic-agents/conversations/conversation-primary/files/content",
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: "conversation-primary" }),
    });

    expect(response.status).toBe(400);
    expect(mockAuthenticateRequest).not.toHaveBeenCalled();
    expect(mockProxyRequest).not.toHaveBeenCalled();
  });
});

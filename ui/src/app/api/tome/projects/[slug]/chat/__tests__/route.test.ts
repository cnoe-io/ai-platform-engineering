/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockBuildChatRequest = jest.fn();
const mockEnsureSession = jest.fn();
const mockAppendMessage = jest.fn();
const mockSetSdkSessionId = jest.fn();
const mockCreateChatRun = jest.fn();
const mockAppendChatRunEvents = jest.fn();
const mockFinishChatRun = jest.fn();
const mockMarkChatRunRunning = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));
jest.mock("@/lib/tome/agent-proxy", () => ({
  buildChatRequest: (...args: unknown[]) => mockBuildChatRequest(...args),
}));
jest.mock("@/lib/tome/chat-history-store", () => ({
  ensureSession: (...args: unknown[]) => mockEnsureSession(...args),
  appendMessage: (...args: unknown[]) => mockAppendMessage(...args),
  setSdkSessionId: (...args: unknown[]) => mockSetSdkSessionId(...args),
}));
jest.mock("@/lib/tome/chat-run-store", () => ({
  createChatRun: (...args: unknown[]) => mockCreateChatRun(...args),
  appendChatRunEvents: (...args: unknown[]) => mockAppendChatRunEvents(...args),
  finishChatRun: (...args: unknown[]) => mockFinishChatRun(...args),
  markChatRunRunning: (...args: unknown[]) => mockMarkChatRunRunning(...args),
}));
jest.mock("@/lib/metrics", () => ({
  getMetrics: () => ({ tomeActiveChatSessions: {} }),
  trackActiveStream: (body: ReadableStream<Uint8Array>) => body,
}));

import { POST } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };
const session = {
  _id: "00000000-0000-4000-8000-000000000001",
  project_id: "project-1",
  user_id: "test-user@example.com",
  created_at: new Date(),
  updated_at: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TOME_AGENT_URL = "http://tome-agent:8000";
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    user: { email: "test-user@example.com" },
  });
  mockBuildChatRequest.mockResolvedValue({
    message: "Explain the project",
    sdk_session_id: null,
  });
  mockEnsureSession.mockResolvedValue(session);
  mockCreateChatRun.mockResolvedValue({ _id: "run-1" });
  mockAppendMessage.mockResolvedValue({ _id: "message-1" });
  mockAppendChatRunEvents.mockResolvedValue(undefined);
  mockFinishChatRun.mockResolvedValue(undefined);
  mockMarkChatRunRunning.mockResolvedValue(undefined);
  mockSetSdkSessionId.mockResolvedValue(undefined);
});

afterAll(() => {
  delete process.env.TOME_AGENT_URL;
});

describe("POST TOME chat", () => {
  it("returns a run id while the server branch buffers and persists the turn", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        'event: session\ndata: {"session_id":"sdk-1"}\n\n' +
          'event: token\ndata: {"text":"Durable response"}\n\n' +
          'event: done\ndata: {"model":"example-model"}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    const request = new NextRequest(
      "http://example.test/api/tome/projects/example-project/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Explain the project" }),
      },
    );

    const response = await POST(request, context);
    expect(response.headers.get("X-Tome-Run-Id")).toBe("run-1");
    expect(response.headers.get("X-Tome-Session-Id")).toBe(session._id);
    expect(await response.text()).toContain("Durable response");

    for (let i = 0; i < 10 && mockFinishChatRun.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(mockAppendChatRunEvents).toHaveBeenCalled();
    expect(mockAppendMessage).toHaveBeenLastCalledWith(
      session,
      "assistant",
      "Durable response",
      [{ kind: "text", text: "Durable response" }],
      "example-model",
      undefined,
    );
    expect(mockSetSdkSessionId).toHaveBeenCalledWith(session._id, "sdk-1");
    expect(mockFinishChatRun).toHaveBeenCalledWith(
      "run-1",
      "completed",
      undefined,
    );
  });
});

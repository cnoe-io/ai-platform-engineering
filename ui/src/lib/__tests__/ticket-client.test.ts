/**
 * Unit tests for ticket-client.ts
 *
 * Tests:
 * - createTicketViaAgent calls A2ASDKClient with correct prompt
 * - Jira ticket result extraction from agent response
 * - GitHub issue result extraction from agent response
 * - Error handling when agent fails
 * - onEvent and onResult callbacks fire
 * - Abort signal cancels streaming
 * - Provider not configured throws error
 * - Label included in prompt
 */

// ============================================================================
// Mocks
// ============================================================================

let mockProvider: string | null = "jira";
let mockProject: string | null = "OPENSD";
let mockLabel: string = "caipe-reported";
let mockGithubRepo: string | null = "org/repo";
let mockGithubLabel: string = "caipe-reported";
let mockCaipeUrl = "http://localhost:8000";

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => {
    switch (key) {
      case "ticketProvider":
        return mockProvider;
      case "jiraTicketProject":
        return mockProject;
      case "jiraTicketLabel":
        return mockLabel;
      case "githubTicketRepo":
        return mockGithubRepo;
      case "githubTicketLabel":
        return mockGithubLabel;
      case "caipeUrl":
        return mockCaipeUrl;
      default:
        return null;
    }
  },
}));

const mockAbort = jest.fn();
let mockStreamEvents: any[] = [];

jest.mock("@/lib/a2a-sdk-client", () => ({
  A2ASDKClient: jest.fn().mockImplementation(() => ({
    sendMessageStream: jest.fn(function* () {
      for (const event of mockStreamEvents) {
        yield event;
      }
    }),
    abort: mockAbort,
  })),
}));

// ============================================================================
// Imports
// ============================================================================

import { createTicketViaAgent } from "../ticket-client";
import { A2ASDKClient } from "@/lib/a2a-sdk-client";

// ============================================================================
// Tests
// ============================================================================

describe("createTicketViaAgent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProvider = "jira";
    mockProject = "OPENSD";
    mockLabel = "caipe-reported";
    mockGithubRepo = "org/repo";
    mockGithubLabel = "caipe-reported";
    mockStreamEvents = [];
  });

  it("throws when provider is not configured", async () => {
    mockProvider = null;

    await expect(
      createTicketViaAgent({
        request: {
          description: "test",
          userEmail: "u@e.com",
          contextUrl: "http://localhost/chat/1",
        },
      })
    ).rejects.toThrow("Ticket provider is not configured");
  });

  it("throws when project is not configured", async () => {
    mockProvider = "jira";
    mockProject = null;

    await expect(
      createTicketViaAgent({
        request: {
          description: "test",
          userEmail: "u@e.com",
          contextUrl: "http://localhost/chat/1",
        },
      })
    ).rejects.toThrow("Ticket provider is not configured");
  });

  it("creates A2ASDKClient with correct config", async () => {
    mockStreamEvents = [];

    await createTicketViaAgent({
      request: {
        description: "something broke",
        userEmail: "user@test.com",
        contextUrl: "http://localhost/chat/abc",
      },
      accessToken: "tok-123",
    });

    expect(A2ASDKClient).toHaveBeenCalledWith({
      endpoint: "http://localhost:8000",
      accessToken: "tok-123",
      userEmail: "user@test.com",
    });
  });

  it("extracts Jira ticket from final_result", async () => {
    mockStreamEvents = [
      {
        type: "artifact",
        artifactName: "final_result",
        displayContent:
          "Created Jira issue OPENSD-456. View at https://jira.example.com/browse/OPENSD-456",
        isFinal: true,
        contextId: "ctx-1",
      },
    ];

    const result = await createTicketViaAgent({
      request: {
        description: "bug",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
      },
    });

    expect(result).toEqual({
      id: "OPENSD-456",
      url: "https://jira.example.com/browse/OPENSD-456",
      provider: "jira",
    });
  });

  it("extracts GitHub issue from final_result", async () => {
    mockProvider = "github";
    mockStreamEvents = [
      {
        type: "artifact",
        artifactName: "final_result",
        displayContent:
          "Created issue #42 at https://github.com/org/repo/issues/42",
        isFinal: true,
      },
    ];

    const result = await createTicketViaAgent({
      request: {
        description: "bug",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
      },
    });

    expect(result).toEqual({
      id: "#42",
      url: "https://github.com/org/repo/issues/42",
      provider: "github",
    });
  });

  it("returns null when no final content", async () => {
    mockStreamEvents = [
      {
        type: "status",
        artifactName: "tool_notification_start",
        displayContent: "Starting...",
      },
    ];

    const result = await createTicketViaAgent({
      request: {
        description: "bug",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
      },
    });

    expect(result).toBeNull();
  });

  it("fires onEvent callback for each event", async () => {
    mockStreamEvents = [
      {
        type: "status",
        artifactName: "tool_notification_start",
        displayContent: "Starting...",
      },
      {
        type: "artifact",
        artifactName: "final_result",
        displayContent: "OPENSD-789",
        isFinal: true,
      },
    ];

    const onEvent = jest.fn();

    await createTicketViaAgent({
      request: {
        description: "bug",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
      },
      onEvent,
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[0][1]).toContain("tool_notification_start");
    expect(onEvent.mock.calls[1][1]).toContain("final_result");
    expect(onEvent.mock.calls[1][1]).toContain("[final]");
  });

  it("fires onResult callback when ticket is extracted", async () => {
    mockStreamEvents = [
      {
        type: "artifact",
        artifactName: "final_result",
        displayContent: "Created OPENSD-101",
        isFinal: true,
      },
    ];

    const onResult = jest.fn();

    await createTicketViaAgent({
      request: {
        description: "bug",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
      },
      onResult,
    });

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: "OPENSD-101", provider: "jira" })
    );
  });

  it("includes feedback context in prompt", async () => {
    mockStreamEvents = [];

    const mockSendMessageStream = jest.fn(function* () {});
    (A2ASDKClient as jest.Mock).mockImplementation(() => ({
      sendMessageStream: mockSendMessageStream,
      abort: mockAbort,
    }));

    await createTicketViaAgent({
      request: {
        description: "Inaccurate: it was wrong",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
        feedbackContext: {
          reason: "Inaccurate",
          additionalFeedback: "Response was wrong",
          feedbackType: "dislike",
        },
      },
    });

    const prompt = mockSendMessageStream.mock.calls[0][0];
    expect(prompt).toContain("Jira issue in project OPENSD");
    expect(prompt).toContain("Feedback Type: dislike");
    expect(prompt).toContain("Feedback Reason: Inaccurate");
    expect(prompt).toContain("Additional Feedback: Response was wrong");
    expect(prompt).toContain(`"caipe-reported"`);
  });

  it("includes custom label in prompt", async () => {
    mockLabel = "my-custom-label";
    mockStreamEvents = [];

    const mockSendMessageStream = jest.fn(function* () {});
    (A2ASDKClient as jest.Mock).mockImplementation(() => ({
      sendMessageStream: mockSendMessageStream,
      abort: mockAbort,
    }));

    await createTicketViaAgent({
      request: {
        description: "test",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
      },
    });

    const prompt = mockSendMessageStream.mock.calls[0][0];
    expect(prompt).toContain(`"my-custom-label"`);
  });

  it("uses GitHub target when provider is github", async () => {
    mockProvider = "github";
    mockStreamEvents = [];

    const mockSendMessageStream = jest.fn(function* () {});
    (A2ASDKClient as jest.Mock).mockImplementation(() => ({
      sendMessageStream: mockSendMessageStream,
      abort: mockAbort,
    }));

    await createTicketViaAgent({
      request: {
        description: "test",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
      },
    });

    const prompt = mockSendMessageStream.mock.calls[0][0];
    expect(prompt).toContain("GitHub issue in repository org/repo");
  });

  it("extracts Jira key without URL", async () => {
    const events = [
      {
        type: "artifact",
        artifactName: "final_result",
        displayContent: "Created issue OPENSD-999 successfully.",
        isFinal: true,
      },
    ];

    (A2ASDKClient as jest.Mock).mockImplementation(() => ({
      sendMessageStream: jest.fn(function* () {
        for (const e of events) yield e;
      }),
      abort: mockAbort,
    }));

    const result = await createTicketViaAgent({
      request: {
        description: "bug",
        userEmail: "u@e.com",
        contextUrl: "http://localhost/chat/1",
      },
    });

    expect(result).toEqual({
      id: "OPENSD-999",
      url: "",
      provider: "jira",
    });
  });
});

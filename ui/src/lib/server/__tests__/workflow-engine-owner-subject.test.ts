/**
 * @jest-environment node
 *
 * Unit tests for runOwnerSubject — the Phase 3 helper that extracts the workflow
 * run owner's `sub` from the forwarded Bearer token so executeSteps can run the
 * per-step CAS agent-use gate. Pure function; the heavy workflow-engine imports
 * are mocked to no-ops so the module loads in isolation.
 */
jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/streaming/clients/server-agui-consumer", () => ({ consumeAgentStream: jest.fn() }));
jest.mock("@/lib/server/event-store", () => ({ readEvents: jest.fn() }));
jest.mock("@/lib/authz", () => ({ authorize: jest.fn() }));

import { readEvents } from "@/lib/server/event-store";
import type { StreamEvent } from "@/lib/streaming/types";
import {
  buildWorkflowContextPrefix,
  resolveStepResponseText,
  runOwnerSubject,
} from "../workflow-engine";

const mockReadEvents = readEvents as jest.MockedFunction<typeof readEvents>;

beforeEach(() => {
  mockReadEvents.mockReset();
});

/** Build a JWT (`header.payload.signature`) with a base64url-encoded payload. */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

describe("runOwnerSubject", () => {
  it("returns the sub from a valid Bearer JWT", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ sub: "alice-sub" })}` })).toBe("alice-sub");
  });

  it("reads a lowercase `authorization` header too", () => {
    expect(runOwnerSubject({ authorization: `Bearer ${jwt({ sub: "bob-sub" })}` })).toBe("bob-sub");
  });

  it("trims surrounding whitespace on the sub", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ sub: "  carol-sub  " })}` })).toBe("carol-sub");
  });

  it("returns null when there is no Authorization header (system run)", () => {
    expect(runOwnerSubject({})).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(runOwnerSubject({ Authorization: "Basic dXNlcjpwYXNz" })).toBeNull();
  });

  it("returns null when the token has fewer than two segments", () => {
    expect(runOwnerSubject({ Authorization: "Bearer not-a-jwt" })).toBeNull();
  });

  it("returns null when the payload is not valid base64/JSON", () => {
    expect(runOwnerSubject({ Authorization: "Bearer aaa.@@@notbase64@@@.sig" })).toBeNull();
  });

  it("returns null when the JWT carries no sub", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ email: "x@y.com" })}` })).toBeNull();
  });

  it("returns null when the sub is whitespace-only", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ sub: "   " })}` })).toBeNull();
  });

  it("returns null when the sub is non-string", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ sub: 12345 })}` })).toBeNull();
  });
});

describe("resolveStepResponseText", () => {
  it("prefers assistant text over longer raw tool results", async () => {
    mockReadEvents.mockResolvedValue([
      contentEvent("Short assistant answer."),
      toolEndEvent("tool-1", JSON.stringify({ raw: "x".repeat(200) })),
    ]);

    await expect(resolveStepResponseText("source-1", "Short assistant answer.")).resolves.toBe(
      "Short assistant answer.",
    );
  });

  it("falls back to tool results when the step produced no assistant text", async () => {
    mockReadEvents.mockResolvedValue([
      toolEndEvent("tool-1", "Only tool output"),
      toolEndEvent("tool-2", "Longer tool output"),
    ]);

    await expect(resolveStepResponseText("source-1", "")).resolves.toBe("Longer tool output");
  });
});

describe("buildWorkflowContextPrefix", () => {
  const prompt = buildWorkflowContextPrefix(
    "Release workflow",
    "Prepare and publish a release",
    [],
    1,
    3,
    "Publish the release notes",
    "release-agent",
  );

  it("treats deterministically populated workflow-state files as read-only investigation context", () => {
    expect(prompt).toContain("workflow engine deterministically populates `workflow-state/`");
    expect(prompt).toContain("Treat the entire directory as read-only");
    expect(prompt).toContain("provided only as reference material for investigation");
    expect(prompt).toContain(
      "Previous-step logs are stored under `workflow-state/step-{N}--{agent-id}/`",
    );
  });

  it("directs agents to inspect shared files at the filesystem root", () => {
    expect(prompt).toContain("Other steps may write shared files at the filesystem root");
    expect(prompt).toContain("Run `ls /`");
  });

  it("keeps all agent-written files outside workflow-state", () => {
    expect(prompt).toContain("`/choices.txt`");
    expect(prompt).toContain("`/workflow-step-2--release-agent-error.txt`");
    expect(prompt).not.toContain("workflow-state/step-2--release-agent/error.txt");
  });
});

function contentEvent(content: string): StreamEvent {
  return {
    id: `content-${content.length}`,
    timestamp: new Date("2026-06-29T10:00:00.000Z"),
    type: "content",
    raw: {},
    namespace: [],
    content,
  };
}

function toolEndEvent(toolCallId: string, result: string): StreamEvent {
  return {
    id: `tool-${toolCallId}`,
    timestamp: new Date("2026-06-29T10:00:01.000Z"),
    type: "tool_end",
    raw: {},
    namespace: [],
    toolData: {
      tool_call_id: toolCallId,
      result,
    },
  };
}

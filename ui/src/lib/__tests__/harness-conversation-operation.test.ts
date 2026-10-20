/** @jest-environment node */
import { NextResponse } from "next/server";

const mockTarget = jest.fn();
const mockUse = jest.fn();
const mockRead = jest.fn();
const mockWrite = jest.fn();
const mockRuntime = jest.fn();
jest.mock("@/lib/harness-gateway", () => ({ resolveHarnessGatewayTarget: (...args: unknown[]) => mockTarget(...args) }));
jest.mock("@/lib/rbac/openfga-agent-authz", () => ({ requireAgentUsePermission: (...args: unknown[]) => mockUse(...args) }));
jest.mock("@/app/api/v1/chat/_conversation-authz", () => ({
  authorizeConversationReadAccess: (...args: unknown[]) => mockRead(...args),
  authorizeConversationWriteAccess: (...args: unknown[]) => mockWrite(...args),
  resolveConversationRuntimeId: (...args: unknown[]) => mockRuntime(...args),
}));
import { authorizeNativeConversationOperation } from "../harness-conversation-operation";

const auth = { subject: "example-user", email: "user@example.test" };
beforeEach(() => {
  jest.clearAllMocks();
  mockUse.mockResolvedValue(null);
  mockRead.mockResolvedValue({ denial: null, conversation: { _id: "visible-context", participants: [{ type: "agent", id: "example-agent" }] } });
  mockWrite.mockResolvedValue({ denial: null, conversation: { _id: "visible-context", participants: [{ type: "agent", id: "example-agent" }] } });
  mockRuntime.mockResolvedValue("authorized-runtime-context");
  mockTarget.mockResolvedValue({ kind: "dynamic_agents", harnessId: "dynamic_agents" });
});

it("uses the authorized runtime mapping without claiming or renaming its native state", async () => {
  expect(await authorizeNativeConversationOperation(auth, "visible-context", "example-agent", "logical file access"))
    .toEqual({ runtimeId: "authorized-runtime-context" });
  expect(mockTarget).toHaveBeenCalledWith("example-agent", { conversationId: "authorized-runtime-context" });
  expect(mockRead).toHaveBeenCalledWith(auth, "visible-context", "example-agent");
  expect(mockWrite).not.toHaveBeenCalled();
});

it("requires write authorization for mutation before looking at the runtime", async () => {
  const denial = NextResponse.json({ error: "Read only" }, { status: 403 });
  mockWrite.mockResolvedValue({ denial });
  expect(await authorizeNativeConversationOperation(auth, "visible-context", "example-agent", "runtime restart", true))
    .toBe(denial);
  expect(mockTarget).not.toHaveBeenCalled();
  expect(mockRuntime).not.toHaveBeenCalled();
});

it("does not inspect another caller's binding when agent use is denied", async () => {
  const denial = NextResponse.json({ error: "Forbidden" }, { status: 403 });
  mockUse.mockResolvedValue(denial);
  expect(await authorizeNativeConversationOperation(auth, "visible-context", "example-agent", "logical file access"))
    .toBe(denial);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockTarget).not.toHaveBeenCalled();
});

it("fails explicitly rather than invoking a native operation on an SDK binding", async () => {
  mockTarget.mockResolvedValue({ kind: "harness_engine", harnessId: "claude_agent_sdk" });
  const result = await authorizeNativeConversationOperation(auth, "visible-context", "example-agent", "runtime restart", true);
  expect(result).toBeInstanceOf(NextResponse);
  const response = result as NextResponse;
  expect(response.status).toBe(501);
  expect(await response.json()).toEqual(expect.objectContaining({ code: "HARNESS_CAPABILITY_UNSUPPORTED" }));
});


it("does not use another agent's native state through a writable conversation", async () => {
  mockWrite.mockResolvedValue({ denial: null, conversation: { _id: "visible-context", participants: [{ type: "agent", id: "different-agent" }] } });
  const result = await authorizeNativeConversationOperation(auth, "visible-context", "example-agent", "runtime restart", true);
  expect((result as NextResponse).status).toBe(403);
  expect(mockTarget).not.toHaveBeenCalled();
});

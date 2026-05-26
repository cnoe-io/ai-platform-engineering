/**
 * @jest-environment node
 */

import { requireAgentUsePermission } from "../openfga-agent-authz";
import { checkOpenFgaTuple, listOpenFgaObjects } from "../openfga";
import { logOpenFgaRebacAuditEvent } from "../audit";
import { __resetUserTeamCacheForTests } from "../openfga-team-membership";

jest.mock("../openfga", () => ({
  checkOpenFgaTuple: jest.fn(),
  listOpenFgaObjects: jest.fn(),
}));

jest.mock("../audit", () => ({
  logOpenFgaRebacAuditEvent: jest.fn(),
}));

const mockCheckOpenFgaTuple = checkOpenFgaTuple as jest.MockedFunction<typeof checkOpenFgaTuple>;
const mockListOpenFgaObjects = listOpenFgaObjects as jest.MockedFunction<
  typeof listOpenFgaObjects
>;
const mockLogOpenFgaRebacAuditEvent =
  logOpenFgaRebacAuditEvent as jest.MockedFunction<typeof logOpenFgaRebacAuditEvent>;

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("requireAgentUsePermission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetUserTeamCacheForTests();
    // Default to "user has no team memberships" so the existing deny path
    // tests reach the deny branch unchanged. Tests that exercise the
    // team-union path override this explicitly.
    mockListOpenFgaObjects.mockResolvedValue({ objects: [] });
  });

  it("allows callers with can_use on the selected agent", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });

    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(response).toBeNull();
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:alice-sub",
      relation: "can_use",
      object: "agent:agent-1",
    });
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "alice-sub",
        operation: "agent_use_check",
        outcome: "allow",
        pdp: "openfga",
        resourceRef: "user:alice-sub can_use agent:agent-1",
      }),
    );
  });

  it("allows callers through email-based team memberships when subject tuples are absent", async () => {
    mockCheckOpenFgaTuple
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: true });

    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      email: "alice@example.com",
      agentId: "agent-1",
    });

    expect(response).toBeNull();
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(1, {
      user: "user:alice-sub",
      relation: "can_use",
      object: "agent:agent-1",
    });
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(2, {
      user: "user:alice@example.com",
      relation: "can_use",
      object: "agent:agent-1",
    });
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "alice-sub",
        operation: "agent_use_check",
        outcome: "allow",
      }),
    );
  });

  it("denies callers without can_use on the selected agent", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(response?.status).toBe(403);
    await expect(responseBody(response as Response)).resolves.toMatchObject({
      success: false,
      code: "agent#use",
      reason: "pdp_denied",
      action: "contact_admin",
    });
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "alice-sub",
        operation: "agent_use_check",
        outcome: "deny",
        reasonCode: "DENY_NO_CAPABILITY",
      }),
    );
  });

  it("fails closed when OpenFGA is unavailable", async () => {
    mockCheckOpenFgaTuple.mockRejectedValue(new Error("OpenFGA is down"));

    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(response?.status).toBe(503);
    await expect(responseBody(response as Response)).resolves.toMatchObject({
      success: false,
      code: "PDP_UNAVAILABLE",
      reason: "pdp_unavailable",
      action: "retry",
    });
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "alice-sub",
        operation: "agent_use_check",
        outcome: "deny",
        reasonCode: "DENY_PDP_UNAVAILABLE",
      }),
    );
  });

  it("returns authentication failure when no subject is available", async () => {
    const response = await requireAgentUsePermission({
      subject: undefined,
      agentId: "agent-1",
    });

    expect(response?.status).toBe(401);
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
    await expect(responseBody(response as Response)).resolves.toMatchObject({
      success: false,
      code: "NOT_SIGNED_IN",
      reason: "not_signed_in",
      action: "sign_in",
    });
  });

  it("rejects malformed agent ids before calling OpenFGA", async () => {
    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      agentId: "../agent-1",
    });

    expect(response?.status).toBe(400);
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
    await expect(responseBody(response as Response)).resolves.toMatchObject({
      success: false,
      code: "INVALID_AGENT_ID",
      reason: "invalid_request",
      action: "fix_request",
    });
  });

  // Phase 2.7 of spec 2026-05-24-derive-team-from-channel (FR-038):
  // when no direct user-grant exists, fall back to the team-union path
  // so Web UI users with team-mediated agent access can dispatch.
  it("allows callers via team-union grant when no direct grant exists", async () => {
    mockCheckOpenFgaTuple
      .mockResolvedValueOnce({ allowed: false }) // user:alice-sub direct probe
      .mockResolvedValueOnce({ allowed: false }) // team:alpha#member probe
      .mockResolvedValueOnce({ allowed: true }); // team:bravo#member probe
    mockListOpenFgaObjects.mockResolvedValueOnce({
      objects: ["team:alpha", "team:bravo"],
    });

    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(response).toBeNull();
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(1, {
      user: "user:alice-sub",
      relation: "can_use",
      object: "agent:agent-1",
    });
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(2, {
      user: "team:alpha#member",
      relation: "can_use",
      object: "agent:agent-1",
    });
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(3, {
      user: "team:bravo#member",
      relation: "can_use",
      object: "agent:agent-1",
    });
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "alice-sub",
        operation: "agent_use_check",
        outcome: "allow",
        reasonCode: "ALLOW_TEAM_UNION",
        resourceRef: "team:bravo#member can_use agent:agent-1",
      }),
    );
  });

  it("denies when neither direct nor team-union path allows", async () => {
    mockCheckOpenFgaTuple
      .mockResolvedValueOnce({ allowed: false }) // direct
      .mockResolvedValueOnce({ allowed: false }) // team:alpha
      .mockResolvedValueOnce({ allowed: false }); // team:bravo
    mockListOpenFgaObjects.mockResolvedValueOnce({
      objects: ["team:alpha", "team:bravo"],
    });

    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(response?.status).toBe(403);
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "deny",
        reasonCode: "DENY_NO_CAPABILITY",
      }),
    );
  });

  it("does not call team-union path when direct grant already allows", async () => {
    mockCheckOpenFgaTuple.mockResolvedValueOnce({ allowed: true });

    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(response).toBeNull();
    expect(mockListOpenFgaObjects).not.toHaveBeenCalled();
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledTimes(1);
  });

  it("fails closed when listing user teams throws", async () => {
    mockCheckOpenFgaTuple.mockResolvedValueOnce({ allowed: false });
    mockListOpenFgaObjects.mockRejectedValueOnce(new Error("team listing died"));

    const response = await requireAgentUsePermission({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(response?.status).toBe(503);
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "DENY_PDP_UNAVAILABLE",
      }),
    );
  });
});

/**
 * @jest-environment node
 */

import { requireAgentUsePermission } from "../openfga-agent-authz";
import { checkOpenFgaTuple } from "../openfga";
import { logOpenFgaRebacAuditEvent } from "../audit";

jest.mock("../openfga", () => ({
  checkOpenFgaTuple: jest.fn(),
}));

jest.mock("../audit", () => ({
  logOpenFgaRebacAuditEvent: jest.fn(),
}));

const mockCheckOpenFgaTuple = checkOpenFgaTuple as jest.MockedFunction<typeof checkOpenFgaTuple>;
const mockLogOpenFgaRebacAuditEvent =
  logOpenFgaRebacAuditEvent as jest.MockedFunction<typeof logOpenFgaRebacAuditEvent>;

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("requireAgentUsePermission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});

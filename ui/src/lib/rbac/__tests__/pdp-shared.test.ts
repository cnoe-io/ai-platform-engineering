/**
 * @jest-environment node
 */

import { evaluateAgentAccess } from "../pdp-shared";
import { checkOpenFgaTuple } from "../openfga";
import {
  listUserTeamSlugs,
  __resetUserTeamCacheForTests,
} from "../openfga-team-membership";

jest.mock("../openfga", () => ({
  checkOpenFgaTuple: jest.fn(),
}));

jest.mock("../openfga-team-membership", () => {
  const actual = jest.requireActual("../openfga-team-membership");
  return {
    ...actual,
    listUserTeamSlugs: jest.fn(),
  };
});

const mockCheckOpenFgaTuple = checkOpenFgaTuple as jest.MockedFunction<typeof checkOpenFgaTuple>;
const mockListUserTeamSlugs = listUserTeamSlugs as jest.MockedFunction<typeof listUserTeamSlugs>;

describe("evaluateAgentAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetUserTeamCacheForTests();
  });

  it("allows via direct user grant and short-circuits before listing teams", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });

    const result = await evaluateAgentAccess({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(result).toEqual({
      allowed: true,
      path: "direct_user_grant",
      reasonCode: "ALLOW_DIRECT",
    });
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledTimes(1);
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:alice-sub",
      relation: "can_use",
      object: "agent:agent-1",
    });
    expect(mockListUserTeamSlugs).not.toHaveBeenCalled();
  });

  it("allows via team union and reports the team that granted access", async () => {
    mockListUserTeamSlugs.mockResolvedValue(["platform", "eti-sre-admin"]);
    mockCheckOpenFgaTuple
      // direct user grant — denied
      .mockResolvedValueOnce({ allowed: false })
      // first team probe — denied
      .mockResolvedValueOnce({ allowed: false })
      // second team probe — allowed
      .mockResolvedValueOnce({ allowed: true });

    const result = await evaluateAgentAccess({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(result).toEqual({
      allowed: true,
      path: "team_union",
      matchedTeamSlug: "eti-sre-admin",
      reasonCode: "ALLOW_TEAM_UNION",
    });
    expect(mockListUserTeamSlugs).toHaveBeenCalledWith({ subject: "alice-sub" });
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledTimes(3);
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(2, {
      user: "team:platform#member",
      relation: "can_use",
      object: "agent:agent-1",
    });
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(3, {
      user: "team:eti-sre-admin#member",
      relation: "can_use",
      object: "agent:agent-1",
    });
  });

  it("denies when neither direct grant nor any team grants access", async () => {
    mockListUserTeamSlugs.mockResolvedValue(["platform"]);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const result = await evaluateAgentAccess({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(result).toEqual({
      allowed: false,
      path: "denied",
      reasonCode: "DENY_NO_CAPABILITY",
    });
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledTimes(2);
  });

  it("denies cleanly when user belongs to zero teams and has no direct grant", async () => {
    mockListUserTeamSlugs.mockResolvedValue([]);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const result = await evaluateAgentAccess({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    expect(result).toEqual({
      allowed: false,
      path: "denied",
      reasonCode: "DENY_NO_CAPABILITY",
    });
    // Direct check happens; team probes do not because the membership list is empty.
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledTimes(1);
  });

  it("evaluates team probes in parallel and short-circuits on first allow", async () => {
    mockListUserTeamSlugs.mockResolvedValue(["a", "b", "c", "d"]);

    // Track the resolvers for each parallel probe so we can resolve them in a
    // chosen order to prove short-circuit behavior.
    const probeResolvers: Record<string, (v: { allowed: boolean }) => void> = {};

    mockCheckOpenFgaTuple
      // direct user check — fast-deny
      .mockResolvedValueOnce({ allowed: false })
      // four team probes — each captures its own resolver
      .mockImplementation(
        (tuple) =>
          new Promise((res) => {
            const slug = tuple.user.replace(/^team:|#member$/g, "");
            probeResolvers[slug] = res;
          }),
      );

    const pending = evaluateAgentAccess({
      subject: "alice-sub",
      agentId: "agent-1",
    });

    // Yield to the microtask queue twice so the direct check + listTeamSlugs +
    // all four parallel probes have been issued (and registered their resolvers).
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => setImmediate(res));

    expect(Object.keys(probeResolvers).sort()).toEqual(["a", "b", "c", "d"]);

    // Resolve in a non-natural order; "c" allows first.
    probeResolvers.a({ allowed: false });
    probeResolvers.c({ allowed: true });
    probeResolvers.b({ allowed: false });
    probeResolvers.d({ allowed: false });

    const result = await pending;
    expect(result.allowed).toBe(true);
    expect(result.path).toBe("team_union");
    expect(result.matchedTeamSlug).toBe("c");
  });

  it("propagates the underlying error when openfga check fails on the direct path", async () => {
    mockCheckOpenFgaTuple.mockRejectedValue(new Error("PDP unavailable"));

    await expect(
      evaluateAgentAccess({ subject: "alice-sub", agentId: "agent-1" }),
    ).rejects.toThrow(/PDP unavailable/);
    expect(mockListUserTeamSlugs).not.toHaveBeenCalled();
  });

  it("propagates the team-list error when the team enumeration fails", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    mockListUserTeamSlugs.mockRejectedValue(new Error("team list down"));

    await expect(
      evaluateAgentAccess({ subject: "alice-sub", agentId: "agent-1" }),
    ).rejects.toThrow(/team list down/);
  });

  it("validates the subject before issuing any openfga calls", async () => {
    await expect(
      evaluateAgentAccess({ subject: "", agentId: "agent-1" }),
    ).rejects.toThrow(/subject/i);
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
    expect(mockListUserTeamSlugs).not.toHaveBeenCalled();
  });

  it("validates the agent id before issuing any openfga calls", async () => {
    await expect(
      evaluateAgentAccess({ subject: "alice-sub", agentId: "../bad" }),
    ).rejects.toThrow(/agent/i);
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
  });
});

const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...a: unknown[]) => mockReadOpenFgaTuples(...a),
  writeOpenFgaTuples: (...a: unknown[]) => mockWriteOpenFgaTuples(...a),
}));

import { revokeTeamAutomatorGrants } from "@/lib/rbac/autonomous-cascade";

const SLUG = "platform-eng";
const A1 = { user: `team:${SLUG}#member`, relation: "automator", object: "agent:agent-a" };
const A2 = { user: `team:${SLUG}#member`, relation: "automator", object: "agent:agent-b" };

describe("revokeTeamAutomatorGrants", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 2 });
  });

  it("deletes every automator tuple for the team and returns the count plus affected agent ids", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [{ key: A1 }, { key: A2 }] });
    const result = await revokeTeamAutomatorGrants(SLUG);
    expect(result).toEqual({ count: 2, agentIds: ["agent-a", "agent-b"] });
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith({
      tuple: { user: `team:${SLUG}#member`, relation: "automator", object: "agent:" },
      continuationToken: undefined,
      pageSize: 100,
    });
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({ writes: [], deletes: [A1, A2] });
  });

  it("follows pagination while filtering to agent objects", async () => {
    const nonAgent = { user: `team:${SLUG}#member`, relation: "automator", object: "workflow:w1" };
    mockReadOpenFgaTuples
      .mockResolvedValueOnce({ tuples: [{ key: A1 }, { key: nonAgent }], continuationToken: "next" })
      .mockResolvedValueOnce({ tuples: [{ key: A2 }] });

    const result = await revokeTeamAutomatorGrants(SLUG);

    expect(result).toEqual({ count: 2, agentIds: ["agent-a", "agent-b"] });
    expect(mockReadOpenFgaTuples).toHaveBeenNthCalledWith(2, {
      tuple: { user: `team:${SLUG}#member`, relation: "automator", object: "agent:" },
      continuationToken: "next",
      pageSize: 100,
    });
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({ writes: [], deletes: [A1, A2] });
  });

  it("no-ops when the team has no automator grants", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
    const result = await revokeTeamAutomatorGrants(SLUG);
    expect(result).toEqual({ count: 0, agentIds: [] });
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
});

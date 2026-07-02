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

  it("deletes every automator tuple for the team and returns the count", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [{ key: A1 }, { key: A2 }] });
    const n = await revokeTeamAutomatorGrants(SLUG);
    expect(n).toBe(2);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({ writes: [], deletes: [A1, A2] });
  });

  it("no-ops when the team has no automator grants", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
    const n = await revokeTeamAutomatorGrants(SLUG);
    expect(n).toBe(0);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
});

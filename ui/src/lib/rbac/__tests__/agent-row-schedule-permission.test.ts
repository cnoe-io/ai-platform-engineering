const mockAuthorizeMany = jest.fn();
jest.mock("@/lib/authz", () => ({
  authorize: jest.fn(),
  authorizeMany: (...a: unknown[]) => mockAuthorizeMany(...a),
}));

import { resolveAgentListPermissions } from "@/lib/rbac/resource-authz";

describe("resolveAgentListPermissions can_schedule", () => {
  it("reports can_schedule per row from a schedule authorizeMany call", async () => {
    const allow = (id: string) => new Map([[id, { decision: "ALLOW" }]]);
    const deny = (id: string) => new Map([[id, { decision: "DENY" }]]);
    mockAuthorizeMany
      .mockResolvedValueOnce(deny("agent-a")) // manage
      .mockResolvedValueOnce(deny("agent-a")) // write
      .mockResolvedValueOnce(deny("agent-a")) // discover
      .mockResolvedValueOnce(allow("agent-a")); // schedule
    const { rows } = await resolveAgentListPermissions(
      { sub: "u-1", user: { email: "u@x" }, role: "user" },
      ["agent-a"],
    );
    expect(rows.get("agent-a")?.can_schedule).toBe(true);
    expect(mockAuthorizeMany).toHaveBeenCalledWith(expect.anything(), "schedule", "agent", ["agent-a"]);
  });
});

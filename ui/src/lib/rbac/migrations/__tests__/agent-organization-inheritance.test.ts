jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

import { deriveAgentOrganizationInheritancePlan } from "../registry";

describe("agent organization inheritance migration", () => {
  it("plans organization-admin manager tuples for existing dynamic agents", () => {
    const plan = deriveAgentOrganizationInheritancePlan([
      { _id: "agent-one" },
      { id: "agent-two" },
      { _id: "bad id" },
    ]);

    expect(plan.counts).toMatchObject({
      agents_scanned: 3,
      tuples_planned: 2,
      invalid_identifiers: 1,
    });
    expect(plan.tuple_writes_planned).toBe(2);
    expect(plan.sample_diffs).toEqual([
      {
        collection: "openfga_tuples",
        id: "agent_org_admin_inheritance_v1:0",
        before: {},
        after: { user: "organization:caipe#admin", relation: "manager", object: "agent:agent-one" },
      },
      {
        collection: "openfga_tuples",
        id: "agent_org_admin_inheritance_v1:1",
        before: {},
        after: { user: "organization:caipe#admin", relation: "manager", object: "agent:agent-two" },
      },
    ]);
  });
});

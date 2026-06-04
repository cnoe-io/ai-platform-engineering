/**
 * @jest-environment node
 */

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTupleDiff = jest.fn();

jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTupleDiff: (...args: unknown[]) => mockWriteOpenFgaTupleDiff(...args),
}));

import { getCollection } from "@/lib/mongodb";
import {
  AGENT_SKILL_OPENFGA_RECONCILE_CONFIRMATION,
  AGENT_SKILL_OPENFGA_RECONCILE_MIGRATION_ID,
  applyAgentSkillOpenFgaReconcileMigration,
  planAgentSkillOpenFgaReconcileMigration,
} from "../agent-skill-openfga-reconcile";
import { planMigration } from "../registry";

const mockGetCollection = getCollection as jest.MockedFunction<typeof getCollection>;

describe("agent_skill_openfga_reconcile_v1 migration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_ORG_KEY = "caipe";

    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: "team:legacy#member",
            relation: "user",
            object: "skill:skill-1",
          },
        },
      ],
      continuationToken: undefined,
    });

    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "agent_skills") {
        return {
          find: () => ({
            toArray: async () => [
              {
                id: "skill-1",
                owner_id: "alice@example.com",
                visibility: "private",
              },
            ],
          }),
        };
      }
      if (name === "users") {
        return {
          find: () => ({
            toArray: async () => [
              { email: "alice@example.com", keycloak_sub: "alice-sub" },
            ],
          }),
        };
      }
      if (name === "teams") {
        return {
          find: () => ({
            toArray: async () => [{ _id: "team-legacy-id", slug: "legacy" }],
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    });
  });

  it("plans v1→v2 migration with confirmation and tuple diffs", async () => {
    const plan = await planAgentSkillOpenFgaReconcileMigration();

    expect(plan.migration_id).toBe(AGENT_SKILL_OPENFGA_RECONCILE_MIGRATION_ID);
    expect(plan.from_version).toBe(1);
    expect(plan.to_version).toBe(2);
    expect(plan.schema_area).toBe("agent_skills");
    expect(plan.confirmation).toBe(AGENT_SKILL_OPENFGA_RECONCILE_CONFIRMATION);
    expect(plan.counts.skills_reconciled).toBe(1);
    expect(plan.tuples?.length).toBeGreaterThan(0);
    expect(plan.tuple_deletes).toEqual(
      expect.arrayContaining([
        { user: "team:legacy#member", relation: "user", object: "skill:skill-1" },
      ]),
    );
    expect(plan.sample_diffs.length).toBeGreaterThan(0);
  });

  it("is wired through planMigration in the registry", async () => {
    const plan = await planMigration(AGENT_SKILL_OPENFGA_RECONCILE_MIGRATION_ID);

    expect(plan.migration_id).toBe(AGENT_SKILL_OPENFGA_RECONCILE_MIGRATION_ID);
    expect(plan.tuple_writes_planned).toBeGreaterThan(0);
  });

  it("applies planned tuple writes and deletes", async () => {
    mockWriteOpenFgaTupleDiff.mockResolvedValue({ writes: 2, deletes: 1 });

    const plan = await planAgentSkillOpenFgaReconcileMigration();
    const result = await applyAgentSkillOpenFgaReconcileMigration({
      plan,
      actor: "admin@example.com",
      now: "2026-06-04T00:00:00.000Z",
    });

    expect(mockWriteOpenFgaTupleDiff).toHaveBeenCalledWith({
      writes: plan.tuples,
      deletes: plan.tuple_deletes,
    });
    expect(result.applied_counts).toMatchObject({
      tuple_writes_applied: 2,
      tuple_deletes_applied: 1,
    });
    expect(result.applied_by).toBe("admin@example.com");
  });
});

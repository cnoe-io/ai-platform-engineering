/**
 * @jest-environment node
 */
// assisted-by cursor (composer-2-fast)
//
// Pins the integration between `userCanModifyAgentSkill` and the
// built-in mutation lock. The visibility helper is the single
// authorisation funnel for the file routes (and now for the configs
// PUT/DELETE handlers via inline checks); it must consult the lock
// for `is_system: true` rows or the lock leaks through every other
// surface.

// Mongo isn't exercised by this unit test, but the helper module
// imports it transitively, so stub it out before requiring.
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

jest.mock("@/lib/api-middleware", () => ({
  getUserTeamIds: jest.fn().mockResolvedValue([]),
}));

import type { AgentSkill } from "@/types/agent-skill";

const baseSkill = (over: Partial<AgentSkill>): AgentSkill =>
  ({
    id: "skill-x",
    name: "x",
    description: "",
    category: "general",
    tasks: [],
    owner_id: "alice@example.com",
    is_system: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  }) as AgentSkill;

const reload = async () => {
  jest.resetModules();
  return await import("@/lib/agent-skill-visibility");
};

describe("userCanModifyAgentSkill — built-in lock integration", () => {
  const original = process.env.ALLOW_BUILTIN_SKILL_MUTATION;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.ALLOW_BUILTIN_SKILL_MUTATION;
    } else {
      process.env.ALLOW_BUILTIN_SKILL_MUTATION = original;
    }
  });

  it("locks built-ins by default for any user (incl. owner)", async () => {
    delete process.env.ALLOW_BUILTIN_SKILL_MUTATION;
    const { userCanModifyAgentSkill } = await reload();
    const skill = baseSkill({ is_system: true, owner_id: "system" });
    expect(
      userCanModifyAgentSkill(skill, { email: "alice@example.com" }),
    ).toBe(false);
    expect(
      userCanModifyAgentSkill(skill, { email: "alice@example.com", role: "admin" }),
    ).toBe(false);
  });

  it("unlocks built-ins for everyone when env flag is true", async () => {
    process.env.ALLOW_BUILTIN_SKILL_MUTATION = "true";
    const { userCanModifyAgentSkill } = await reload();
    const skill = baseSkill({ is_system: true, owner_id: "system" });
    expect(
      userCanModifyAgentSkill(skill, { email: "anyone@example.com" }),
    ).toBe(true);
  });

  it("never blocks the owner of a non-system row, regardless of env", async () => {
    delete process.env.ALLOW_BUILTIN_SKILL_MUTATION;
    const { userCanModifyAgentSkill } = await reload();
    const skill = baseSkill({ is_system: false, owner_id: "alice@example.com" });
    expect(
      userCanModifyAgentSkill(skill, { email: "alice@example.com" }),
    ).toBe(true);
  });

  // After 098-enterprise-rbac (commit 6cc3e7324) per-user ownership of
  // non-system rows is enforced by OpenFGA at the route layer
  // (`requireResourcePermission(... type: 'skill', action: 'write')`),
  // not by this helper. `userCanModifyAgentSkill` now only guards the
  // built-in `is_system: true` rows — any other user-owned skill returns
  // `true` here and the gate decides ownership upstream. This test pins
  // that new contract so a future drift back to in-helper ownership
  // doesn't go unnoticed.
  it("delegates non-system ownership checks to the upstream OpenFGA gate", async () => {
    delete process.env.ALLOW_BUILTIN_SKILL_MUTATION;
    const { userCanModifyAgentSkill } = await reload();
    const skill = baseSkill({ is_system: false, owner_id: "alice@example.com" });
    expect(
      userCanModifyAgentSkill(skill, { email: "bob@example.com" }),
    ).toBe(true);
  });
});

import {
  extractSkillAccessFromJwtRoles,
  extractTaskAccessFromJwtRoles,
} from "../../task-skill-realm-access";

describe("task/skill realm access during ReBAC transition", () => {
  it("ignores task roles once task resources are ReBAC-enforced", () => {
    expect(
      extractTaskAccessFromJwtRoles(["task_user:daily-report", "task_admin:deploy"], [
        { resource_type: "task", enforcement_status: "rebac_enforced" },
      ])
    ).toEqual({ userTaskIds: [], adminTaskIds: [], allGrantedTaskIds: [] });
  });

  it("keeps skill roles while skill resources remain role-gated", () => {
    expect(
      extractSkillAccessFromJwtRoles(["skill_user:triage", "skill_admin:publish"], [
        { resource_type: "skill", enforcement_status: "role_gated" },
      ])
    ).toEqual({
      userSkillIds: ["triage"],
      adminSkillIds: ["publish"],
      allGrantedSkillIds: ["triage", "publish"],
    });
  });
});

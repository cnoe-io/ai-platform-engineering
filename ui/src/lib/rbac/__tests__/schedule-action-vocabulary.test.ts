import { openFgaCheckRelation, openFgaRelation } from "@/lib/rbac/tuple-builders";

describe("schedule action vocabulary", () => {
  it("maps schedule -> can_schedule for checks", () => {
    expect(openFgaCheckRelation("schedule")).toBe("can_schedule");
  });
  it("maps schedule -> automator for writes", () => {
    expect(openFgaRelation("schedule")).toBe("automator");
  });
});

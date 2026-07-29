import {
  applyBhagOrder,
  moveBhagAround,
  normalizeBhagOrder,
} from "@/lib/tome/bhag-order";

describe("Tome BHAG order", () => {
  it("normalizes case, whitespace, invalid, and duplicate entries", () => {
    expect(normalizeBhagOrder([" Beta  Goal ", "alpha", "beta goal", "", 42])).toEqual([
      "beta goal",
      "alpha",
    ]);
  });

  it("applies saved positions and preserves the server order for unseen BHAGs", () => {
    const groups = [{ label: "Alpha" }, { label: "Beta" }, { label: "Gamma Goal" }];
    expect(applyBhagOrder(groups, ["gamma goal", "alpha"]).map((group) => group.label)).toEqual([
      "Gamma Goal",
      "Alpha",
      "Beta",
    ]);
  });

  it("moves a dragged BHAG before or after its drop target", () => {
    expect(moveBhagAround(["alpha", "beta", "gamma"], "gamma", "beta")).toEqual([
      "alpha",
      "gamma",
      "beta",
    ]);
    expect(moveBhagAround(["alpha", "beta", "gamma"], "alpha", "gamma", "after")).toEqual([
      "beta",
      "gamma",
      "alpha",
    ]);
  });
});

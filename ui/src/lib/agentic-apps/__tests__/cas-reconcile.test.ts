import { buildBuiltinAgenticAppCasTupleDiff } from "../cas-reconcile";

describe("built-in Agentic App CAS reconciliation", () => {
  it("grants enabled apps and revokes only the platform wildcard for disabled apps", () => {
    expect(
      buildBuiltinAgenticAppCasTupleDiff(
        new Set(["weather"]),
        ["weather", "finops"],
      ),
    ).toEqual({
      writes: expect.arrayContaining([
        {
          user: "user:*",
          relation: "user",
          object: "agentic_app:weather",
        },
      ]),
      deletes: expect.arrayContaining([
        {
          user: "user:*",
          relation: "user",
          object: "agentic_app:finops",
        },
      ]),
    });
  });

  it("does not restore global tuples for a restricted app", () => {
    const diff = buildBuiltinAgenticAppCasTupleDiff(
      new Set(["weather"]),
      ["weather"],
      new Set(["weather"]),
    );
    expect(diff.writes).toEqual([]);
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        {
          user: "user:*",
          relation: "user",
          object: "agentic_app:weather",
        },
      ]),
    );
  });
});

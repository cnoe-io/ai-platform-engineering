import {
  blindAssignments,
  candidateOrder,
  costCeilingReached,
  deterministicUuid,
} from "@/lib/tome/experiment-planning";

describe("TOME experiment planning", () => {
  it("assigns stable opaque labels and reverses execution order with the assignment", () => {
    const first = blindAssignments("experiment-example", 1);

    expect(first).toEqual(blindAssignments("experiment-example", 1));
    expect(new Set(Object.values(first))).toEqual(new Set(["candidate-x", "candidate-y"]));
    expect(candidateOrder("experiment-example", 1)[0]).toBe(
      first.a === "candidate-x" ? "a" : "b",
    );
  });

  it("creates reproducible UUID-shaped run identifiers", () => {
    const id = deterministicUuid("experiment-example:1:a");
    expect(id).toBe(deterministicUuid("experiment-example:1:a"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("stops at, but not below, the configured cost ceiling", () => {
    expect(costCeilingReached(9.99, 10)).toBe(false);
    expect(costCeilingReached(10, 10)).toBe(true);
    expect(costCeilingReached(10.01, 10)).toBe(true);
  });
});

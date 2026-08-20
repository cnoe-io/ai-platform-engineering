/** @jest-environment node */

import { resolveExperimentTerminalOutcome } from "@/lib/tome/experiment-outcome";

const complete = {
  stoppedByUser: false,
  stoppedAtCostCeiling: false,
  totalGenerations: 2,
  successfulGenerations: 2,
  generationFailures: 0,
  evaluationAttempts: 2,
  evaluationSuccesses: 2,
  evaluationFailures: 0,
};

describe("experiment terminal outcome", () => {
  it("fails a run when every judge call fails", () => {
    expect(resolveExperimentTerminalOutcome({
      ...complete,
      evaluationSuccesses: 0,
      evaluationFailures: 2,
    })).toEqual({
      status: "failed",
      error: "All 2 evaluator calls failed; candidate artifacts were preserved.",
    });
  });

  it("marks partial failures without discarding successful scores", () => {
    expect(resolveExperimentTerminalOutcome({
      ...complete,
      evaluationSuccesses: 1,
      evaluationFailures: 1,
    })).toEqual({
      status: "completed_with_errors",
      error: "0 candidate generation(s) and 1 evaluator call(s) failed.",
    });
  });

  it("keeps fully successful and deliberately stopped outcomes distinct", () => {
    expect(resolveExperimentTerminalOutcome(complete)).toEqual({ status: "completed" });
    expect(resolveExperimentTerminalOutcome({
      ...complete,
      stoppedByUser: true,
    })).toEqual({ status: "stopped_by_user" });
  });
});

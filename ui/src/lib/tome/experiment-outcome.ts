import type { ExperimentStatus } from "@/types/tome-evaluation";

interface ExperimentOutcomeInput {
  stoppedByUser: boolean;
  stoppedAtCostCeiling: boolean;
  totalGenerations: number;
  successfulGenerations: number;
  generationFailures: number;
  evaluationAttempts: number;
  evaluationSuccesses: number;
  evaluationFailures: number;
}

export interface ExperimentTerminalOutcome {
  status: Extract<
    ExperimentStatus,
    "completed" | "completed_with_errors" | "failed" | "stopped_by_user" | "stopped_cost_ceiling"
  >;
  error?: string;
}

export function resolveExperimentTerminalOutcome(
  input: ExperimentOutcomeInput,
): ExperimentTerminalOutcome {
  if (input.stoppedByUser) return { status: "stopped_by_user" };
  if (input.stoppedAtCostCeiling) return { status: "stopped_cost_ceiling" };
  if (input.successfulGenerations === 0) {
    return {
      status: "failed",
      error: `All ${input.totalGenerations} candidate generations failed.`,
    };
  }
  if (input.evaluationAttempts > 0 && input.evaluationSuccesses === 0) {
    return {
      status: "failed",
      error: `All ${input.evaluationFailures} evaluator calls failed; candidate artifacts were preserved.`,
    };
  }
  if (input.generationFailures > 0 || input.evaluationFailures > 0) {
    return {
      status: "completed_with_errors",
      error: `${input.generationFailures} candidate generation(s) and ${input.evaluationFailures} evaluator call(s) failed.`,
    };
  }
  return { status: "completed" };
}

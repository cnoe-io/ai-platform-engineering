/** Pure helpers for deterministic, reproducible experiment scheduling. */

import { createHash } from "node:crypto";

import type { ExperimentCandidate } from "@/types/tome-evaluation";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deterministicUuid(value: string): string {
  const hex = sha256(value).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

export function blindAssignments(
  experimentId: string,
  trial: number,
): Record<ExperimentCandidate, string> {
  const aFirst = Number.parseInt(
    sha256(`${experimentId}:${trial}:blind`).slice(0, 2),
    16,
  ) % 2 === 0;
  return aFirst
    ? { a: "candidate-x", b: "candidate-y" }
    : { a: "candidate-y", b: "candidate-x" };
}

export function candidateOrder(
  experimentId: string,
  trial: number,
): ExperimentCandidate[] {
  return blindAssignments(experimentId, trial).a === "candidate-x" ? ["a", "b"] : ["b", "a"];
}

export function costCeilingReached(totalCostUsd: number, ceilingUsd: number): boolean {
  return totalCostUsd >= ceilingUsd;
}

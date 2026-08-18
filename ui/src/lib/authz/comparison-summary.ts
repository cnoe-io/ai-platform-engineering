import type { UnifiedAuditEvent } from "@/lib/rbac/types";

export const PROMOTION_MINIMUM_COMPARISONS = 100;
export const PROMOTION_MAX_ERROR_RATE = 0.001;
export const PROMOTION_MAX_P99_LATENCY_MS = 100;

export interface PromotionEvidenceGate {
  id: "sample" | "semantics" | "errors" | "latency";
  label: string;
  passed: boolean;
  detail: string;
}

export interface MigrationComparisonSummary {
  comparison_count: number;
  semantic_mismatch_count: number;
  provider_error_count: number;
  provider_error_rate: number;
  latency_sample_count: number;
  p99_authz_latency_ms: number;
  latest_rollout_revision?: string;
  truncated: boolean;
  evidence_ready: boolean;
  mismatch_counts: Record<string, number>;
  authoritative_counts: Record<string, number>;
  gates: PromotionEvidenceGate[];
}

function percentile99(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.99) - 1)];
}

export function summarizeMigrationComparisons(
  records: UnifiedAuditEvent[],
  options: { total?: number; truncated?: boolean } = {},
): MigrationComparisonSummary {
  const comparisons = records.filter((event) => event.type === "authz_migration_comparison");
  const comparisonCount = options.total ?? comparisons.length;
  const mismatchCounts: Record<string, number> = {};
  const authoritativeCounts: Record<string, number> = {};
  const semanticClasses = new Set(["ALLOW_DENY", "DENY_ALLOW", "REASON_ONLY"]);
  let semanticMismatchCount = 0;
  let providerErrorCount = 0;

  for (const event of comparisons) {
    const mismatch = event.mismatch_class ?? "NONE";
    mismatchCounts[mismatch] = (mismatchCounts[mismatch] ?? 0) + 1;
    if (semanticClasses.has(mismatch)) semanticMismatchCount += 1;
    if (mismatch === "ERROR_RESULT" || event.legacy_error || event.authz_error) {
      providerErrorCount += 1;
    }
    const path = event.authoritative_path ?? "UNKNOWN";
    authoritativeCounts[path] = (authoritativeCounts[path] ?? 0) + 1;
  }

  const errorRate = comparisonCount > 0 ? providerErrorCount / comparisonCount : 0;
  const latencyValues = comparisons
    .map((event) => event.authz_duration_ms)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const p99Latency = percentile99(latencyValues);
  const latestRevision = [...comparisons]
    .sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts))
    .find((event) => event.rollout_revision)?.rollout_revision;
  const truncated = options.truncated === true;
  const gates: PromotionEvidenceGate[] = [
    {
      id: "sample",
      label: "Comparison sample",
      passed: comparisonCount >= PROMOTION_MINIMUM_COMPARISONS && !truncated,
      detail: truncated
        ? "Summary is truncated; narrow the filters before promotion."
        : `${comparisonCount} of ${PROMOTION_MINIMUM_COMPARISONS} required comparisons`,
    },
    {
      id: "semantics",
      label: "Semantic parity",
      passed: semanticMismatchCount === 0,
      detail: `${semanticMismatchCount} allow/deny or reason mismatch${semanticMismatchCount === 1 ? "" : "es"}`,
    },
    {
      id: "errors",
      label: "Provider reliability",
      passed: errorRate <= PROMOTION_MAX_ERROR_RATE,
      detail: `${(errorRate * 100).toFixed(3)}% error rate; maximum ${(PROMOTION_MAX_ERROR_RATE * 100).toFixed(3)}%`,
    },
    {
      id: "latency",
      label: "Authz latency",
      passed:
        latencyValues.length === comparisonCount &&
        !truncated &&
        p99Latency <= PROMOTION_MAX_P99_LATENCY_MS,
      detail:
        latencyValues.length !== comparisonCount || truncated
          ? `${latencyValues.length} of ${comparisonCount} comparisons include complete latency evidence`
          : `${p99Latency.toFixed(1)} ms p99; maximum ${PROMOTION_MAX_P99_LATENCY_MS} ms`,
    },
  ];

  return {
    comparison_count: comparisonCount,
    semantic_mismatch_count: semanticMismatchCount,
    provider_error_count: providerErrorCount,
    provider_error_rate: errorRate,
    latency_sample_count: latencyValues.length,
    p99_authz_latency_ms: p99Latency,
    latest_rollout_revision: latestRevision,
    truncated,
    evidence_ready: gates.every((gate) => gate.passed),
    mismatch_counts: mismatchCounts,
    authoritative_counts: authoritativeCounts,
    gates,
  };
}

import { summarizeMigrationComparisons } from "../comparison-summary";
import type { UnifiedAuditEvent } from "@/lib/rbac/types";

function comparison(overrides: Partial<UnifiedAuditEvent> = {}): UnifiedAuditEvent {
  return {
    ts: "2026-08-18T00:00:00Z",
    type: "authz_migration_comparison",
    tenant_id: "example",
    subject_hash: "not-applicable",
    action: "invoke",
    outcome: "success",
    correlation_id: "correlation-1",
    source: "caipe-authz",
    rollout_revision: "revision-1",
    authoritative_path: "LEGACY",
    mismatch_class: "NONE",
    legacy_outcome: "allow",
    legacy_reason_code: "ALLOW_RELATIONSHIP",
    legacy_duration_ms: 2,
    authz_outcome: "allow",
    authz_reason_code: "ALLOW_RELATIONSHIP",
    authz_duration_ms: 4,
    ...overrides,
  };
}

describe("summarizeMigrationComparisons", () => {
  it("marks a complete equivalent sample ready", () => {
    const records = Array.from({ length: 100 }, (_, index) => comparison({
      correlation_id: `correlation-${index}`,
      authz_duration_ms: index + 1,
    }));

    const summary = summarizeMigrationComparisons(records);

    expect(summary.evidence_ready).toBe(true);
    expect(summary.comparison_count).toBe(100);
    expect(summary.semantic_mismatch_count).toBe(0);
    expect(summary.p99_authz_latency_ms).toBe(99);
    expect(summary.authoritative_counts).toEqual({ LEGACY: 100 });
  });

  it("blocks semantic mismatch, provider error, latency, and truncated samples", () => {
    const summary = summarizeMigrationComparisons(
      [
        comparison({ mismatch_class: "ALLOW_DENY", outcome: "error" }),
        comparison({ mismatch_class: "ERROR_RESULT", authz_error: true, authz_duration_ms: 250 }),
      ],
      { total: 101, truncated: true },
    );

    expect(summary.evidence_ready).toBe(false);
    expect(summary.semantic_mismatch_count).toBe(1);
    expect(summary.provider_error_count).toBe(1);
    expect(summary.provider_error_rate).toBeCloseTo(1 / 101);
    expect(summary.gates.every((gate) => !gate.passed)).toBe(true);
  });

  it("blocks evidence when any comparison is missing authz latency", () => {
    const records = Array.from({ length: 100 }, (_, index) => comparison({
      correlation_id: `correlation-${index}`,
      authz_duration_ms: index === 99 ? undefined : 10,
    }));

    const summary = summarizeMigrationComparisons(records);

    expect(summary.latency_sample_count).toBe(99);
    expect(summary.evidence_ready).toBe(false);
    expect(summary.gates.find((gate) => gate.id === "latency")).toMatchObject({
      passed: false,
      detail: "99 of 100 comparisons include complete latency evidence",
    });
  });
});

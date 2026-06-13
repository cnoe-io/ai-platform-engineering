// assisted-by Cursor:composer-2.5
//
// CAS-backed OpenFGA tuple reconciliation (PAP batch writes). Routes tuple
// diffs through the CAS module so graph mutations invalidate the decision
// cache and emit durable audit events — instead of calling openfga.ts directly.

import {
  writeOpenFgaTupleDiff,
  type OpenFgaReconcileResult,
  type TeamResourceTupleDiff,
} from "@/lib/rbac/openfga";

import { emitReconcileAudit } from "./audit";
import type { DecisionContext, Subject } from "./contract";
import { invalidateDecisionCache } from "./engines/openfga";

export interface TupleReconcileContext extends DecisionContext {
  /** Who triggered the reconcile (for audit). */
  caller?: Subject;
  /** Short label for the audit tab (e.g. mcp_server_create, team_resources). */
  source?: string;
}

/**
 * Apply an OpenFGA tuple diff through CAS: write to the PDP, invalidate cached
 * decisions, and record a `cas_reconcile` audit event.
 */
export async function reconcileTupleDiff(
  diff: TeamResourceTupleDiff,
  ctx: TupleReconcileContext = {},
): Promise<OpenFgaReconcileResult> {
  try {
    const result = await writeOpenFgaTupleDiff(diff);
    if (result.enabled && (result.writes > 0 || result.deletes > 0)) {
      invalidateDecisionCache();
    }
    emitReconcileAudit(diff, result, ctx);
    return result;
  } catch (error) {
    emitReconcileAudit(diff, { enabled: true, writes: 0, deletes: 0 }, ctx, {
      outcome: "error",
      reasonCode: error instanceof Error ? error.message : "PDP_WRITE_FAILED",
    });
    throw error;
  }
}

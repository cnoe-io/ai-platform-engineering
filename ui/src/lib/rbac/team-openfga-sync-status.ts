/**
 * Compute the OpenFGA sync status for every member of a team.
 *
 * Three independent data layers describe team membership:
 *
 *   1. Mongo `teams.members[]`         — what the admin UI shows in the
 *                                        Members tab. Source of truth for
 *                                        intent.
 *   2. Mongo `team_membership_sources` — provenance: who granted what, from
 *                                        which identity provider, and the
 *                                        resolved Keycloak `user_subject`.
 *   3. OpenFGA tuples                  — `user:<sub>#{member,admin} team:<slug>`.
 *                                        Source of truth for runtime
 *                                        authorization.
 *
 * Healthy state: for every active source row with a `user_subject` and a
 * `relationship`, OpenFGA must contain a matching tuple. This module
 * reports four sync states per member so an admin can see at a glance
 * whether their team is fully authorized and, if not, why.
 *
 *   - synced   : Source row has user_subject + relationship AND OpenFGA has
 *                the matching tuple.
 *   - pending  : Source row exists but has no user_subject yet (e.g. user
 *                hasn't logged in to Keycloak; the JIT path will fill it in).
 *                Cannot resolve to a runtime OpenFGA tuple by definition.
 *   - drifted  : Source row has user_subject + relationship but OpenFGA is
 *                missing the matching tuple. Run reconcile to repair.
 *   - unknown  : The OpenFGA read failed or the store is not configured.
 *                The admin should not infer drift from this — it just means
 *                we don't know.
 *
 * The helper is intentionally a pure function: it takes the three layers
 * as plain data and emits a structured report. The caller (the BFF route)
 * is responsible for actually reading from Mongo / OpenFGA.
 */

import {
type OpenFgaTupleKey,
isOpenFgaConfigured,
readOpenFgaTuples,
} from "@/lib/rbac/openfga";
import type { TeamMemberRelation } from "@/lib/rbac/team-membership-sync";
import type { TeamMembershipSource } from "@/types/identity-group-sync";

export type TeamMembershipSyncState =
  | "synced"
  | "pending"
  | "drifted"
  | "unknown";

/**
 * Per-source-row diagnostic. The UI keys badges by `source_signature` so
 * the same user appearing through multiple identity sources (manual +
 * Okta group, for example) shows up as separate rows.
 */
export interface TeamMembershipSyncEntry {
  source_signature: string;
  user_email: string;
  user_subject?: string;
  relationship: TeamMemberRelation;
  source_type: TeamMembershipSource["source_type"];
  status: TeamMembershipSyncState;
  /** Human-readable explanation, suitable for tooltips and audit logs. */
  reason: string;
  /** The OpenFGA tuple we expected to find. Always populated for status calculations even when missing. */
  expected_tuple: OpenFgaTupleKey | null;
}

export interface TeamMembershipSyncSummary {
  /** Total number of source rows considered. */
  total: number;
  synced: number;
  pending: number;
  drifted: number;
  unknown: number;
  /**
   * `true` when there is at least one drift OR unknown row.
   * The UI uses this to colour the banner.
   */
  needs_attention: boolean;
  /**
   * `true` when the OpenFGA read failed or the store is not configured.
   * Distinct from `needs_attention` because the admin cannot fix it by
   * clicking Reconcile.
   */
  openfga_available: boolean;
}

export interface TeamMembershipSyncReport {
  team_slug: string;
  entries: TeamMembershipSyncEntry[];
  summary: TeamMembershipSyncSummary;
}

export interface ComputeTeamMembershipSyncInput {
  teamSlug: string;
  sources: TeamMembershipSource[];
  /**
   * Tuples currently stored on `team:<slug>` (all relations). Pass `null`
   * when the OpenFGA read failed or the store is unconfigured — every
   * eligible row will be reported as `unknown` rather than `drifted`.
   */
  tuples: OpenFgaTupleKey[] | null;
}

function sourceSignature(source: TeamMembershipSource): string {
  // Stable, dedupe-safe identifier — matches the key the reconciler uses.
  return [
    source.team_slug,
    source.user_subject ?? source.user_email ?? "",
    source.relationship,
    source.source_type,
    source.provider_id ?? "",
    source.external_group_id ?? "",
    source.sync_rule_id ?? "",
  ].join("|");
}

/**
 * Compute the sync report for a team. Pure — no I/O.
 */
export function computeTeamMembershipSyncReport(
  input: ComputeTeamMembershipSyncInput,
): TeamMembershipSyncReport {
  const openFgaAvailable = input.tuples !== null;
  // Pre-index tuples by `user:<sub>#<relation>` for O(1) lookup. We do
  // NOT match by email — OpenFGA stores subjects, never emails.
  const tupleIndex = new Set<string>();
  if (input.tuples) {
    for (const tuple of input.tuples) {
      tupleIndex.add(`${tuple.user}\n${tuple.relation}\n${tuple.object}`);
    }
  }

  const activeSources = input.sources.filter((s) => s.status === "active");

  const entries: TeamMembershipSyncEntry[] = activeSources.map((source) => {
    const relationship = source.relationship as TeamMemberRelation;
    const expectedTuple: OpenFgaTupleKey | null = source.user_subject
      ? {
          user: `user:${source.user_subject}`,
          relation: relationship,
          object: `team:${input.teamSlug}`,
        }
      : null;

    // 1) No subject resolved yet — we cannot have written a tuple. PENDING.
    if (!source.user_subject) {
      return {
        source_signature: sourceSignature(source),
        user_email: source.user_email ?? "",
        user_subject: undefined,
        relationship,
        source_type: source.source_type,
        status: "pending",
        reason:
          "Keycloak subject not yet resolved for this email. Reconcile after the user signs in or after Keycloak admin re-sync.",
        expected_tuple: null,
      };
    }

    // 2) OpenFGA unreachable / unconfigured — we cannot judge presence. UNKNOWN.
    if (!openFgaAvailable) {
      return {
        source_signature: sourceSignature(source),
        user_email: source.user_email ?? "",
        user_subject: source.user_subject,
        relationship,
        source_type: source.source_type,
        status: "unknown",
        reason:
          "OpenFGA was not reachable when computing this status. Try again, or check OpenFGA health in Security & Policy.",
        expected_tuple: expectedTuple,
      };
    }

    // 3) Subject resolved AND OpenFGA available — match by tuple presence.
    const key = `${expectedTuple!.user}\n${expectedTuple!.relation}\n${expectedTuple!.object}`;
    if (tupleIndex.has(key)) {
      return {
        source_signature: sourceSignature(source),
        user_email: source.user_email ?? "",
        user_subject: source.user_subject,
        relationship,
        source_type: source.source_type,
        status: "synced",
        reason: `OpenFGA tuple user:${source.user_subject} #${relationship} team:${input.teamSlug} is present.`,
        expected_tuple: expectedTuple,
      };
    }

    // 4) Subject resolved, OpenFGA available, tuple missing — DRIFTED.
    return {
      source_signature: sourceSignature(source),
      user_email: source.user_email ?? "",
      user_subject: source.user_subject,
      relationship,
      source_type: source.source_type,
      status: "drifted",
      reason: `Expected OpenFGA tuple user:${source.user_subject} #${relationship} team:${input.teamSlug} is missing. Click Reconcile to repair.`,
      expected_tuple: expectedTuple,
    };
  });

  const summary: TeamMembershipSyncSummary = {
    total: entries.length,
    synced: entries.filter((e) => e.status === "synced").length,
    pending: entries.filter((e) => e.status === "pending").length,
    drifted: entries.filter((e) => e.status === "drifted").length,
    unknown: entries.filter((e) => e.status === "unknown").length,
    needs_attention: false,
    openfga_available: openFgaAvailable,
  };
  summary.needs_attention = summary.drifted > 0 || summary.unknown > 0;

  return {
    team_slug: input.teamSlug,
    entries,
    summary,
  };
}

/**
 * Best-effort read of all OpenFGA tuples whose object is `team:<slug>`.
 *
 * Returns `null` when:
 *   - OpenFGA is not configured for this environment, OR
 *   - the read failed (network error, store down, etc.)
 *
 * Callers should treat `null` as "unknown" and surface that to the admin
 * rather than silently treating it as "no tuples exist" (which would
 * misclassify everything as drifted).
 */
export async function readTeamOpenFgaTuples(
  teamSlug: string,
): Promise<OpenFgaTupleKey[] | null> {
  if (!isOpenFgaConfigured()) {
    return null;
  }

  const object = `team:${teamSlug}`;
  const collected: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;

  try {
    // OpenFGA returns one page at a time. We bound the loop conservatively
    // (10 pages * 100 = 1000 tuples) to avoid runaway reads for a single
    // pathological team. In practice a team has tens of tuples at most.
    for (let i = 0; i < 10; i += 1) {

      const page = await readOpenFgaTuples({
        tuple: { object },
        pageSize: 100,
        continuationToken,
      });
      for (const tuple of page.tuples) {
        collected.push(tuple.key);
      }
      if (!page.continuationToken) {
        break;
      }
      continuationToken = page.continuationToken;
    }
  } catch (err) {
    console.warn(
      `[TeamSyncStatus] OpenFGA read for team:${teamSlug} failed; reporting unknown state:`,
      err,
    );
    return null;
  }

  return collected;
}

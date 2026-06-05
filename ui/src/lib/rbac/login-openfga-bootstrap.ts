import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import {
  effectiveBaselineBootstrapTuples,
  getBaselineFgaProfileBundle,
  type TeamBaselineProfileOverride,
} from "@/lib/rbac/baseline-access";
import { getCollection } from "@/lib/mongodb";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import type { TeamMembershipSource } from "@/types/identity-group-sync";

export type LoginOpenFgaBootstrapStatus = "skipped" | "completed" | "failed";

export interface LoginOpenFgaBootstrapResult {
  status: LoginOpenFgaBootstrapStatus;
  tuple_write_count: number;
  warning?: string;
}

export interface LoginOpenFgaBootstrapInput {
  subject?: string;
  email?: string;
  isAuthorized: boolean;
  isAdmin: boolean;
}

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

function normalizeDefaultAgentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && OPENFGA_ID_PATTERN.test(trimmed) ? trimmed : null;
}

async function defaultAgentTuple(): Promise<OpenFgaTupleKey[]> {
  try {
    const config = await getCollection<{ default_agent_id?: unknown }>("platform_config");
    const doc = await config.findOne({ _id: "platform_settings" } as never);
    const defaultAgentId =
      normalizeDefaultAgentId(doc?.default_agent_id) ?? normalizeDefaultAgentId(process.env.DEFAULT_AGENT_ID);
    return defaultAgentId ? [{ user: "user:*", relation: "user", object: `agent:${defaultAgentId}` }] : [];
  } catch {
    const defaultAgentId = normalizeDefaultAgentId(process.env.DEFAULT_AGENT_ID);
    return defaultAgentId ? [{ user: "user:*", relation: "user", object: `agent:${defaultAgentId}` }] : [];
  }
}

interface TeamDoc {
  slug?: string;
  name?: string;
  baseline_profile_overrides?: {
    member_profile_id?: string;
    admin_profile_id?: string;
  };
}

/**
 * Build the per-team baseline-profile overrides for a logging-in user.
 *
 * Pre-2026-05-26 this iterated every team in Mongo and read
 * `team.members[]` to find the user. That code path was the second-to-
 * last reader of the embedded array (see
 * docs/docs/specs/2026-05-26-canonical-team-membership/).
 *
 * Now: query the canonical `team_membership_sources` collection by
 * the user's email/subject to get the candidate team slugs in one
 * round-trip, then fetch only those team docs (so we still have
 * baseline_profile_overrides metadata, which is *not* in the source
 * store — that lives on the team doc itself).
 *
 * Role normalization: the source store uses `"member" | "admin"`. The
 * legacy embedded array also had `"owner"`, which the consumer
 * (effectiveBaselineBootstrapTuples) treats identically to `"admin"`.
 * Collapsing them is behavior-preserving.
 */
async function teamOverridesForLogin(email: string | undefined): Promise<TeamBaselineProfileOverride[]> {
  if (!email) return [];
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return [];

    const sources = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
    const rows = await sources
      .find({ status: "active", user_email: normalizedEmail })
      .toArray();
    if (rows.length === 0) return [];

    // Dedupe by team_slug; escalate role to admin if any active row has admin.
    const byTeam = new Map<string, "member" | "admin">();
    for (const row of rows) {
      if (!row.team_slug) continue;
      const current = byTeam.get(row.team_slug);
      if (current === "admin") continue;
      byTeam.set(row.team_slug, row.relationship === "admin" ? "admin" : "member");
    }
    if (byTeam.size === 0) return [];

    const teams = await getCollection<TeamDoc>("teams");
    const teamDocs = await teams.find({ slug: { $in: Array.from(byTeam.keys()) } }).toArray();

    const overrides: TeamBaselineProfileOverride[] = [];
    for (const team of teamDocs) {
      if (!team.slug) continue;
      const role = byTeam.get(team.slug);
      if (!role) continue;
      const memberProfileId = team.baseline_profile_overrides?.member_profile_id;
      const adminProfileId = team.baseline_profile_overrides?.admin_profile_id;
      if (!memberProfileId && !adminProfileId) continue;
      overrides.push({
        team_slug: team.slug,
        team_name: team.name,
        role,
        member_profile_id: memberProfileId,
        admin_profile_id: adminProfileId,
      });
    }
    return overrides;
  } catch {
    return [];
  }
}

export async function reconcileLoginOpenFgaAccess(
  input: LoginOpenFgaBootstrapInput
): Promise<LoginOpenFgaBootstrapResult> {
  const subject = input.subject?.trim();
  if (!input.isAuthorized || !subject) {
    return { status: "skipped", tuple_write_count: 0 };
  }

  const bundle = await getBaselineFgaProfileBundle();
  const writes = effectiveBaselineBootstrapTuples({
    subject,
    isAdmin: input.isAdmin,
    bundle,
    teamOverrides: await teamOverridesForLogin(input.email),
  });
  writes.push(...(await defaultAgentTuple()));

  try {
    const result = await writeOpenFgaTuples({ writes, deletes: [] });
    return { status: "completed", tuple_write_count: result.writes };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    console.warn(
      `[LoginOpenFGA] Failed to bootstrap OpenFGA access for ${input.email ?? subject}: ${warning}`
    );
    return { status: "failed", tuple_write_count: 0, warning };
  }
}

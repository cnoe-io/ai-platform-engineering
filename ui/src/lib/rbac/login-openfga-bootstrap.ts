import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import {
  effectiveBaselineBootstrapTuples,
  getBaselineFgaProfileBundle,
  type TeamBaselineProfileOverride,
} from "@/lib/rbac/baseline-access";
import { getCollection } from "@/lib/mongodb";

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
  members?: Array<{ user_id?: string; role?: string }>;
  baseline_profile_overrides?: {
    member_profile_id?: string;
    admin_profile_id?: string;
  };
}

async function teamOverridesForLogin(email: string | undefined): Promise<TeamBaselineProfileOverride[]> {
  if (!email) return [];
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const teams = await getCollection<TeamDoc>("teams");
    const rows = await teams.find({}).toArray();
    const overrides: TeamBaselineProfileOverride[] = [];
    for (const team of rows) {
      const member = team.members?.find((row) => row.user_id?.trim().toLowerCase() === normalizedEmail);
      if (!member || !team.slug) continue;
      const memberProfileId = team.baseline_profile_overrides?.member_profile_id;
      const adminProfileId = team.baseline_profile_overrides?.admin_profile_id;
      if (!memberProfileId && !adminProfileId) continue;
      overrides.push({
        team_slug: team.slug,
        team_name: team.name,
        role: member.role === "owner" || member.role === "admin" ? member.role : "member",
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

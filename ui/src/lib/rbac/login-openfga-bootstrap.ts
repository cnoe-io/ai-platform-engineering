import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import {
  baselineAdminTuples,
  baselineMemberTuples,
  getBaselineFgaProfile,
  type BaselineFgaProfile,
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

function baselineTuples(subject: string, profile: BaselineFgaProfile): OpenFgaTupleKey[] {
  return baselineMemberTuples(subject, profile);
}

function adminTuples(subject: string, profile: BaselineFgaProfile): OpenFgaTupleKey[] {
  return baselineAdminTuples(subject, profile);
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

export async function reconcileLoginOpenFgaAccess(
  input: LoginOpenFgaBootstrapInput
): Promise<LoginOpenFgaBootstrapResult> {
  const subject = input.subject?.trim();
  if (!input.isAuthorized || !subject) {
    return { status: "skipped", tuple_write_count: 0 };
  }

  const profile = await getBaselineFgaProfile();
  const writes = input.isAdmin
    ? [...baselineTuples(subject, profile), ...adminTuples(subject, profile)]
    : baselineTuples(subject, profile);
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

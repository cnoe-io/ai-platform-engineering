import { ensureUserByEmail } from "@/lib/rbac/keycloak-admin";
import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { baselineBootstrapTuples } from "@/lib/rbac/baseline-access";

export type BootstrapAdminOutcomeStatus = "existing" | "created" | "failed";

export interface BootstrapAdminOutcome {
  email: string;
  status: BootstrapAdminOutcomeStatus;
  user_id?: string;
  tuple_write_count: number;
  error?: string;
}

export interface BootstrapAdminReconciliationResult {
  enabled: boolean;
  actor: string;
  configured_emails: string[];
  resolved_count: number;
  created_count: number;
  failed_count: number;
  tuple_write_count: number;
  warnings: string[];
  outcomes: BootstrapAdminOutcome[];
}

interface ReconcileBootstrapAdminsInput {
  actor: string;
}

function configuredBootstrapEmails(): string[] {
  const raw =
    process.env.RBAC_BOOTSTRAP_ADMIN_EMAILS?.trim() ||
    process.env.BOOTSTRAP_ADMIN_EMAILS?.trim() ||
    "";
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

function bootstrapTuples(userId: string): OpenFgaTupleKey[] {
  return baselineBootstrapTuples(userId, true);
}

export async function reconcileBootstrapAdmins(
  input: ReconcileBootstrapAdminsInput
): Promise<BootstrapAdminReconciliationResult> {
  const actor = input.actor.trim() || "unknown";
  const emails = configuredBootstrapEmails();
  if (emails.length === 0) {
    return {
      enabled: false,
      actor,
      configured_emails: [],
      resolved_count: 0,
      created_count: 0,
      failed_count: 0,
      tuple_write_count: 0,
      warnings: [],
      outcomes: [],
    };
  }

  const outcomes: BootstrapAdminOutcome[] = [];
  const warnings: string[] = [];
  let tupleWriteCount = 0;

  for (const email of emails) {
    let userId: string | undefined;
    try {
      const user = await ensureUserByEmail(email);
      userId = user.id;
      const result = await writeOpenFgaTuples({ writes: bootstrapTuples(userId), deletes: [] });
      if (!result.enabled) {
        throw new Error("OpenFGA is not configured; bootstrap admin tuples were not written");
      }
      tupleWriteCount += result.writes;
      outcomes.push({
        email,
        user_id: userId,
        status: user.created ? "created" : "existing",
        tuple_write_count: result.writes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${email}: ${message}`);
      outcomes.push({
        email,
        user_id: userId,
        status: "failed",
        tuple_write_count: 0,
        error: message,
      });
    }
  }

  return {
    enabled: true,
    actor,
    configured_emails: emails,
    resolved_count: outcomes.filter((outcome) => outcome.user_id && outcome.status !== "failed").length,
    created_count: outcomes.filter((outcome) => outcome.status === "created").length,
    failed_count: outcomes.filter((outcome) => outcome.status === "failed").length,
    tuple_write_count: tupleWriteCount,
    warnings,
    outcomes,
  };
}

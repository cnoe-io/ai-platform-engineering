/**
 * Audit log assertion helpers (TypeScript side) — spec 102 T018.
 *
 * Audit storage is owned by audit-service. These helpers query the service
 * API instead of tailing MongoDB collections.
 */

import { createHash } from "crypto";

export const REQUIRED_REASONS = new Set([
  "OK",
  "OK_ROLE_FALLBACK",
  "OK_BOOTSTRAP_ADMIN",
  "DENY_NO_CAPABILITY",
  "DENY_PDP_UNAVAILABLE",
  "DENY_INVALID_TOKEN",
  "DENY_RESOURCE_UNKNOWN",
] as const);

export type AuditReason =
  | "OK"
  | "OK_ROLE_FALLBACK"
  | "OK_BOOTSTRAP_ADMIN"
  | "DENY_NO_CAPABILITY"
  | "DENY_PDP_UNAVAILABLE"
  | "DENY_INVALID_TOKEN"
  | "DENY_RESOURCE_UNKNOWN";

export interface AuditRecord {
  audit_event_id?: string;
  userId?: string;
  userEmail?: string;
  user_email?: string;
  subject_hash?: string;
  resource?: string;
  scope?: string;
  action?: string;
  capability?: string;
  allowed?: boolean;
  outcome?: "allow" | "deny" | "success" | "error";
  reason?: AuditReason;
  reason_code?: AuditReason;
  source: string;
  service?: string;
  route?: string;
  requestId?: string;
  pdp?: "keycloak" | "local" | "cache" | "openfga";
  ts: Date | string;
}

function auditServiceUrl(): string {
  return (process.env.AUDIT_SERVICE_URL ?? process.env.E2E_AUDIT_SERVICE_URL ?? "http://localhost:8010").replace(
    /\/$/,
    "",
  );
}

function subjectHash(sub: string): string {
  // assisted-by Codex Codex-sonnet-4-6
  const salt = process.env.AUDIT_SUBJECT_SALT ?? "caipe-098-audit";
  return `sha256:${createHash("sha256").update(`${salt}:${sub}`).digest("hex")}`;
}

async function queryAuditRecords(params: Record<string, string>, limit = 50): Promise<AuditRecord[]> {
  const url = new URL(`${auditServiceUrl()}/v1/audit/events`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("since", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`audit-service query failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { records?: AuditRecord[] };
  return body.records ?? [];
}

export interface AssertOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function assertAuditRecord(
  userId: string,
  resource: string,
  scope: string,
  allowed: boolean,
  reason: AuditReason,
  opts: AssertOptions = {},
): Promise<AuditRecord> {
  if (!REQUIRED_REASONS.has(reason)) {
    throw new Error(`reason ${reason} not in canonical enum`);
  }
  const timeoutMs = opts.timeoutMs ?? 5000;
  const pollIntervalMs = opts.pollIntervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let lastSeen: AuditRecord | null = null;
  const action = `${resource}#${scope}`;
  const outcome = allowed ? "allow" : "deny";

  while (Date.now() < deadline) {
    const records = await queryAuditRecords({
      subject_hash: subjectHash(userId),
      action,
      outcome,
      reason_code: reason,
    });
    lastSeen = records[0] ?? lastSeen;
    const match = records.find(
      (record) =>
        (record.action ?? record.capability) === action &&
        record.outcome === outcome &&
        record.reason_code === reason,
    );
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `no matching audit record within ${timeoutMs}ms — looked for ` +
      `userId=${userId}, resource=${resource}, scope=${scope}, ` +
      `allowed=${allowed}, reason=${reason}; last seen=${JSON.stringify(lastSeen)}`,
  );
}

export async function clearAuditLog(): Promise<number> {
  // Audit-service storage is append-only from the test client's perspective.
  return 0;
}

export async function latestAuditRecordFor(userId: string): Promise<AuditRecord | null> {
  const records = await queryAuditRecords({ subject_hash: subjectHash(userId) }, 1);
  return records[0] ?? null;
}

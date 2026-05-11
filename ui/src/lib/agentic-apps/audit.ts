// assisted-by Codex Codex-sonnet-4-6

import type { AgenticAppAuditEventRecord } from "@/types/agentic-app";
import { getCollection } from "@/lib/mongodb";
import { AGENTIC_APP_EVENTS_COLLECTION } from "@/lib/agentic-apps/store";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERNS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "signature",
  "providerpayload",
];

export type BuildAgenticAppAuditEventInput = Omit<
  AgenticAppAuditEventRecord,
  "createdAt" | "payload"
> & {
  payload?: Record<string, unknown>;
};

function isSensitiveAuditKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function redactAgenticAppAuditPayload(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactAgenticAppAuditPayload(entry));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSensitiveAuditKey(key)
      ? REDACTED
      : redactAgenticAppAuditPayload(nestedValue);
  }
  return redacted;
}

export function buildAgenticAppAuditEvent(
  input: BuildAgenticAppAuditEventInput,
): AgenticAppAuditEventRecord {
  return {
    createdAt: new Date().toISOString(),
    type: input.type,
    ...(input.actorEmail !== undefined ? { actorEmail: input.actorEmail } : {}),
    ...(input.actorSubjectHash !== undefined ? { actorSubjectHash: input.actorSubjectHash } : {}),
    ...(input.appId !== undefined ? { appId: input.appId } : {}),
    ...(input.packageId !== undefined ? { packageId: input.packageId } : {}),
    ...(input.decisionId !== undefined ? { decisionId: input.decisionId } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
    ...(input.payload !== undefined
      ? { payload: redactAgenticAppAuditPayload(input.payload) as Record<string, unknown> }
      : {}),
  };
}

export function buildAssistantContextAuditEvent(input: {
  appId: string;
  outcome: "accepted" | "rejected" | "ignored";
  reasonCode?: string;
  contextId?: string;
  route?: string;
  payloadSizeBytes?: number;
}): AgenticAppAuditEventRecord {
  return buildAgenticAppAuditEvent({
    type: `agentic_app.assistant_context.${input.outcome}`,
    appId: input.appId,
    outcome: input.outcome,
    ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
    payload: {
      ...(input.contextId !== undefined ? { contextId: input.contextId } : {}),
      ...(input.route !== undefined ? { route: input.route } : {}),
      ...(input.payloadSizeBytes !== undefined ? { payloadSizeBytes: input.payloadSizeBytes } : {}),
    },
  });
}

export type QueryAgenticAppAuditEventsInput = {
  appId?: string;
  decisionId?: string;
  correlationId?: string;
  reasonCode?: string;
  type?: string;
  limit?: number;
};

export async function queryAgenticAppAuditEvents(
  input: QueryAgenticAppAuditEventsInput = {},
): Promise<AgenticAppAuditEventRecord[]> {
  const filter: Record<string, string> = {};
  for (const key of ["appId", "decisionId", "correlationId", "reasonCode", "type"] as const) {
    if (typeof input[key] === "string" && input[key]) {
      filter[key] = input[key];
    }
  }
  const col = await getCollection<AgenticAppAuditEventRecord>(AGENTIC_APP_EVENTS_COLLECTION);
  return col.find(filter).sort({ createdAt: -1 }).limit(Math.min(input.limit ?? 50, 200)).toArray();
}

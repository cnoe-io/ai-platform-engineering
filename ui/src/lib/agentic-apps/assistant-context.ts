// assisted-by Codex Codex-sonnet-4-6

import type { AgenticAppAssistantContextRecord } from "@/types/agentic-app";

export const ASSISTANT_CONTEXT_MESSAGE_TYPE = "caipe.agenticApp.context.v1";
export const ASSISTANT_CONTEXT_SCHEMA_VERSION = "1.0";
export const DEFAULT_ASSISTANT_CONTEXT_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_ASSISTANT_CONTEXT_MAX_BYTES = 16 * 1024;

export type AgenticAppAssistantBridgeMessage = {
  type: typeof ASSISTANT_CONTEXT_MESSAGE_TYPE;
  version: typeof ASSISTANT_CONTEXT_SCHEMA_VERSION;
  appId: string;
  context: {
    route: string;
    title?: string;
    summary?: string;
    selection?: string;
    resourceRefs?: Array<Record<string, string>>;
    suggestedPrompts?: string[];
  };
};

export type AssistantContextValidationInput = {
  message: unknown;
  appId: string;
  origin?: string;
  expectedOrigin?: string;
  source?: MessageEventSource | null;
  expectedSource?: MessageEventSource | null;
  maxBytes?: number;
  ttlMs?: number;
  now?: Date;
};

export type AssistantContextValidationResult =
  | { ok: true; record: AgenticAppAssistantContextRecord; clientContext: Record<string, unknown> }
  | { ok: false; reasonCode: string };

const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|cookie|password|secret|token)/i;
const SECRET_VALUE_PATTERN = /(bearer\s+[a-z0-9._-]+|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.)/i;

export function validateAssistantContextMessage(
  input: AssistantContextValidationInput,
): AssistantContextValidationResult {
  if (input.expectedOrigin && input.origin && input.expectedOrigin !== input.origin) {
    return { ok: false, reasonCode: "invalid_origin" };
  }
  if (input.expectedSource && input.source && input.expectedSource !== input.source) {
    return { ok: false, reasonCode: "invalid_source" };
  }
  if (!isRecord(input.message)) {
    return { ok: false, reasonCode: "invalid_message" };
  }
  if (input.message.type !== ASSISTANT_CONTEXT_MESSAGE_TYPE) {
    return { ok: false, reasonCode: "invalid_type" };
  }
  if (input.message.version !== ASSISTANT_CONTEXT_SCHEMA_VERSION) {
    return { ok: false, reasonCode: "unsupported_version" };
  }
  if (input.message.appId !== input.appId) {
    return { ok: false, reasonCode: "app_mismatch" };
  }
  if (!isRecord(input.message.context)) {
    return { ok: false, reasonCode: "invalid_context" };
  }

  const context = input.message.context;
  if (typeof context.route !== "string" || !context.route.startsWith("/")) {
    return { ok: false, reasonCode: "invalid_route" };
  }
  for (const key of ["title", "summary", "selection"] as const) {
    if (context[key] !== undefined && typeof context[key] !== "string") {
      return { ok: false, reasonCode: `invalid_${key}` };
    }
  }
  if (
    context.suggestedPrompts !== undefined &&
    (!Array.isArray(context.suggestedPrompts) ||
      !context.suggestedPrompts.every((entry) => typeof entry === "string"))
  ) {
    return { ok: false, reasonCode: "invalid_suggested_prompts" };
  }
  if (
    context.resourceRefs !== undefined &&
    (!Array.isArray(context.resourceRefs) ||
      !context.resourceRefs.every((entry) =>
        isRecord(entry) && Object.values(entry).every((value) => typeof value === "string"),
      ))
  ) {
    return { ok: false, reasonCode: "invalid_resource_refs" };
  }

  const payloadSizeBytes = byteLength(input.message);
  if (payloadSizeBytes > (input.maxBytes ?? DEFAULT_ASSISTANT_CONTEXT_MAX_BYTES)) {
    return { ok: false, reasonCode: "payload_too_large" };
  }
  if (containsSecretLikeValue(input.message)) {
    return { ok: false, reasonCode: "secret_like_context" };
  }

  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_ASSISTANT_CONTEXT_TTL_MS;
  const record: AgenticAppAssistantContextRecord = {
    contextId: createContextId(),
    appId: input.appId,
    sessionId: "browser-session",
    schemaVersion: ASSISTANT_CONTEXT_SCHEMA_VERSION,
    route: context.route,
    payloadSizeBytes,
    validationStatus: "accepted",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    ...(typeof context.title === "string" ? { title: context.title.slice(0, 240) } : {}),
    ...(typeof context.summary === "string" ? { summary: context.summary.slice(0, 4096) } : {}),
    ...(typeof context.selection === "string" ? { selection: context.selection.slice(0, 2048) } : {}),
    ...(Array.isArray(context.resourceRefs) ? { resourceRefs: context.resourceRefs.slice(0, 20) } : {}),
    ...(Array.isArray(context.suggestedPrompts)
      ? { suggestedPrompts: context.suggestedPrompts.slice(0, 8) }
      : {}),
  };

  return { ok: true, record, clientContext: buildAssistantClientContext(record) };
}

export function buildAssistantClientContext(
  record: AgenticAppAssistantContextRecord | null,
): Record<string, unknown> | undefined {
  if (!record) {
    return undefined;
  }
  return {
    source: "agentic_app_context",
    trust: "untrusted_user_visible_data",
    appId: record.appId,
    route: record.route,
    title: record.title,
    summary: record.summary,
    selection: record.selection,
    resourceRefs: record.resourceRefs,
    contextId: record.contextId,
    expiresAt: record.expiresAt,
  };
}

export function createRejectedAssistantContextRecord(input: {
  appId: string;
  reasonCode: string;
  route?: string;
  now?: Date;
}): AgenticAppAssistantContextRecord {
  const now = input.now ?? new Date();
  return {
    contextId: createContextId(),
    appId: input.appId,
    sessionId: "browser-session",
    schemaVersion: ASSISTANT_CONTEXT_SCHEMA_VERSION,
    route: input.route ?? "/",
    payloadSizeBytes: 0,
    validationStatus: "rejected",
    createdAt: now.toISOString(),
    expiresAt: now.toISOString(),
    reasonCode: input.reasonCode,
  };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function containsSecretLikeValue(value: unknown, keyPath = ""): boolean {
  if (isRecord(value)) {
    return Object.entries(value).some(([key, entry]) => {
      if (SECRET_KEY_PATTERN.test(key)) {
        return true;
      }
      return containsSecretLikeValue(entry, keyPath ? `${keyPath}.${key}` : key);
    });
  }
  if (Array.isArray(value)) {
    return value.some((entry, index) => containsSecretLikeValue(entry, `${keyPath}.${index}`));
  }
  return typeof value === "string" && SECRET_VALUE_PATTERN.test(value);
}

function createContextId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ctx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { AuthorizeRequest, AuthorizeResult } from "./contract";

export type EvaluationPurpose = "authoritative" | "shadow";

export interface TimedAuthorizeResult {
  result: AuthorizeResult;
  durationMs: number;
  error: boolean;
}

interface CanonicalResult {
  allowed: boolean;
  reason_code: string;
  duration_ms: number;
}

function serviceUrl(): string {
  return (process.env.AUTHZ_SERVICE_URL ?? "http://caipe-authz:8090").replace(/\/+$/, "");
}

function mapResult(value: CanonicalResult): AuthorizeResult {
  if (value.allowed) {
    return { decision: "ALLOW", reason: "OK", retriable: false, via: "caipe-authz" };
  }
  if (value.reason_code === "DENY_NO_RELATIONSHIP") {
    return { decision: "DENY", reason: "NO_CAPABILITY", retriable: false, via: "caipe-authz" };
  }
  if (value.reason_code === "DENY_INVALID_REQUEST") {
    return { decision: "DENY", reason: "INVALID_REQUEST", retriable: false, via: "caipe-authz" };
  }
  return { decision: "DENY", reason: "AUTHZ_UNAVAILABLE", retriable: true, via: "caipe-authz" };
}

function headers(req: AuthorizeRequest, purpose: EvaluationPurpose): Record<string, string> {
  const token = process.env.AUTHZ_SERVICE_TOKEN?.trim();
  return {
    "content-type": "application/json",
    "x-caipe-subject-type": req.subject.type,
    "x-caipe-subject-id": req.subject.id,
    "x-caipe-evaluation-purpose": purpose,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function body(req: AuthorizeRequest): Record<string, unknown> {
  return {
    surface: "bff",
    subject: req.subject,
    action: req.action,
    resource: req.resource,
    context: {
      advisory: req.context ?? {},
      request: {},
      resource: {},
      identity: {},
    },
  };
}

export async function checkAuthz(
  req: AuthorizeRequest,
  purpose: EvaluationPurpose,
  timeoutMs = Number(process.env.AUTHZ_HTTP_TIMEOUT_MS ?? 500),
): Promise<TimedAuthorizeResult> {
  const started = performance.now();
  try {
    const response = await fetch(`${serviceUrl()}/v1/decisions`, {
      method: "POST",
      headers: headers(req, purpose),
      body: JSON.stringify(body(req)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`caipe-authz returned ${response.status}`);
    const value = (await response.json()) as CanonicalResult;
    return { result: mapResult(value), durationMs: performance.now() - started, error: false };
  } catch (error) {
    console.warn("[authz/client] decision failed:", error instanceof Error ? error.message : String(error));
    return {
      result: { decision: "DENY", reason: "AUTHZ_UNAVAILABLE", retriable: true },
      durationMs: performance.now() - started,
      error: true,
    };
  }
}

export async function checkAuthzBatch(
  requests: AuthorizeRequest[],
  purpose: EvaluationPurpose,
  timeoutMs = Number(process.env.AUTHZ_HTTP_TIMEOUT_MS ?? 500),
): Promise<TimedAuthorizeResult[]> {
  if (requests.length === 0) return [];
  const started = performance.now();
  try {
    const first = requests[0];
    const response = await fetch(`${serviceUrl()}/v1/decisions:batch`, {
      method: "POST",
      headers: headers(first, purpose),
      body: JSON.stringify({
        surface: "bff",
        subject: first.subject,
        items: requests.map((req, index) => ({
          item_id: String(index),
          action: req.action,
          resource: req.resource,
          context: { advisory: req.context ?? {}, request: {}, resource: {}, identity: {} },
        })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`caipe-authz returned ${response.status}`);
    const value = (await response.json()) as { items: Array<{ result: CanonicalResult }> };
    const durationMs = performance.now() - started;
    if (value.items.length !== requests.length) throw new Error("caipe-authz batch cardinality mismatch");
    return value.items.map((item) => ({ result: mapResult(item.result), durationMs, error: false }));
  } catch (error) {
    console.warn("[authz/client] batch decision failed:", error instanceof Error ? error.message : String(error));
    const durationMs = performance.now() - started;
    return requests.map(() => ({
      result: { decision: "DENY", reason: "AUTHZ_UNAVAILABLE", retriable: true },
      durationMs,
      error: true,
    }));
  }
}

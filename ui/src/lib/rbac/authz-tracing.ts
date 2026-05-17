import { AsyncLocalStorage } from "async_hooks";
import { randomBytes } from "crypto";

export interface AuthzTraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceparent: string;
}

export type AuthzSpanAttribute = string | number | boolean | null | undefined;
export type AuthzSpanAttributes = Record<string, AuthzSpanAttribute>;

const TRACEPARENT_RE = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/;
const authzTraceStorage = new AsyncLocalStorage<AuthzTraceContext>();

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function isValidTraceparent(value: unknown): value is string {
  return typeof value === "string" && TRACEPARENT_RE.test(value.trim().toLowerCase());
}

export function extractTraceIdFromTraceparent(value: unknown): string | null {
  if (!isValidTraceparent(value)) return null;
  return value.trim().toLowerCase().match(TRACEPARENT_RE)?.[1] ?? null;
}

function parseTraceparent(value: unknown): Pick<AuthzTraceContext, "traceId" | "parentSpanId"> | null {
  if (!isValidTraceparent(value)) return null;
  const match = value.trim().toLowerCase().match(TRACEPARENT_RE);
  if (!match) return null;
  return { traceId: match[1], parentSpanId: match[2] };
}

export function createAuthzTraceContext(parentTraceparent?: unknown): AuthzTraceContext {
  const parent = parseTraceparent(parentTraceparent);
  const traceId = parent?.traceId ?? randomHex(16);
  const spanId = randomHex(8);
  return {
    traceId,
    spanId,
    parentSpanId: parent?.parentSpanId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

export function getCurrentAuthzTraceContext(): AuthzTraceContext | undefined {
  return authzTraceStorage.getStore();
}

export function getCurrentTraceparent(): string | undefined {
  return getCurrentAuthzTraceContext()?.traceparent;
}

function isTracingEnabled(): boolean {
  return process.env.AUTHZ_TRACING_ENABLED?.trim().toLowerCase() === "true";
}

function otlpEndpoint(): string | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  return endpoint ? endpoint.replace(/\/+$/, "") : null;
}

function otelAttributeValue(value: Exclude<AuthzSpanAttribute, undefined | null>) {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return { doubleValue: value };
  return { stringValue: String(value) };
}

function otelAttributes(attributes: AuthzSpanAttributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({ key, value: otelAttributeValue(value as Exclude<AuthzSpanAttribute, undefined | null>) }));
}

export function emitAuthzSpan(
  name: string,
  attributes: AuthzSpanAttributes,
  context: AuthzTraceContext = createAuthzTraceContext(),
  startedAtNs = BigInt(Date.now()) * BigInt(1000000),
  endedAtNs = BigInt(Date.now()) * BigInt(1000000),
): void {
  const endpoint = otlpEndpoint();
  if (!isTracingEnabled() || !endpoint) return;

  const span = {
    traceId: context.traceId,
    spanId: context.spanId,
    ...(context.parentSpanId ? { parentSpanId: context.parentSpanId } : {}),
    name,
    kind: 2,
    startTimeUnixNano: startedAtNs.toString(),
    endTimeUnixNano: endedAtNs.toString(),
    attributes: otelAttributes({
      "audit.type": "openfga_rebac",
      "authz.pdp": "openfga",
      ...attributes,
    }),
  };

  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: otelAttributes({
            "service.name": process.env.OTEL_SERVICE_NAME || "caipe-ui-webui-backend",
            "deployment.environment": process.env.NODE_ENV || "development",
          }),
        },
        scopeSpans: [
          {
            scope: { name: "caipe.authz" },
            spans: [span],
          },
        ],
      },
    ],
  };

  void fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    console.warn("[authz-tracing] Failed to export authz span:", err);
  });
}

export async function withAuthzSpan<T>(
  name: string,
  attributes: AuthzSpanAttributes,
  callback: (context: AuthzTraceContext) => Promise<T>,
  parentTraceparent?: unknown,
): Promise<T> {
  const context = createAuthzTraceContext(parentTraceparent);
  const startedAtNs = process.hrtime.bigint();
  try {
    return await authzTraceStorage.run(context, () => callback(context));
  } finally {
    const durationNs = process.hrtime.bigint() - startedAtNs;
    const startedWallNs = BigInt(Date.now()) * BigInt(1000000) - durationNs;
    emitAuthzSpan(name, attributes, context, startedWallNs, startedWallNs + durationNs);
  }
}

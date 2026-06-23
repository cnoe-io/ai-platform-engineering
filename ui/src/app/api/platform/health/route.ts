import { NextRequest, NextResponse } from "next/server";

import {
  getInternalA2AUrl,
  getServerConfig,
  getServerOnlyConfig,
} from "@/lib/config";
import {
  createJsonResponseCacheStore,
  envTtlMs,
  withJsonResponseCache,
} from "@/lib/server-response-cache";
import { callSlackBotAdmin } from "@/lib/slack-bot-admin";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";

export const runtime = "nodejs";

type CapabilityStatus = "healthy" | "degraded" | "down" | "disabled";
type CapabilityGroup = "runtime" | "knowledge" | "identity" | "observability" | "messaging";

interface CapabilityResult {
  id: string;
  label: string;
  group: CapabilityGroup;
  status: CapabilityStatus;
  required: boolean;
  description: string;
  detail: string;
  latency_ms: number | null;
}

const HTTP_TIMEOUT_MS = 3000;
const healthCache = createJsonResponseCacheStore();
const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("#")) return null;
  if (value.startsWith("<") && value.endsWith(">")) return null;
  if (value.toLowerCase().includes("your-")) return null;
  return value;
}

function envEnabled(name: string): boolean {
  const value = envValue(name)?.toLowerCase();
  return value ? ENABLED_VALUES.has(value) : false;
}

function hasComposeProfile(...profileNames: string[]): boolean {
  const profiles = new Set(
    (process.env.COMPOSE_PROFILES ?? "")
      .split(",")
      .map((profile) => profile.trim())
      .filter(Boolean),
  );
  return profileNames.some((profile) => profiles.has(profile));
}

function requestOrigin(request: NextRequest): string {
  return request.nextUrl?.origin ?? new URL(request.url).origin;
}

function slackDirectoryToken(): string | null {
  return envValue("SLACK_BOT_TOKEN") ?? envValue("SLACK_INTEGRATION_BOT_TOKEN");
}

function slackIntegrationEnabled(): boolean {
  return (
    Boolean(
      envEnabled("SLACK_INTEGRATION_ENABLED") ||
        envEnabled("SLACK_ADMIN_API_ENABLED") ||
        envEnabled("SLACK_BOT_ADMIN_DEV_AUTH_ENABLED"),
    ) ||
    hasComposeProfile("slack-bot", "all-integrations")
  );
}

function webexIntegrationToken(): string | null {
  return (
    envValue("WEBEX_INTEGRATION_BOT_ACCESS_TOKEN") ??
    envValue("WEBEX_ACCESS_TOKEN") ??
    envValue("WEBEX_TOKEN")
  );
}

function webexIntegrationEnabled(): boolean {
  return (
    Boolean(
      envEnabled("WEBEX_INTEGRATION_ENABLED") ||
        webexIntegrationToken() ||
        envValue("WEBEX_BOT_ADMIN_CLIENT_SECRET") ||
        envValue("KEYCLOAK_WEBEX_BOT_ADMIN_CLIENT_SECRET"),
    ) ||
    hasComposeProfile("webex-bot", "all-integrations")
  );
}

function isHealthyStatusPayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { status?: unknown }).status === "healthy"
  );
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), HTTP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function disabledCapability(input: {
  id: string;
  label: string;
  group: CapabilityGroup;
  detail: string;
  description: string;
}): CapabilityResult {
  return {
    ...input,
    status: "disabled",
    required: false,
    description: input.description,
    latency_ms: null,
  };
}

async function probeHttpCapability({
  id,
  label,
  group,
  target,
  required,
  description,
  degradedOnFailure = !required,
  healthyDetail = "Reachable",
  failureLabel,
  healthyPayload,
}: {
  id: string;
  label: string;
  group: CapabilityGroup;
  target: string;
  required: boolean;
  description: string;
  degradedOnFailure?: boolean;
  healthyDetail?: string;
  failureLabel: string;
  healthyPayload?: (payload: unknown) => boolean;
}): Promise<CapabilityResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      if (healthyPayload) {
        const payload = await response.clone().json().catch(() => null);
        if (!healthyPayload(payload)) {
          return {
            id,
            label,
            group,
            status: degradedOnFailure ? "degraded" : "down",
            required,
            description,
            detail: `${failureLabel} returned unhealthy status`,
            latency_ms: latencyMs,
          };
        }
      }
      return {
        id,
        label,
        group,
        status: "healthy",
        required,
        description,
        detail: healthyDetail,
        latency_ms: latencyMs,
      };
    }
    return {
      id,
      label,
      group,
      status: degradedOnFailure ? "degraded" : "down",
      required,
      description,
      detail: `${failureLabel} returned HTTP ${response.status}`,
      latency_ms: latencyMs,
    };
  } catch (error) {
    return {
      id,
      label,
      group,
      status: degradedOnFailure ? "degraded" : "down",
      required,
      description,
      detail: `${failureLabel} failed: ${error instanceof Error ? error.message : "request failed"}`,
      latency_ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeSlackIntegration(): Promise<CapabilityResult | null> {
  if (!slackIntegrationEnabled()) {
    return disabledCapability({
      id: "slack-integration",
      label: "Slack",
      group: "messaging",
      description: "Slack messaging integration is not enabled for this deployment.",
      detail: "Disabled",
    });
  }

  const startedAt = Date.now();
  const issues: string[] = [];

  if (!slackDirectoryToken()) {
    issues.push("Slack directory token is not configured on the UI service");
  }

  try {
    await withTimeout(
      callSlackBotAdmin("/admin/slack/routes/status"),
      "Slack bot admin check",
    );
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Slack bot admin check failed");
  }

  return {
    id: "slack-integration",
    label: "Slack",
    group: "messaging",
    status: issues.length > 0 ? "degraded" : "healthy",
    required: false,
    description: "Checks Slack integration availability.",
    detail: issues.length > 0 ? issues.join("; ") : "Slack ready",
    latency_ms: Date.now() - startedAt,
  };
}

async function probeWebexIntegration(): Promise<CapabilityResult | null> {
  if (!webexIntegrationEnabled()) {
    return disabledCapability({
      id: "webex-integration",
      label: "Webex",
      group: "messaging",
      description: "Webex messaging integration is not enabled for this deployment.",
      detail: "Disabled",
    });
  }

  const startedAt = Date.now();
  const issues: string[] = [];

  if (!webexIntegrationToken()) {
    issues.push("Webex integration token is not configured on the UI service");
  }

  try {
    await withTimeout(
      callWebexBotAdmin("/admin/webex/routes/status"),
      "Webex bot admin check",
    );
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Webex bot admin check failed");
  }

  return {
    id: "webex-integration",
    label: "Webex",
    group: "messaging",
    status: issues.length > 0 ? "degraded" : "healthy",
    required: false,
    description: "Checks Webex integration availability.",
    detail: issues.length > 0 ? issues.join("; ") : "Webex ready",
    latency_ms: Date.now() - startedAt,
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  return withJsonResponseCache(request, healthCache, () => getPlatformHealth(request), {
    ttlMs: envTtlMs("PLATFORM_HEALTH_CACHE_TTL_MS", 5_000),
    varyHeaders: [],
    cacheableStatus: (status) => status === 200 || status === 503,
    maxEntries: 4,
  });
}

async function getPlatformHealth(request: NextRequest): Promise<NextResponse> {
  const config = getServerConfig();
  const serverOnly = getServerOnlyConfig();
  const origin = requestOrigin(request);
  const capabilityResults = await Promise.all([
    probeHttpCapability({
      id: "chat-runtime",
      label: "Chat Runtime",
      group: "runtime",
      target: `${getInternalA2AUrl()}/health`,
      required: true,
      description: "Checks the supervisor health endpoint used by the chat experience.",
      degradedOnFailure: false,
      healthyDetail: "Supervisor reachable",
      failureLabel: "Supervisor health check",
    }),
    config.dynamicAgentsEnabled
      ? probeHttpCapability({
          id: "dynamic-agents",
          label: "Dynamic Agents",
          group: "runtime",
          target: `${origin}/api/dynamic-agents/health`,
          required: true,
          description: "Checks Dynamic Agents when custom agent runtime is enabled.",
          healthyDetail: "Runtime reachable",
          degradedOnFailure: false,
          failureLabel: "Dynamic Agents health check",
          healthyPayload: isHealthyStatusPayload,
        })
      : Promise.resolve(
          disabledCapability({
            id: "dynamic-agents",
            label: "Dynamic Agents",
            group: "runtime",
            description: "Custom agent runtime is not enabled for this deployment.",
            detail: "Disabled by DYNAMIC_AGENTS_ENABLED",
          }),
        ),
    config.ragEnabled
      ? probeHttpCapability({
          id: "knowledge-bases",
          label: "Knowledge Bases",
          group: "knowledge",
          target: `${origin}/api/rag/healthz`,
          required: false,
          description: "Checks the RAG API used by Knowledge Bases.",
          healthyDetail: "RAG API reachable",
          failureLabel: "Knowledge Bases health check",
        })
      : Promise.resolve(
          disabledCapability({
            id: "knowledge-bases",
            label: "Knowledge Bases",
            group: "knowledge",
            description: "Knowledge Bases are not enabled for this deployment.",
            detail: "Disabled by RAG_ENABLED",
          }),
        ),
    Promise.resolve({
      id: "authentication",
      label: "Authentication",
      group: "identity",
      status: config.ssoEnabled ? "healthy" : "disabled",
      required: false,
      description: "Reads the UI SSO configuration.",
      detail: config.ssoEnabled ? "SSO enabled" : "SSO disabled",
      latency_ms: null,
    } satisfies CapabilityResult),
    Promise.resolve({
      id: "metrics",
      label: "Metrics",
      group: "observability",
      status: serverOnly.prometheusUrl ? "healthy" : "disabled",
      required: false,
      description: "Reads the UI Prometheus configuration.",
      detail: serverOnly.prometheusUrl ? "Prometheus configured" : "Prometheus not configured",
      latency_ms: null,
    } satisfies CapabilityResult),
    probeSlackIntegration(),
    probeWebexIntegration(),
  ]);
  const capabilities = capabilityResults.filter(
    (capability): capability is CapabilityResult => capability !== null,
  );

  const down = capabilities.filter((capability) => capability.status === "down").length;
  const degraded = capabilities.filter((capability) => capability.status === "degraded").length;
  const disabled = capabilities.filter((capability) => capability.status === "disabled").length;
  const healthy = capabilities.filter((capability) => capability.status === "healthy").length;
  const requiredDown = capabilities.some(
    (capability) => capability.required && capability.status === "down",
  );
  const status = requiredDown ? "down" : degraded > 0 ? "degraded" : "healthy";

  return NextResponse.json(
    {
      status,
      checked_at: new Date().toISOString(),
      summary: {
        total: capabilities.length,
        healthy,
        degraded,
        down,
        disabled,
      },
      capabilities,
    },
    { status: requiredDown ? 503 : 200 },
  );
}

import net from "node:net";

import { NextRequest,NextResponse } from "next/server";

import {
createJsonResponseCacheStore,
envTtlMs,
withJsonResponseCache,
} from "@/lib/server-response-cache";
import { AGENTGATEWAY_HEALTH_REMEDIATION } from "@/lib/platform-health-remediation";
import { getKeycloakMigrationHealth } from "@/lib/rbac/keycloak-migration-health";
import { getMigrationBlockingStatus } from "@/lib/rbac/migrations/registry";

export const runtime = "nodejs";

type ProbeStatus = "healthy" | "warning" | "down";
type ProbeGroup = "core" | "identity" | "storage" | "rag" | "bootstrap";

interface ProbeRemediation {
  label: string;
  href: string;
  description: string;
}

interface ProbeResult {
  id: string;
  label: string;
  group: ProbeGroup;
  status: ProbeStatus;
  detail: string;
  target: string;
  latency_ms: number | null;
  remediation?: ProbeRemediation;
}

const HTTP_TIMEOUT_MS = 3000;
const TCP_TIMEOUT_MS = 2000;
const healthCache = createJsonResponseCacheStore();

function env(name: string): string | undefined {
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`] || undefined;
}

// Kubernetes auto-injects {SERVICE}_PORT as "tcp://host:port" (a connection URL,
// not a bare port number). Number("tcp://...") is NaN, which crashes net.createConnection.
function envPort(name: string, defaultPort: number): number {
  const raw = env(name);
  if (!raw) return defaultPort;
  const tcpMatch = raw.match(/^tcp:\/\/[^:]+:(\d+)/);
  if (tcpMatch) return Number(tcpMatch[1]);
  return Number(raw) || defaultPort;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

async function probeHttp({
  id,
  label,
  group,
  target,
  headers,
  remediation,
  failureStatus = "down",
  failureDetailPrefix,
}: {
  id: string;
  label: string;
  group: ProbeGroup;
  target: string;
  headers?: HeadersInit;
  remediation?: ProbeRemediation;
  failureStatus?: ProbeStatus;
  failureDetailPrefix?: string;
}): Promise<ProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    const latencyMs = Date.now() - startedAt;
    const detail = `HTTP ${response.status}`;
    return {
      id,
      label,
      group,
      status: response.ok ? "healthy" : failureStatus,
      detail: response.ok || !failureDetailPrefix ? detail : `${failureDetailPrefix}: ${detail}`,
      target,
      latency_ms: latencyMs,
      remediation: response.ok ? undefined : remediation,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      id,
      label,
      group,
      status: failureStatus,
      detail:
        failureDetailPrefix && failureStatus === "warning"
          ? `${failureDetailPrefix}: ${error instanceof Error ? error.message : "request failed"}`
          : error instanceof Error
            ? error.message
            : "request failed",
      target,
      latency_ms: latencyMs,
      remediation,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeTcp({
  id,
  label,
  group,
  host,
  port,
  remediation,
}: {
  id: string;
  label: string;
  group: ProbeGroup;
  host: string;
  port: number;
  remediation?: ProbeRemediation;
}): Promise<ProbeResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: TCP_TIMEOUT_MS });

    const finish = (status: ProbeStatus, detail: string) => {
      socket.destroy();
      resolve({
        id,
        label,
        group,
        status,
        detail,
        target: `${host}:${port}`,
        latency_ms: Date.now() - startedAt,
        remediation: status === "healthy" ? undefined : remediation,
      });
    };

    socket.once("connect", () => finish("healthy", "TCP connection accepted"));
    socket.once("timeout", () => finish("down", "connection timed out"));
    socket.once("error", (error) => finish("down", error.message));
  });
}

async function probeOpenFgaBootstrap(openfgaUrl: string): Promise<ProbeResult> {
  const startedAt = Date.now();
  const storeName = env("OPENFGA_STORE_NAME") || "caipe-openfga";
  const remediation = {
    label: "View OpenFGA",
    href: "/admin?cat=security&tab=openfga",
    description: "Open the OpenFGA admin view and re-run the compose RBAC init services if the store or model is missing.",
  };

  try {
    const storesResponse = await fetch(`${openfgaUrl}/stores`, { method: "GET", cache: "no-store" });
    if (!storesResponse.ok) {
      return {
        id: "openfga-bootstrap",
        label: "OpenFGA Bootstrap",
        group: "bootstrap",
        status: "down",
        detail: `Store discovery HTTP ${storesResponse.status}`,
        target: `${openfgaUrl}/stores`,
        latency_ms: Date.now() - startedAt,
        remediation,
      };
    }
    const storesBody = (await storesResponse.json()) as { stores?: Array<{ id?: string; name?: string }> };
    const store = storesBody.stores?.find((candidate) => candidate.name === storeName);
    if (!store?.id) {
      return {
        id: "openfga-bootstrap",
        label: "OpenFGA Bootstrap",
        group: "bootstrap",
        status: "down",
        detail: `Store ${storeName} not found`,
        target: `${openfgaUrl}/stores`,
        latency_ms: Date.now() - startedAt,
        remediation,
      };
    }

    const modelsResponse = await fetch(`${openfgaUrl}/stores/${store.id}/authorization-models`, {
      method: "GET",
      cache: "no-store",
    });
    if (!modelsResponse.ok) {
      return {
        id: "openfga-bootstrap",
        label: "OpenFGA Bootstrap",
        group: "bootstrap",
        status: "down",
        detail: `Model discovery HTTP ${modelsResponse.status}`,
        target: `${openfgaUrl}/stores/${store.id}/authorization-models`,
        latency_ms: Date.now() - startedAt,
        remediation,
      };
    }
    const modelsBody = (await modelsResponse.json()) as { authorization_models?: unknown[] };
    if (!Array.isArray(modelsBody.authorization_models) || modelsBody.authorization_models.length === 0) {
      return {
        id: "openfga-bootstrap",
        label: "OpenFGA Bootstrap",
        group: "bootstrap",
        status: "down",
        detail: "No authorization model found",
        target: `${openfgaUrl}/stores/${store.id}/authorization-models`,
        latency_ms: Date.now() - startedAt,
        remediation,
      };
    }

    return {
      id: "openfga-bootstrap",
      label: "OpenFGA Bootstrap",
      group: "bootstrap",
      status: "healthy",
      detail: "Store and model ready",
      target: `${openfgaUrl}/stores/${store.id}`,
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: "openfga-bootstrap",
      label: "OpenFGA Bootstrap",
      group: "bootstrap",
      status: "down",
      detail: error instanceof Error ? error.message : "bootstrap check failed",
      target: `${openfgaUrl}/stores`,
      latency_ms: Date.now() - startedAt,
      remediation,
    };
  }
}

async function probeKeycloakBootstrap(): Promise<ProbeResult> {
  const remediation = {
    label: "Keycloak Health",
    href: "/admin?cat=security&tab=keycloak",
    description: "Open Keycloak health to inspect reconciliation and admin credential setup.",
  };
  try {
    const health = await getKeycloakMigrationHealth({ actor: "platform-health" });
    const failingInvariants = health.keycloak_invariants?.summary.failing ?? 0;
    if (!health.keycloak.reachable || health.keycloak.status !== "reachable") {
      return {
        id: "keycloak-bootstrap",
        label: "Keycloak Bootstrap",
        group: "bootstrap",
        status: "warning",
        detail: health.keycloak.probe_error || `Realm ${health.keycloak.realm} needs attention`,
        target: health.keycloak.realm,
        latency_ms: null,
        remediation,
      };
    }
    if (health.schema_area.status !== "current" || failingInvariants > 0) {
      return {
        id: "keycloak-bootstrap",
        label: "Keycloak Bootstrap",
        group: "bootstrap",
        status: "warning",
        detail:
          health.schema_area.status !== "current"
            ? `Schema ${health.schema_area.current_version ?? "unknown"} → ${health.schema_area.target_version}`
            : `${failingInvariants} invariant${failingInvariants === 1 ? "" : "s"} failing`,
        target: health.keycloak.realm,
        latency_ms: null,
        remediation,
      };
    }
    return {
      id: "keycloak-bootstrap",
      label: "Keycloak Bootstrap",
      group: "bootstrap",
      status: "healthy",
      detail: "Realm and reconciliation ready",
      target: health.keycloak.realm,
      latency_ms: null,
    };
  } catch (error) {
    return {
      id: "keycloak-bootstrap",
      label: "Keycloak Bootstrap",
      group: "bootstrap",
      status: "warning",
      detail: error instanceof Error ? error.message : "bootstrap check failed",
      target: env("KEYCLOAK_REALM") || "caipe",
      latency_ms: null,
      remediation,
    };
  }
}

async function probeRebacMigrations(): Promise<ProbeResult> {
  const remediation = {
    label: "Migration Assistant",
    href: "/admin?cat=security&tab=migrations",
    description: "Open the migration assistant to review and apply required schema migrations.",
  };
  try {
    const status = await getMigrationBlockingStatus({ actor: "platform-health" });
    if (status.is_blocking) {
      return {
        id: "rebac-migrations",
        label: "RBAC Migrations",
        group: "bootstrap",
        status: "warning",
        detail: `${status.blocking_required_count} blocking migration${status.blocking_required_count === 1 ? "" : "s"} pending`,
        target: status.release,
        latency_ms: null,
        remediation,
      };
    }
    if (status.needs_version_bootstrap) {
      return {
        id: "rebac-migrations",
        label: "RBAC Migrations",
        group: "bootstrap",
        status: "warning",
        detail: `${status.version_bootstrap_required_count} schema area${status.version_bootstrap_required_count === 1 ? "" : "s"} need version metadata`,
        target: status.release,
        latency_ms: null,
        remediation,
      };
    }
    return {
      id: "rebac-migrations",
      label: "RBAC Migrations",
      group: "bootstrap",
      status: "healthy",
      detail: "Current",
      target: status.release,
      latency_ms: null,
    };
  } catch (error) {
    return {
      id: "rebac-migrations",
      label: "RBAC Migrations",
      group: "bootstrap",
      status: "warning",
      detail: error instanceof Error ? error.message : "migration status unavailable",
      target: "schema_migrations",
      latency_ms: null,
      remediation,
    };
  }
}

function probeWebIngestorReadiness(ragServerHealthy: boolean, redisHealthy: boolean): ProbeResult {
  const status = ragServerHealthy && redisHealthy ? "healthy" : "warning";
  return {
    id: "web-ingestor",
    label: "Web Ingestor",
    group: "rag",
    status,
    detail: status === "healthy" ? "Queue ready; worker liveness not exposed" : "Requires RAG server and Redis",
    target: "web-ingestor",
    latency_ms: null,
    remediation:
      status === "healthy"
        ? undefined
        : {
            label: "RAG Setup",
            href: "/knowledge-bases/ingest",
            description: "Check that the rag and web_ingestor compose profiles are running.",
          },
  };
}

function probeAuditDisabled(backend: string, auditServiceUrl: string): ProbeResult {
  return {
    id: "audit-service",
    label: "Audit Service",
    group: "storage",
    status: "warning",
    detail:
      backend === "service"
        ? "audit-service unavailable; audit events will be dropped until it is available"
        : `AUDIT_LOG_BACKEND=${backend}; audit events will be dropped`,
    target: auditServiceUrl,
    latency_ms: null,
    remediation: {
      label: "Audit Service",
      href: "/admin?cat=metrics&tab=health",
      description: "Start audit-service or set AUDIT_LOG_BACKEND=service to enable durable audit collection.",
    },
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  return withJsonResponseCache(request, healthCache, getPlatformHealth, {
    ttlMs: envTtlMs("PLATFORM_HEALTH_CACHE_TTL_MS", 5_000),
    varyHeaders: [],
    cacheableStatus: (status) => status === 200 || status === 503,
    maxEntries: 4,
  });
}

async function getPlatformHealth(): Promise<NextResponse> {
  const keycloakUrl = trimTrailingSlash(env("KEYCLOAK_URL") || "http://keycloak:7080");
  const keycloakRealm = env("KEYCLOAK_REALM") || "caipe";
  const openfgaUrl = trimTrailingSlash(env("OPENFGA_HTTP") || "http://openfga:8080");
  const ragServerUrl = trimTrailingSlash(env("RAG_SERVER_URL") || "http://rag-server:9446");
  const dynamicAgentsUrl = trimTrailingSlash(env("DYNAMIC_AGENTS_URL") || env("DA_SERVER_BASE_URL") || "http://dynamic-agents:8001");
  const agentgatewayAdminUrl = trimTrailingSlash(
    env("AGENTGATEWAY_ADMIN_CONFIG_URL") || "http://agentgateway:15000/config",
  );
  const agentgatewayTargetsUrl =
    env("AGENTGATEWAY_TARGETS_URL") || "http://caipe-ui:3000/api/internal/agentgateway/mcp-targets";
  const agentgatewayTargetsToken =
    env("AGENTGATEWAY_TARGETS_TOKEN") || "agentgateway-config-bridge-dev-token";
  const auditServiceUrl = trimTrailingSlash(env("AUDIT_SERVICE_URL") || "http://audit-service:8010");
  const auditBackend = (env("AUDIT_LOG_BACKEND") || "service").trim().toLowerCase();
  const auditProbe =
    auditBackend === "service"
      ? probeHttp({
          id: "audit-service",
          label: "Audit Service",
          group: "storage",
          target: `${auditServiceUrl}/readyz`,
          failureStatus: "warning",
          failureDetailPrefix: "optional audit path unavailable; audit events will be dropped",
          remediation: {
            label: "Audit Service",
            href: "/admin?cat=metrics&tab=health",
            description: "Check audit-service logs, queue status, and local/S3 storage configuration.",
          },
        })
      : probeAuditDisabled(auditBackend, auditServiceUrl);

  const probes = await Promise.all([
    probeHttp({
      id: "keycloak",
      label: "Keycloak",
      group: "identity",
      target: `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`,
      remediation: {
        label: "Keycloak Health",
        href: "/admin?cat=security&tab=keycloak",
        description: "Inspect Keycloak realm, credentials, and reconciliation status.",
      },
    }),
    probeHttp({
      id: "openfga",
      label: "OpenFGA",
      group: "identity",
      target: `${openfgaUrl}/healthz`,
      remediation: {
        label: "OpenFGA",
        href: "/admin?cat=security&tab=openfga",
        description: "Inspect OpenFGA connectivity and seeded authorization model.",
      },
    }),
    probeTcp({
      id: "openfga-authz-bridge",
      label: "OpenFGA Bridge",
      group: "identity",
      host: env("OPENFGA_AUTHZ_BRIDGE_HOST") || "openfga-authz-bridge",
      port: envPort("OPENFGA_AUTHZ_BRIDGE_PORT", 9100),
      remediation: {
        label: "OpenFGA",
        href: "/admin?cat=security&tab=openfga",
        description: "Check OpenFGA bridge logs and authz configuration.",
      },
    }),
    probeHttp({
      id: "dynamic-agents",
      label: "Dynamic Agents",
      group: "core",
      target: `${dynamicAgentsUrl}/healthz`,
      remediation: {
        label: "Dynamic Agents",
        href: "/agents",
        description: "Check dynamic agents service logs and dependencies.",
      },
    }),
    probeHttp({
      id: "agentgateway-config-bridge",
      label: "AgentGateway Config Bridge",
      group: "core",
      target: agentgatewayTargetsUrl,
      headers: {
        authorization: `Bearer ${agentgatewayTargetsToken}`,
      },
      remediation: AGENTGATEWAY_HEALTH_REMEDIATION,
    }),
    probeHttp({
      id: "agentgateway",
      label: "AgentGateway",
      group: "core",
      target: agentgatewayAdminUrl,
      remediation: AGENTGATEWAY_HEALTH_REMEDIATION,
    }),
    probeTcp({
      id: "caipe-mongodb",
      label: "MongoDB",
      group: "storage",
      host: env("MONGODB_HOST") || "caipe-mongodb",
      port: envPort("MONGODB_PORT", 27017),
    }),
    auditProbe,
    probeTcp({
      id: "keycloak-postgres",
      label: "Keycloak Postgres",
      group: "storage",
      host: env("KEYCLOAK_POSTGRES_HOST") || "keycloak-postgres",
      port: envPort("KEYCLOAK_POSTGRES_PORT", 5432),
    }),
    probeTcp({
      id: "openfga-postgres",
      label: "OpenFGA Postgres",
      group: "storage",
      host: env("OPENFGA_POSTGRES_HOST") || "openfga-postgres",
      port: envPort("OPENFGA_POSTGRES_PORT", 5432),
    }),
    probeHttp({
      id: "rag-server",
      label: "RAG Server",
      group: "rag",
      target: `${ragServerUrl}/healthz`,
      remediation: {
        label: "Knowledge Bases",
        href: "/knowledge-bases",
        description: "Check RAG server dependencies and compose profile.",
      },
    }),
    probeTcp({
      id: "rag-redis",
      label: "RAG Redis",
      group: "rag",
      host: env("RAG_REDIS_HOST") || "rag-redis",
      port: envPort("RAG_REDIS_PORT", 6379),
    }),
    probeHttp({
      id: "milvus",
      label: "Milvus",
      group: "rag",
      target: trimTrailingSlash(env("MILVUS_HEALTH_URL") || "http://milvus-standalone:9091/healthz"),
    }),
    probeTcp({
      id: "milvus-minio",
      label: "Milvus MinIO",
      group: "rag",
      host: env("MILVUS_MINIO_HOST") || "milvus-minio",
      port: envPort("MILVUS_MINIO_PORT", 9000),
    }),
    probeTcp({
      id: "etcd",
      label: "etcd",
      group: "rag",
      host: env("ETCD_HOST") || "etcd",
      port: envPort("ETCD_PORT", 2379),
    }),
    probeOpenFgaBootstrap(openfgaUrl),
    probeKeycloakBootstrap(),
    probeRebacMigrations(),
  ]);

  const ragServerProbe = probes.find((probe) => probe.id === "rag-server");
  const ragRedisProbe = probes.find((probe) => probe.id === "rag-redis");
  probes.push(
    probeWebIngestorReadiness(
      ragServerProbe?.status === "healthy",
      ragRedisProbe?.status === "healthy",
    ),
  );

  const down = probes.filter((probe) => probe.status === "down").length;
  const warning = probes.filter((probe) => probe.status === "warning").length;
  const status = down > 0 ? "down" : warning > 0 ? "degraded" : "healthy";

  return NextResponse.json(
    {
      status,
      checked_at: new Date().toISOString(),
      summary: {
        total: probes.length,
        healthy: probes.length - down - warning,
        warning,
        down,
      },
      probes,
    },
    { status: down > 0 ? 503 : 200 },
  );
}

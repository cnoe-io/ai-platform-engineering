import net from "node:net";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ProbeStatus = "healthy" | "down";

interface ProbeResult {
  id: string;
  label: string;
  status: ProbeStatus;
  detail: string;
  target: string;
  latency_ms: number | null;
}

const HTTP_TIMEOUT_MS = 3000;
const TCP_TIMEOUT_MS = 2000;

function env(name: string): string | undefined {
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`] || undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

async function probeHttp({
  id,
  label,
  target,
  headers,
}: {
  id: string;
  label: string;
  target: string;
  headers?: HeadersInit;
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
    return {
      id,
      label,
      status: response.ok ? "healthy" : "down",
      detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
      target,
      latency_ms: latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      id,
      label,
      status: "down",
      detail: error instanceof Error ? error.message : "request failed",
      target,
      latency_ms: latencyMs,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeTcp({
  id,
  label,
  host,
  port,
}: {
  id: string;
  label: string;
  host: string;
  port: number;
}): Promise<ProbeResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: TCP_TIMEOUT_MS });

    const finish = (status: ProbeStatus, detail: string) => {
      socket.destroy();
      resolve({
        id,
        label,
        status,
        detail,
        target: `${host}:${port}`,
        latency_ms: Date.now() - startedAt,
      });
    };

    socket.once("connect", () => finish("healthy", "TCP connection accepted"));
    socket.once("timeout", () => finish("down", "connection timed out"));
    socket.once("error", (error) => finish("down", error.message));
  });
}

export async function GET(): Promise<Response> {
  const keycloakUrl = trimTrailingSlash(env("KEYCLOAK_URL") || "http://keycloak:7080");
  const keycloakRealm = env("KEYCLOAK_REALM") || "caipe";
  const openfgaUrl = trimTrailingSlash(env("OPENFGA_HTTP") || "http://openfga:8080");
  const agentgatewayAdminUrl = trimTrailingSlash(
    env("AGENTGATEWAY_ADMIN_CONFIG_URL") || "http://agentgateway:15000/config",
  );
  const agentgatewayTargetsUrl =
    env("AGENTGATEWAY_TARGETS_URL") || "http://caipe-ui:3000/api/internal/agentgateway/mcp-targets";
  const agentgatewayTargetsToken =
    env("AGENTGATEWAY_TARGETS_TOKEN") || "agentgateway-config-bridge-dev-token";

  const probes = await Promise.all([
    probeHttp({
      id: "keycloak",
      label: "Keycloak",
      target: `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`,
    }),
    probeHttp({
      id: "openfga",
      label: "OpenFGA",
      target: `${openfgaUrl}/healthz`,
    }),
    probeTcp({
      id: "openfga-authz-bridge",
      label: "OpenFGA Bridge",
      host: env("OPENFGA_AUTHZ_BRIDGE_HOST") || "openfga-authz-bridge",
      port: Number(env("OPENFGA_AUTHZ_BRIDGE_PORT") || 9100),
    }),
    probeHttp({
      id: "agentgateway-config-bridge",
      label: "AgentGateway Config Bridge",
      target: agentgatewayTargetsUrl,
      headers: {
        authorization: `Bearer ${agentgatewayTargetsToken}`,
      },
    }),
    probeHttp({
      id: "agentgateway",
      label: "AgentGateway",
      target: agentgatewayAdminUrl,
    }),
  ]);

  const down = probes.filter((probe) => probe.status === "down").length;

  return NextResponse.json(
    {
      status: down > 0 ? "down" : "healthy",
      checked_at: new Date().toISOString(),
      summary: {
        total: probes.length,
        healthy: probes.length - down,
        down,
      },
      probes,
    },
    { status: down > 0 ? 503 : 200 },
  );
}

/**
 * @jest-environment node
 */

import { EventEmitter } from "node:events";

const mockCreateConnection = jest.fn();

jest.mock("node:net", () => ({
  __esModule: true,
  default: {
    createConnection: (...args: unknown[]) => mockCreateConnection(...args),
  },
}));

jest.mock("@/lib/rbac/keycloak-migration-health", () => ({
  getKeycloakMigrationHealth: jest.fn(async () => ({
    keycloak: {
      configured: true,
      reachable: true,
      status: "reachable",
      realm: "caipe",
      last_probe_at: "2026-06-18T12:00:00Z",
    },
    schema_area: {
      area: "keycloak_rbac_mappings",
      current_version: 1,
      target_version: 1,
      status: "current",
    },
    keycloak_invariants: {
      summary: { total: 1, passing: 1, failing: 0, unknown: 0, reconcileRecommended: false },
      items: [],
    },
  })),
}));

jest.mock("@/lib/rbac/migrations/registry", () => ({
  getMigrationBlockingStatus: jest.fn(async () => ({
    release: "0.5.8",
    runtime: "0.5.8",
    schema_versions: [],
    pending_required_count: 0,
    blocking_required_count: 0,
    version_bootstrap_required_count: 0,
    version_bootstrap_schema_areas: [],
    needs_version_bootstrap: false,
    requires_attention: false,
    is_blocking: false,
    override_active: false,
  })),
}));

function mockTcpConnect() {
  mockCreateConnection.mockImplementation(() => {
    const socket = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
    socket.destroy = jest.fn();
    process.nextTick(() => socket.emit("connect"));
    return socket;
  });
}

describe("/api/platform/health", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      KEYCLOAK_URL: "http://keycloak:7080",
      KEYCLOAK_REALM: "caipe",
      OPENFGA_HTTP: "http://openfga:8080",
      AGENTGATEWAY_ADMIN_CONFIG_URL: "http://agentgateway:15000/config",
      AGENTGATEWAY_TARGETS_URL: "http://caipe-ui:3000/api/internal/agentgateway/mcp-targets",
      AGENTGATEWAY_TARGETS_TOKEN: "bridge-token",
    };
    mockTcpConnect();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns healthy when all platform probes pass", async () => {
    (global.fetch as jest.Mock) = jest.fn(async (url: string) => {
      if (url.endsWith("/stores")) {
        return new Response(JSON.stringify({ stores: [{ id: "store-1", name: "caipe-openfga" }] }), { status: 200 });
      }
      if (url.endsWith("/authorization-models")) {
        return new Response(JSON.stringify({ authorization_models: [{ id: "model-1" }] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.summary).toEqual({ total: 19, healthy: 19, warning: 0, down: 0 });
    expect(body.probes.map((probe: { id: string }) => probe.id)).toEqual([
      "keycloak",
      "openfga",
      "openfga-authz-bridge",
      "dynamic-agents",
      "agentgateway-config-bridge",
      "agentgateway",
      "caipe-mongodb",
      "audit-service",
      "keycloak-postgres",
      "openfga-postgres",
      "rag-server",
      "rag-redis",
      "milvus",
      "milvus-minio",
      "etcd",
      "openfga-bootstrap",
      "keycloak-bootstrap",
      "rebac-migrations",
      "web-ingestor",
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://caipe-ui:3000/api/internal/agentgateway/mcp-targets",
      expect.objectContaining({
        headers: { authorization: "Bearer bridge-token" },
      }),
    );
  });

  it("routes AgentGateway remediation to MCP Servers when probes fail", async () => {
    (global.fetch as jest.Mock) = jest.fn(async (url: string) => {
      if (url.endsWith("/stores")) {
        return new Response(JSON.stringify({ stores: [{ id: "store-1", name: "caipe-openfga" }] }), { status: 200 });
      }
      if (url.endsWith("/authorization-models")) {
        return new Response(JSON.stringify({ authorization_models: [{ id: "model-1" }] }), { status: 200 });
      }
      if (url.includes("agentgateway")) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    });
    mockTcpConnect();

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(body.probes.find((probe: { id: string }) => probe.id === "agentgateway")).toMatchObject({
      status: "down",
      remediation: {
        href: "/dynamic-agents?tab=mcp-servers",
        label: "MCP Servers",
      },
    });
    expect(body.probes.find((probe: { id: string }) => probe.id === "agentgateway-config-bridge")).toMatchObject({
      remediation: {
        href: "/dynamic-agents?tab=mcp-servers",
        label: "MCP Servers",
      },
    });
  });

  it("returns 503 and marks failed probes down", async () => {
    (global.fetch as jest.Mock) = jest.fn((url: string) =>
      Promise.resolve(new Response(JSON.stringify({ stores: [] }), { status: url.includes("healthz") && url.includes("openfga") ? 503 : 200 })),
    );

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.summary.down).toBeGreaterThanOrEqual(1);
    expect(body.probes.find((probe: { id: string }) => probe.id === "openfga")).toMatchObject({
      status: "down",
      detail: "HTTP 503",
    });
  });

  it("marks audit-service failures as warning without failing platform health", async () => {
    (global.fetch as jest.Mock) = jest.fn(async (url: string) => {
      if (url.endsWith("/stores")) {
        return new Response(JSON.stringify({ stores: [{ id: "store-1", name: "caipe-openfga" }] }), { status: 200 });
      }
      if (url.endsWith("/authorization-models")) {
        return new Response(JSON.stringify({ authorization_models: [{ id: "model-1" }] }), { status: 200 });
      }
      if (url.endsWith("/readyz") && url.includes("audit-service")) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    });

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.summary.warning).toBe(1);
    expect(body.summary.down).toBe(0);
    expect(body.probes.find((probe: { id: string }) => probe.id === "audit-service")).toMatchObject({
      status: "warning",
      detail: "optional audit path unavailable; audit events will be dropped: HTTP 503",
    });
  });
});

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
      DYNAMIC_AGENTS_URL: "http://dynamic-agents:8001",
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
    expect(body.summary).toEqual({ total: 18, healthy: 18, warning: 0, down: 0 });
    expect(body.probes.map((probe: { id: string }) => probe.id)).toEqual([
      "keycloak",
      "openfga",
      "openfga-authz-bridge",
      "agentgateway-config-bridge",
      "agentgateway",
      "dynamic-agents",
      "caipe-mongodb",
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

  it("returns degraded (200) when only RAG probes fail — RAG failures are capped at warning", async () => {
    (global.fetch as jest.Mock) = jest.fn(async (url: string) => {
      if (url.includes("rag-server") || url.includes("rag_server") || (url.includes("rag") && url.includes("health"))) {
        return new Response("Service Unavailable", { status: 503 });
      }
      if (url.endsWith("/stores")) {
        return new Response(JSON.stringify({ stores: [{ id: "store-1", name: "caipe-openfga" }] }), { status: 200 });
      }
      if (url.endsWith("/authorization-models")) {
        return new Response(JSON.stringify({ authorization_models: [{ id: "model-1" }] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    // Also make TCP connections succeed for non-RAG probes, but fail for rag-redis
    mockCreateConnection.mockImplementation((opts: { host?: string; port?: number }) => {
      const socket = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
      socket.destroy = jest.fn();
      // rag-redis would typically be on port 6379; fail it to simulate RAG group failure
      if (opts?.port === 6379) {
        process.nextTick(() => socket.emit("error", new Error("Connection refused")));
      } else {
        process.nextTick(() => socket.emit("connect"));
      }
      return socket;
    });

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");

    const ragServerProbe = body.probes.find((probe: { id: string }) => probe.id === "rag-server");
    expect(ragServerProbe).toBeDefined();
    expect(ragServerProbe.status).toBe("warning");
  });

  it("returns 503 and marks rebac-migrations down when getMigrationBlockingStatus returns is_blocking: true", async () => {
    const { getMigrationBlockingStatus } = await import("@/lib/rbac/migrations/registry");
    (getMigrationBlockingStatus as jest.Mock).mockResolvedValueOnce({
      release: "0.5.8",
      runtime: "0.5.7",
      schema_versions: [],
      pending_required_count: 1,
      blocking_required_count: 1,
      version_bootstrap_required_count: 0,
      version_bootstrap_schema_areas: [],
      needs_version_bootstrap: false,
      requires_attention: true,
      is_blocking: true,
      override_active: false,
    });

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

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");

    const rebacProbe = body.probes.find((probe: { id: string }) => probe.id === "rebac-migrations");
    expect(rebacProbe).toBeDefined();
    expect(rebacProbe.status).toBe("down");
  });

  it("returns 503 and marks keycloak-bootstrap down when getKeycloakMigrationHealth returns reachable: false", async () => {
    const { getKeycloakMigrationHealth } = await import("@/lib/rbac/keycloak-migration-health");
    (getKeycloakMigrationHealth as jest.Mock).mockResolvedValueOnce({
      keycloak: {
        configured: true,
        reachable: false,
        status: "unreachable",
        realm: "caipe",
        last_probe_at: "2026-06-18T12:00:00Z",
      },
      schema_area: {
        area: "keycloak_rbac_mappings",
        current_version: 0,
        target_version: 1,
        status: "unknown",
      },
      keycloak_invariants: {
        summary: { total: 0, passing: 0, failing: 0, unknown: 0, reconcileRecommended: false },
        items: [],
      },
    });

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

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");

    const keycloakBootstrapProbe = body.probes.find((probe: { id: string }) => probe.id === "keycloak-bootstrap");
    expect(keycloakBootstrapProbe).toBeDefined();
    expect(keycloakBootstrapProbe.status).toBe("down");
  });

  it("does not crash and calls mockCreateConnection with port 6379 when RAG_REDIS_PORT is a tcp:// URL", async () => {
    process.env.RAG_REDIS_PORT = "tcp://172.20.48.164:6379";

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

    expect(response.status).not.toBe(500);

    const ragRedisCall = mockCreateConnection.mock.calls.find(
      (call) => call[0]?.port === 6379,
    );
    expect(ragRedisCall).toBeDefined();
    expect(ragRedisCall![0].port).toBe(6379);
  });
});

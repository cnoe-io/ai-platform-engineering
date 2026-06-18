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
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.summary).toEqual({ total: 5, healthy: 5, down: 0 });
    expect(body.probes.map((probe: { id: string }) => probe.id)).toEqual([
      "keycloak",
      "openfga",
      "openfga-authz-bridge",
      "agentgateway-config-bridge",
      "agentgateway",
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
      Promise.resolve(new Response("{}", { status: url.includes("openfga") ? 503 : 200 })),
    );

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.summary).toEqual({ total: 5, healthy: 4, down: 1 });
    expect(body.probes.find((probe: { id: string }) => probe.id === "openfga")).toMatchObject({
      status: "down",
      detail: "HTTP 503",
    });
  });
});

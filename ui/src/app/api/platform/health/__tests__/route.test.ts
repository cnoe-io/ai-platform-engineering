/**
 * @jest-environment node
 */

describe("/api/platform/health", () => {
  const originalEnv = process.env;

  function request(): Request {
    return new Request("http://localhost/api/platform/health");
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      A2A_BASE_URL: "http://supervisor:8000",
      DYNAMIC_AGENTS_ENABLED: "true",
      DYNAMIC_AGENTS_URL: "http://dynamic-agents:8001",
      RAG_ENABLED: "true",
      RAG_SERVER_URL: "http://rag-server:9446",
      SSO_ENABLED: "true",
      PROMETHEUS_URL: "http://prometheus:9090",
      PLATFORM_HEALTH_CACHE_TTL_MS: "0",
      COMPOSE_PROFILES: "",
      SLACK_BOT_TOKEN: "",
      SLACK_INTEGRATION_BOT_TOKEN: "",
      SLACK_APP_TOKEN: "",
      SLACK_INTEGRATION_APP_TOKEN: "",
      SLACK_INTEGRATION_ENABLED: "",
      SLACK_ADMIN_API_ENABLED: "",
      SLACK_BOT_ADMIN_DEV_AUTH_ENABLED: "",
      SLACK_BOT_ADMIN_DEV_TOKEN: "",
      WEBEX_INTEGRATION_BOT_ACCESS_TOKEN: "",
      WEBEX_ACCESS_TOKEN: "",
      WEBEX_TOKEN: "",
      WEBEX_INTEGRATION_ENABLED: "",
      WEBEX_ADMIN_API_ENABLED: "",
      OIDC_CLIENT_SECRET: "",
      WEBEX_BOT_ADMIN_CLIENT_SECRET: "",
      KEYCLOAK_WEBEX_BOT_ADMIN_CLIENT_SECRET: "",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns healthy product capabilities when enabled checks pass", async () => {
    (global.fetch as jest.Mock) = jest.fn(async (url: string) =>
      new Response(
        url.includes("/api/dynamic-agents/health") ? '{"status":"healthy"}' : "{}",
        { status: 200 },
      ),
    );

    const { GET } = await import("../route");
    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.summary).toEqual({ total: 7, healthy: 5, degraded: 0, down: 0, disabled: 2 });
    expect(body.capabilities.map((capability: { id: string }) => capability.id)).toEqual([
      "chat-runtime",
      "dynamic-agents",
      "knowledge-bases",
      "authentication",
      "metrics",
      "slack-integration",
      "webex-integration",
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://supervisor:8000/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost/api/dynamic-agents/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost/api/rag/healthz",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("marks disabled optional capabilities neutral", async () => {
    process.env.DYNAMIC_AGENTS_ENABLED = "false";
    process.env.RAG_ENABLED = "false";
    process.env.SSO_ENABLED = "false";
    delete process.env.PROMETHEUS_URL;
    (global.fetch as jest.Mock) = jest.fn(async () => new Response("{}", { status: 200 }));

    const { GET } = await import("../route");
    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.summary).toEqual({ total: 7, healthy: 1, degraded: 0, down: 0, disabled: 6 });
    expect(body.capabilities.find((capability: { id: string }) => capability.id === "knowledge-bases")).toMatchObject({
      status: "disabled",
      detail: "Disabled by RAG_ENABLED",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("degrades when an enabled optional capability fails", async () => {
    process.env.DYNAMIC_AGENTS_ENABLED = "false";
    (global.fetch as jest.Mock) = jest.fn(async (url: string) =>
      new Response("{}", { status: url.includes("/api/rag/healthz") ? 503 : 200 }),
    );

    const { GET } = await import("../route");
    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.summary.degraded).toBe(1);
    expect(body.capabilities.find((capability: { id: string }) => capability.id === "knowledge-bases")).toMatchObject({
      status: "degraded",
      detail: "Knowledge Bases health check returned HTTP 503",
    });
  });

  it("returns 503 when the enabled dynamic agents capability fails", async () => {
    process.env.RAG_ENABLED = "false";
    (global.fetch as jest.Mock) = jest.fn(async (url: string) =>
      new Response(
        url.includes("/api/dynamic-agents/health") ? '{"status":"unhealthy"}' : "{}",
        { status: 200 },
      ),
    );

    const { GET } = await import("../route");
    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.capabilities.find((capability: { id: string }) => capability.id === "dynamic-agents")).toMatchObject({
      status: "down",
      required: true,
      detail: "Dynamic Agents health check returned unhealthy status",
    });
  });

  it("includes enabled messaging integrations as degraded when their admin checks fail", async () => {
    process.env.SLACK_INTEGRATION_ENABLED = "true";
    process.env.WEBEX_INTEGRATION_ENABLED = "true";
    process.env.DYNAMIC_AGENTS_ENABLED = "false";
    (global.fetch as jest.Mock) = jest.fn(async () => new Response("{}", { status: 200 }));

    const { GET } = await import("../route");
    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.capabilities.find((capability: { id: string }) => capability.id === "slack-integration")).toMatchObject({
      status: "degraded",
      group: "messaging",
    });
    expect(body.capabilities.find((capability: { id: string }) => capability.id === "webex-integration")).toMatchObject({
      status: "degraded",
      group: "messaging",
    });
  });

  it("returns 503 only when the required chat runtime fails", async () => {
    process.env.DYNAMIC_AGENTS_ENABLED = "false";
    process.env.RAG_ENABLED = "false";
    (global.fetch as jest.Mock) = jest.fn(async () => new Response("{}", { status: 503 }));

    const { GET } = await import("../route");
    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.capabilities.find((capability: { id: string }) => capability.id === "chat-runtime")).toMatchObject({
      status: "down",
      required: true,
      detail: "Supervisor health check returned HTTP 503",
    });
  });
});

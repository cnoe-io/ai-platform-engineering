/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCallSlackBotAdmin = jest.fn();

jest.mock("@/lib/slack-bot-admin", () => ({
  callSlackBotAdmin: (...args: unknown[]) => mockCallSlackBotAdmin(...args),
}));

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice",
  })),
}));

jest.mock("@/lib/config", () => ({ getConfig: () => true }));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCallSlackBotAdmin.mockResolvedValue({
    workspace_id: "CAIPE",
    channels_seen: 1,
    routes_seen: 1,
    channels: {
      C123: {
        workspace_id: "CAIPE",
        channel_id: "C123",
        channel_name: "#incidents",
        agents: [{ agent_id: "incident-agent", priority: 100 }],
        suggested_agent_id: "incident-agent",
      },
    },
  });
});

describe("GET /api/admin/slack/runtime/config-defaults", () => {
  it("proxies structured legacy config defaults from the Slack bot admin API", async () => {
    const { GET } = await import("../config-defaults/route");

    const response = await GET(
      new NextRequest("http://localhost:3000/api/admin/slack/runtime/config-defaults", {
        headers: { Authorization: "Bearer test-token" },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCallSlackBotAdmin).toHaveBeenCalledWith("/admin/slack/routes/config-defaults");
    expect(body.data.channels.C123.suggested_agent_id).toBe("incident-agent");
    expect(JSON.stringify(body)).not.toMatch(/channels\.yaml/i);
  });
});

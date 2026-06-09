/**
 * @jest-environment node
 *
 * Tests for execution_identity validation in the per-channel-agent-routes BFF handler.
 *
 * Scope: the parseExecutionIdentity logic exercised via the PUT handler's route
 * parser. Verifies:
 *  - omitted execution_identity is accepted (optional)
 *  - mode "obo_user" accepted without sub
 *  - mode "service_account" requires service_account_sub → 400 when absent
 *  - invalid mode string → 400
 *  - valid service_account with sub + name roundtrips correctly
 *
 * SEC-1 / TEST-8:
 *  - SA sub must belong to the channel's owning team (403 when team mismatch)
 *  - SA not found → 403
 *  - SA revoked → 403
 *  - SA owned by different team → 403
 *  - SA owned by correct team → 200
 *  - No channel team mapping (null slug) → still validates SA existence/status only
 *
 * assisted-by Claude:claude-sonnet-4-6
 */

// ── Auth / session mocks ─────────────────────────────────────────────────────
const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

// Mock the api-middleware auth helper used by _lib.ts
const mockGetAuthFromBearerOrSession = jest.fn();
jest.mock("@/lib/api-middleware", () => ({
  ...jest.requireActual("@/lib/api-middleware"),
  getAuthFromBearerOrSession: (...args: unknown[]) =>
    mockGetAuthFromBearerOrSession(...args),
}));

// Mock the permission check so auth always passes
jest.mock("@/lib/rbac/require-openfga", () => ({
  requireAdminSurfaceManage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: jest.fn().mockResolvedValue(undefined),
}));

// ── OpenFGA mocks ────────────────────────────────────────────────────────────
const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
  listOpenFgaObjects: jest.fn().mockResolvedValue({ objects: [] }),
  checkOpenFgaTuple: jest.fn().mockResolvedValue({ allowed: true }),
}));

// ── Slack channel store mocks ─────────────────────────────────────────────────
jest.mock("@/lib/rbac/slack-channel-grant-store", () => ({
  slackChannelSubjectId: (ws: string, ch: string) => `${ws}--${ch}`,
  slackWorkspaceRef: (ws: string) => ws,
}));

// ── Route store mock ─────────────────────────────────────────────────────────
const mockReplaceSlackChannelAgentRoutes = jest.fn();
const mockListSlackChannelAgentRoutes = jest.fn();
jest.mock("@/lib/rbac/slack-channel-route-store", () => ({
  replaceSlackChannelAgentRoutes: (...args: unknown[]) =>
    mockReplaceSlackChannelAgentRoutes(...args),
  listSlackChannelAgentRoutes: (...args: unknown[]) =>
    mockListSlackChannelAgentRoutes(...args),
  deleteSlackChannelAgentRoute: jest.fn().mockResolvedValue(true),
}));

// ── rebac helper mocks ───────────────────────────────────────────────────────
jest.mock("@/lib/rbac/slack-channel-rebac", () => ({
  slackChannelGrantRelationship: jest.fn((ws: string, ch: string, res: { type: string; id: string }) => ({
    user: `slack_channel:${ws}--${ch}`,
    relation: "user",
    object: `${res.type}:${res.id}`,
  })),
}));
jest.mock("@/lib/rbac/tuple-builders", () => ({
  buildUniversalRebacTupleDiff: (input: unknown) => input,
}));

// ── Mongo mock (for channel_team_mappings + SEC-1) ───────────────────────────
const mockGetCollection = jest.fn();
jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

// ── Service-account getBySub mock (SEC-1) ────────────────────────────────────
const mockGetBySub = jest.fn();
jest.mock("@/lib/service-accounts", () => ({
  getBySub: (...args: unknown[]) => mockGetBySub(...args),
}));

import { NextRequest } from "next/server";
import { PUT } from "../route";

const SESSION = { sub: "admin-sub", user: { email: "admin@example.com" } };
const WS_ID = "T012WORKSPACE";
const CH_ID = "C01CHANNEL";

function makeContext() {
  return {
    params: Promise.resolve({ workspaceId: WS_ID, channelId: CH_ID }),
  };
}

function putRequest(body: unknown): NextRequest {
  return new NextRequest(
    new URL(`http://localhost/api/admin/slack/channels/${WS_ID}/${CH_ID}/routes`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

const SA_TEAM_SLUG = "team-sre";

/** Default active SA owned by the correct channel team. */
const VALID_SA_DOC = {
  sa_sub: "sa-sub-abc",
  name: "incident-bot",
  owning_team_id: SA_TEAM_SLUG,
  status: "active" as const,
};

function setupAuthPass() {
  mockGetServerSession.mockResolvedValue(SESSION);
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    session: SESSION,
    token: null,
  });
  // OpenFGA tuple read returns no existing agents
  mockReadOpenFgaTuples.mockResolvedValue({ tuples: [], continuationToken: undefined });
  // OpenFGA tuple write succeeds
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true });
  // Store returns what we pass it
  mockReplaceSlackChannelAgentRoutes.mockImplementation(
    (_ws: unknown, _ch: unknown, routes: unknown[]) => Promise.resolve(routes)
  );
  // Default: channel is mapped to SA_TEAM_SLUG
  mockGetCollection.mockResolvedValue({
    findOne: jest.fn().mockResolvedValue({ team_slug: SA_TEAM_SLUG }),
  });
  // Default: SA exists and belongs to the correct team
  mockGetBySub.mockResolvedValue(VALID_SA_DOC);
}

describe("PUT /routes — execution_identity validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("accepts routes without execution_identity (backward compat)", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({ routes: [{ agent_id: "agent-1", priority: 100, users: { enabled: true } }] }),
      makeContext()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("accepts execution_identity.mode = obo_user without sub", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-1",
          priority: 100,
          users: { enabled: true },
          execution_identity: { mode: "obo_user" },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(200);
  });

  it("rejects mode = service_account with missing sub (400)", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-1",
          priority: 100,
          users: { enabled: true },
          execution_identity: { mode: "service_account" },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/service_account_sub.*required/i);
  });

  it("rejects mode = service_account with empty string sub (400)", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-1",
          priority: 100,
          users: { enabled: true },
          execution_identity: { mode: "service_account", service_account_sub: "  " },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/service_account_sub.*required/i);
  });

  it("rejects an invalid mode string (400)", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-1",
          priority: 100,
          users: { enabled: true },
          execution_identity: { mode: "unknown_mode" },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mode.*obo_user.*service_account/i);
  });

  it("accepts mode = service_account with valid sub and roundtrips to store", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-sa",
          priority: 50,
          users: { enabled: true },
          execution_identity: {
            mode: "service_account",
            service_account_sub: "sa-sub-abc",
            service_account_name: "incident-bot",
          },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(200);

    const [,, routesSent] = mockReplaceSlackChannelAgentRoutes.mock.calls[0];
    expect(routesSent).toHaveLength(1);
    expect(routesSent[0].execution_identity).toEqual({
      mode: "service_account",
      service_account_sub: "sa-sub-abc",
      service_account_name: "incident-bot",
    });
  });

  it("strips service_account fields when mode is obo_user", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-obo",
          priority: 100,
          users: { enabled: true },
          execution_identity: {
            mode: "obo_user",
            service_account_sub: "should-be-stripped",
          },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(200);
    const [,, routesSent] = mockReplaceSlackChannelAgentRoutes.mock.calls[0];
    expect(routesSent[0].execution_identity).toEqual({ mode: "obo_user" });
    expect(routesSent[0].execution_identity?.service_account_sub).toBeUndefined();
  });
});

// ── SEC-1 / TEST-8: service_account team-ownership checks ───────────────────

describe("PUT /routes — SEC-1 service_account team ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 when SA belongs to the channel's owning team", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-sa",
          priority: 50,
          users: { enabled: true },
          execution_identity: { mode: "service_account", service_account_sub: "sa-sub-abc" },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(200);
  });

  it("403 when SA belongs to a DIFFERENT team than the channel (team mismatch)", async () => {
    setupAuthPass();
    // Override: SA is owned by another team
    mockGetBySub.mockResolvedValue({
      ...VALID_SA_DOC,
      owning_team_id: "team-other",
    });

    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-sa",
          priority: 50,
          users: { enabled: true },
          execution_identity: { mode: "service_account", service_account_sub: "sa-sub-abc" },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/does not belong to this channel.*team/i);
  });

  it("403 when SA doc is not found (unknown sub)", async () => {
    setupAuthPass();
    mockGetBySub.mockResolvedValue(null);

    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-sa",
          priority: 50,
          users: { enabled: true },
          execution_identity: { mode: "service_account", service_account_sub: "sa-sub-nonexistent" },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not found or is revoked/i);
  });

  it("403 when SA is revoked", async () => {
    setupAuthPass();
    mockGetBySub.mockResolvedValue({
      ...VALID_SA_DOC,
      status: "revoked" as const,
    });

    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-sa",
          priority: 50,
          users: { enabled: true },
          execution_identity: { mode: "service_account", service_account_sub: "sa-sub-abc" },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not found or is revoked/i);
  });

  it("200 when no channel team mapping exists — SA existence still validated", async () => {
    setupAuthPass();
    // Channel has no team mapping yet
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });

    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-sa",
          priority: 50,
          users: { enabled: true },
          execution_identity: { mode: "service_account", service_account_sub: "sa-sub-abc" },
        }],
      }),
      makeContext()
    );
    // SA is active → passes, no team to compare against so we allow
    expect(res.status).toBe(200);
  });

  it("SEC-1 check is skipped entirely for obo_user routes (no SA lookup)", async () => {
    setupAuthPass();
    const res = await PUT(
      putRequest({
        routes: [{
          agent_id: "agent-obo",
          priority: 50,
          users: { enabled: true },
          execution_identity: { mode: "obo_user" },
        }],
      }),
      makeContext()
    );
    expect(res.status).toBe(200);
    // getBySub must not have been called for a non-SA route
    expect(mockGetBySub).not.toHaveBeenCalled();
  });
});

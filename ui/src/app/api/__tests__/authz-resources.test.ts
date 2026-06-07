/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockRequireRbac = jest.fn();
const mockReadTuples = jest.fn();
const mockToArray = jest.fn();

jest.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => mockGetServerSession(...a) }));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(message: string, public statusCode = 500, public code?: string) {
      super(message);
    }
  }
  return {
    ApiError,
    requireRbacPermission: (...a: unknown[]) => mockRequireRbac(...a),
    withErrorHandler:
      <T,>(h: (...a: unknown[]) => Promise<T>) =>
      async (...a: unknown[]) => {
        try {
          return await h(...a);
        } catch (e) {
          return Response.json(
            { success: false, error: e instanceof Error ? e.message : "error" },
            { status: (e as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});
jest.mock("@/lib/rbac/openfga", () => ({ readOpenFgaTuples: (...a: unknown[]) => mockReadTuples(...a) }));
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => ({
    find: () => ({ limit: () => ({ toArray: () => mockToArray(name) }) }),
  })),
}));
jest.mock("@/lib/rbac/slack-channel-grant-store", () => ({ slackChannelSubjectId: (w: string, c: string) => `${w}--${c}` }));
jest.mock("@/lib/rbac/webex-space-grant-store", () => ({ webexSpaceSubjectId: (w: string, s: string) => `${w}--${s}` }));

import { GET } from "../admin/authz/resources/route";

function req(qs = ""): NextRequest {
  return new NextRequest(new URL(`/api/admin/authz/resources${qs}`, "http://localhost:3000"));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: "admin@acme.com" }, sub: "admin", org: "acme" });
  mockRequireRbac.mockResolvedValue(undefined);
  mockToArray.mockResolvedValue([]);
});

it("returns distinct ids (label = id) for the requested type, filtering out other types/wildcards/usersets", async () => {
  mockReadTuples.mockResolvedValue({
    tuples: [
      { key: { object: "agent:pe" } },
      { key: { object: "agent:agent-sre-agent" } },
      { key: { object: "agent:pe" } }, // duplicate → deduped
      { key: { object: "agent:*" } }, // wildcard → excluded
      { key: { object: "team:eng" } }, // other type → excluded
      { key: { object: "skill:foo" } }, // other type → excluded
    ],
    continuationToken: undefined,
  });
  const res = await GET(req("?type=agent"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.resources).toEqual([
    { id: "agent-sre-agent", label: "agent-sre-agent" },
    { id: "pe", label: "pe" },
  ]);
  expect(mockReadTuples.mock.calls[0][0]?.tuple).toBeUndefined(); // no bare type-prefix filter
});

it("labels slack_channel ids with their canonical channel name", async () => {
  mockReadTuples.mockResolvedValue({
    tuples: [{ key: { object: "slack_channel:caipe--C06H2HEG6N" } }],
    continuationToken: undefined,
  });
  mockToArray.mockImplementation(async (name: string) =>
    name === "channel_team_mappings"
      ? [{ slack_workspace_id: "caipe", slack_channel_id: "C06H2HEG6N", channel_name: "platform-eng" }]
      : [],
  );
  const res = await GET(req("?type=slack_channel"));
  const body = await res.json();
  expect(body.resources).toEqual([{ id: "caipe--C06H2HEG6N", label: "platform-eng" }]);
});

it("rejects an unknown resource type with 400", async () => {
  const res = await GET(req("?type=nope"));
  expect(res.status).toBe(400);
  expect(mockReadTuples).not.toHaveBeenCalled();
});

it("returns 401 without a session", async () => {
  mockGetServerSession.mockResolvedValue(null);
  const res = await GET(req("?type=agent"));
  expect(res.status).toBe(401);
});

it("degrades to an empty catalog when OpenFGA read fails", async () => {
  mockReadTuples.mockRejectedValue(new Error("openfga down"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const res = await GET(req("?type=agent"));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ resources: [], error: "catalog_unavailable" });
  warn.mockRestore();
});

it("enforces the audit.view admin gate", async () => {
  mockReadTuples.mockResolvedValue({ tuples: [], continuationToken: undefined });
  await GET(req("?type=skill"));
  expect(mockRequireRbac).toHaveBeenCalledWith(expect.anything(), "admin_ui", "audit.view");
});

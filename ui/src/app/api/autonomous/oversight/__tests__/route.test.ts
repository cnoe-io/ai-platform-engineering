/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from "next/server";

const mockGetAuth = jest.fn();
const mockRequireRbac = jest.fn();
const mockGetCollection = jest.fn();
const mockLoadMembers = jest.fn();
const mockFetch = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error { statusCode: number; constructor(m: string, s = 500) { super(m); this.statusCode = s; } }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...a: unknown[]) => mockGetAuth(...a),
    requireRbacPermission: (...a: unknown[]) => mockRequireRbac(...a),
    successResponse: (data: unknown) => NextResponse.json({ success: true, data }),
    withErrorHandler:
      (h: (...a: unknown[]) => Promise<Response>) =>
      async (...a: unknown[]) => {
        try { return await h(...a); }
        catch (e) {
          return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : "error" },
            { status: e && typeof e === "object" && "statusCode" in e ? Number((e as { statusCode: number }).statusCode) : 500 },
          );
        }
      },
  };
});
jest.mock("@/lib/mongodb", () => ({ getCollection: (...a: unknown[]) => mockGetCollection(...a) }));
jest.mock("@/lib/rbac/team-membership-store", () => ({ loadTeamMembersForSlugs: (...a: unknown[]) => mockLoadMembers(...a) }));

import { GET } from "@/app/api/autonomous/oversight/route";

const req = () => new NextRequest("http://localhost/api/autonomous/oversight");

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as never;
  mockGetAuth.mockResolvedValue({ user: { email: "admin@x" }, session: { role: "admin", user: { email: "admin@x" } } });
  mockRequireRbac.mockResolvedValue(undefined);
  mockGetCollection.mockResolvedValue({ find: () => ({ project: () => ({ toArray: async () => [{ slug: "eng", name: "Eng" }] }) }) });
  mockLoadMembers.mockResolvedValue(new Map([["eng", [{ user_email: "a@x" }]]]));
  mockFetch.mockResolvedValue({ ok: true, json: async () => [{ id: "t1", name: "t1", owner_id: "a@x", enabled: true, trigger: { type: "cron" } }] });
});

it("returns grouped oversight data for an admin", async () => {
  const res = await GET(req());
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.data.teams[0].slug).toBe("eng");
  expect(body.data.teams[0].counts.total).toBe(1);
});

it("403s a non-admin", async () => {
  const { ApiError } = jest.requireMock("@/lib/api-middleware");
  mockRequireRbac.mockRejectedValue(new ApiError("forbidden", 403));
  const res = await GET(req());
  expect(res.status).toBe(403);
  expect(mockFetch).not.toHaveBeenCalled();
});

it("surfaces a downstream failure instead of a silent empty grid", async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  const res = await GET(req());
  const body = await res.json();
  expect(res.status).toBe(502);
  expect(body.success).toBe(false);
  expect(body.error).toMatch(/503/);
});

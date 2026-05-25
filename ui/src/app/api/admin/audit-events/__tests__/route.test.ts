/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
}));

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status = 500, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  return {
    ApiError,
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    withErrorHandler:
      <T,>(handler: (request: NextRequest, context?: unknown) => Promise<T>) =>
      (request: NextRequest, context?: unknown) =>
        handler(request, context),
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

interface TestAuditDoc {
  ts: Date;
  type: string;
  tenant_id: string;
  subject_hash: string;
  action: string;
  outcome: string;
  correlation_id: string;
  source: string;
}

const docs: TestAuditDoc[] = [
  {
    ts: new Date("2026-05-17T16:59:23.000Z"),
    type: "auth",
    tenant_id: "default",
    subject_hash: "hash-admin-view",
    action: "admin_ui#view",
    outcome: "allow",
    correlation_id: "admin-view-correlation",
    source: "webui_backend",
  },
  {
    ts: new Date("2026-05-17T16:59:24.000Z"),
    type: "auth",
    tenant_id: "default",
    subject_hash: "hash-audit-view",
    action: "admin_ui#audit.view",
    outcome: "allow",
    correlation_id: "audit-view-correlation",
    source: "webui_backend",
  },
  {
    ts: new Date("2026-05-17T16:59:25.000Z"),
    type: "auth",
    tenant_id: "default",
    subject_hash: "hash-supervisor",
    action: "supervisor#invoke",
    outcome: "allow",
    correlation_id: "supervisor-correlation",
    source: "webui_backend",
  },
];

function applyFilter(filter: Record<string, unknown>): TestAuditDoc[] {
  return docs.filter((doc) => {
    if (filter.type && doc.type !== filter.type) return false;
    const action = filter.action as { $ne?: string; $nin?: string[] } | undefined;
    if (action?.$ne && doc.action === action.$ne) return false;
    if (action?.$nin?.includes(doc.action)) return false;
    return true;
  });
}

function mockAuditCollection() {
  return {
    countDocuments: jest.fn(async (filter: Record<string, unknown>) => applyFilter(filter).length),
    find: jest.fn((filter: Record<string, unknown>) => {
      const filtered = applyFilter(filter);
      const chain = {
        sort: jest.fn(() => chain),
        skip: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        toArray: jest.fn(async () => filtered),
      };
      return chain;
    }),
  };
}

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    accessToken: "token",
    sub: "admin-sub",
    org: undefined,
    user: { email: "admin@example.com" },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockGetCollection.mockResolvedValue(mockAuditCollection());
});

describe("GET /api/admin/audit-events", () => {
  it("hides admin UI view authorization rows by default", async () => {
    const { GET } = await import("../route");

    const response = await GET(request("/api/admin/audit-events"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.records.map((record: TestAuditDoc) => record.action)).toEqual([
      "supervisor#invoke",
    ]);
  });

  it("includes admin UI view authorization rows when authorization type is explicitly selected", async () => {
    const { GET } = await import("../route");

    const response = await GET(request("/api/admin/audit-events?type=auth"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.records.map((record: TestAuditDoc) => record.action)).toEqual([
      "admin_ui#view",
      "admin_ui#audit.view",
      "supervisor#invoke",
    ]);
  });
});

/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

jest.mock("@/lib/agentic-apps/guard", () => ({
  requireAgenticAppsInstallEnabled: jest.fn(),
}));

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/agentic-apps/audit", () => ({
  queryAgenticAppAuditEvents: jest.fn(),
}));

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  requireAdminView: jest.fn(),
  withAuth: jest.fn(async (_request, handler) =>
    handler(_request, { email: "admin@example.com" }, { role: "admin" }),
  ),
  withErrorHandler: (handler: unknown) => handler,
}));

describe("GET /api/admin/agentic-apps/audit", () => {
  beforeEach(() => {
    const audit = jest.requireMock("@/lib/agentic-apps/audit") as {
      queryAgenticAppAuditEvents: jest.Mock;
    };
    audit.queryAgenticAppAuditEvents.mockReset().mockResolvedValue([
      { createdAt: "2026-05-09T00:00:00Z", type: "agentic_app.pdp.denied", appId: "weather" },
    ]);
  });

  it("returns filtered app platform audit events", async () => {
    const audit = jest.requireMock("@/lib/agentic-apps/audit") as {
      queryAgenticAppAuditEvents: jest.Mock;
    };
    const { GET } = await import("../route");

    const res = await GET(
      new Request(
        "http://localhost/api/admin/agentic-apps/audit?appId=weather&decisionId=dec-1&correlationId=corr-1&reasonCode=policy_denied&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [{ createdAt: "2026-05-09T00:00:00Z", type: "agentic_app.pdp.denied", appId: "weather" }],
    });
    expect(audit.queryAgenticAppAuditEvents).toHaveBeenCalledWith({
      appId: "weather",
      decisionId: "dec-1",
      correlationId: "corr-1",
      reasonCode: "policy_denied",
      type: undefined,
      limit: 10,
    });
  });
});

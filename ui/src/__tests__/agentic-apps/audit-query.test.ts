/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

const findMock = jest.fn();
const sortMock = jest.fn();
const limitMock = jest.fn();
const toArrayMock = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(() => ({
    find: findMock,
  })),
}));

describe("agentic app audit query helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findMock.mockReturnValue({ sort: sortMock });
    sortMock.mockReturnValue({ limit: limitMock });
    limitMock.mockReturnValue({ toArray: toArrayMock });
    toArrayMock.mockResolvedValue([{ type: "agentic_app.pdp.denied" }]);
  });

  it("queries by app id, decision id, correlation id, reason code, and redacts payloads", async () => {
    const { buildAgenticAppAuditEvent, queryAgenticAppAuditEvents } = await import("@/lib/agentic-apps/audit");

    expect(
      buildAgenticAppAuditEvent({
        type: "agentic_app.webhook.failed",
        appId: "weather",
        payload: { token: "secret", nested: { cookie: "raw" } },
      }).payload,
    ).toEqual({ token: "[REDACTED]", nested: { cookie: "[REDACTED]" } });

    await queryAgenticAppAuditEvents({
      appId: "weather",
      decisionId: "dec-1",
      correlationId: "corr-1",
      reasonCode: "policy_denied",
      limit: 500,
    });

    expect(findMock).toHaveBeenCalledWith({
      appId: "weather",
      decisionId: "dec-1",
      correlationId: "corr-1",
      reasonCode: "policy_denied",
    });
    expect(limitMock).toHaveBeenCalledWith(200);
  });
});

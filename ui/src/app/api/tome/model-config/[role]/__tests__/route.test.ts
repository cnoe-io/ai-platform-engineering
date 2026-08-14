/** @jest-environment node */

const mockGetServerSession = jest.fn();
const mockIsTomeAdmin = jest.fn();
const mockTestTomeModel = jest.fn();
const mockUpdateModelConfig = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/rbac/tome-admin", () => ({
  isTomeAdmin: (...args: unknown[]) => mockIsTomeAdmin(...args),
}));
jest.mock("@/lib/tome/guard", () => ({ isTomeServerEnabled: () => true }));
jest.mock("@/lib/tome/model-check", () => ({
  testTomeModel: (...args: unknown[]) => mockTestTomeModel(...args),
}));
jest.mock("@/lib/tome/model-config-store", () => {
  const actual = jest.requireActual("@/lib/tome/model-config-store");
  return {
    ...actual,
    updateModelConfig: (...args: unknown[]) => mockUpdateModelConfig(...args),
  };
});

import { PATCH } from "../route";

const context = { params: Promise.resolve({ role: "chat" }) };

describe("model config admin write API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { email: "admin@example.test" } });
    mockIsTomeAdmin.mockResolvedValue(true);
  });

  it("does not save when the required server-side model test fails", async () => {
    mockTestTomeModel.mockResolvedValue({ ok: false, error: "model unavailable" });
    const response = await PATCH(
      new Request("http://example.test/api/tome/model-config/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "model-candidate", scope_kind: "type", scope_id: "area" }),
      }) as never,
      context,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "MODEL_TEST_FAILED" });
    expect(mockUpdateModelConfig).not.toHaveBeenCalled();
  });

  it("saves a tested entity-type model with test provenance", async () => {
    mockTestTomeModel.mockResolvedValue({ ok: true });
    mockUpdateModelConfig.mockResolvedValue({
      _id: "type:area:chat",
      scope_kind: "type",
      scope_id: "area",
      role: "chat",
      model: "model-candidate",
      version: 1,
    });
    const response = await PATCH(
      new Request("http://example.test/api/tome/model-config/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "model-candidate", scope_kind: "type", scope_id: "area" }),
      }) as never,
      context,
    );

    expect(response.status).toBe(200);
    expect(mockTestTomeModel).toHaveBeenCalledWith("model-candidate");
    expect(mockUpdateModelConfig).toHaveBeenCalledWith(
      { kind: "type", id: "area" },
      "chat",
      "model-candidate",
      "admin@example.test",
      expect.any(String),
    );
  });

  it("rejects exact writes on the admin endpoint", async () => {
    const response = await PATCH(
      new Request("http://example.test/api/tome/model-config/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "model-candidate", scope_kind: "exact", scope_id: "entity-1" }),
      }) as never,
      context,
    );

    expect(response.status).toBe(422);
    expect(mockTestTomeModel).not.toHaveBeenCalled();
  });
});

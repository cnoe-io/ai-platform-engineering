/**
 * @jest-environment node
 */

const mockGetServerSession = jest.fn();
const mockIsTomeAdmin = jest.fn();
const mockIsTomeServerEnabled = jest.fn();
const mockGetDocumentParentModelStatus = jest.fn();
const mockRepairDocumentParentModel = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/rbac/tome-admin", () => ({
  isTomeAdmin: (...args: unknown[]) => mockIsTomeAdmin(...args),
}));
jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => mockIsTomeServerEnabled(),
}));
jest.mock("@/lib/rbac/openfga", () => ({
  getDocumentParentModelStatus: (...args: unknown[]) =>
    mockGetDocumentParentModelStatus(...args),
  repairDocumentParentModel: (...args: unknown[]) =>
    mockRepairDocumentParentModel(...args),
}));
jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
}));

import { GET, POST } from "../route";

describe("Tome OpenFGA model repair route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTomeServerEnabled.mockReturnValue(true);
    mockGetServerSession.mockResolvedValue({
      sub: "admin-subject",
      org: "example-org",
      user: { email: "admin@example.test" },
    });
    mockIsTomeAdmin.mockResolvedValue(true);
  });

  it("does not expose model status to non-admins", async () => {
    mockIsTomeAdmin.mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mockGetDocumentParentModelStatus).not.toHaveBeenCalled();
  });

  it("reports whether the active model needs repair", async () => {
    mockGetDocumentParentModelStatus.mockResolvedValue({
      healthy: false,
      activeModelId: "model-stale",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      healthy: false,
      activeModelId: "model-stale",
    });
  });

  it("repairs the model and audits the admin action", async () => {
    mockRepairDocumentParentModel.mockResolvedValue({
      healthy: true,
      activeModelId: "model-repaired",
      changed: true,
    });

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      healthy: true,
      activeModelId: "model-repaired",
      changed: true,
    });
    expect(mockAuditTome).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tome.openfga.document_parent.repair",
        actor: {
          type: "user",
          id: "admin-subject",
          email: "admin@example.test",
        },
        tenantId: "example-org",
        metadata: {
          changed: true,
          active_model_id: "model-repaired",
        },
      }),
    );
  });

  it("returns a sanitized error when repair cannot be applied safely", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockRepairDocumentParentModel.mockRejectedValue(
      new Error("internal OpenFGA response"),
    );

    const response = await POST();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Could not repair the active OpenFGA model",
    });
    expect(mockAuditTome).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

/** @jest-environment node */

const getServerSession = jest.fn();
const isTomeAdmin = jest.fn();
const isTomeServerEnabled = jest.fn();
const getAutoIngestCredentialHealth = jest.fn();
const refreshAutoIngestCredentialHealth = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/rbac/tome-admin", () => ({
  isTomeAdmin: (...args: unknown[]) => isTomeAdmin(...args),
}));
jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => isTomeServerEnabled(),
}));
jest.mock("@/lib/tome/auto-ingest/credential-health", () => ({
  AUTO_INGEST_CREDENTIAL_REFRESH_INTERVAL_MS: 300_000,
  getAutoIngestCredentialHealth: (...args: unknown[]) =>
    getAutoIngestCredentialHealth(...args),
  refreshAutoIngestCredentialHealth: (...args: unknown[]) =>
    refreshAutoIngestCredentialHealth(...args),
}));

import { GET, POST } from "../route";

const snapshot = {
  generatedAt: "2026-08-13T18:00:00.000Z",
  refreshIntervalMs: 300_000,
  rows: [],
  summary: { projects: 0, healthy: 0, attention: 0, missing: 0 },
};

beforeEach(() => {
  jest.clearAllMocks();
  isTomeServerEnabled.mockReturnValue(true);
  getServerSession.mockResolvedValue({
    sub: "admin-subject",
    user: { email: "admin@example.test" },
  });
  isTomeAdmin.mockResolvedValue(true);
  getAutoIngestCredentialHealth.mockResolvedValue(snapshot);
  refreshAutoIngestCredentialHealth.mockResolvedValue(undefined);
});

describe("/api/tome/admin/auto-ingest-credentials", () => {
  it("returns read-only token health metadata to a Tome admin", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ health: snapshot });
    expect(getAutoIngestCredentialHealth).toHaveBeenCalledWith(300_000);
    expect(refreshAutoIngestCredentialHealth).not.toHaveBeenCalled();
  });

  it("refreshes tokens on demand before returning the new snapshot", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(refreshAutoIngestCredentialHealth).toHaveBeenCalledTimes(1);
    expect(getAutoIngestCredentialHealth).toHaveBeenCalledTimes(1);
  });

  it("rejects an unauthenticated request", async () => {
    getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(getAutoIngestCredentialHealth).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-admin", async () => {
    isTomeAdmin.mockResolvedValue(false);

    const response = await POST();

    expect(response.status).toBe(403);
    expect(refreshAutoIngestCredentialHealth).not.toHaveBeenCalled();
  });

  it("hides the endpoint when Tome is disabled", async () => {
    isTomeServerEnabled.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(404);
    expect(getServerSession).not.toHaveBeenCalled();
  });
});

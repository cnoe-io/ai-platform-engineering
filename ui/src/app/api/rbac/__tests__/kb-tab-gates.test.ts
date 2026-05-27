/**
 * @jest-environment node
 */
/**
 * Tests for GET /api/rbac/kb-tab-gates.
 *
 * Covers the Knowledge sidebar tab-gating contract:
 * - Org admins short-circuit and see every tab.
 * - Non-admins with at least one readable KB see Search / Data Sources /
 *   Graph / MCP Tools.
 * - Non-admins with zero readable KBs see no tabs and have_any_kb=false.
 * - The `RAG_ADMIN_BYPASS_DISABLED` env var disables the org-admin
 *   short-circuit and forces a per-resource path.
 * - The route fails closed (all tabs hidden) on RAG / OpenFGA errors.
 */

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
}));

const mockCheckOpenFgaTuple = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/rbac/organization", () => ({
  organizationObjectId: () => "organization:caipe",
}));

const mockFilterResourcesByPermission = jest.fn();
jest.mock("@/lib/rbac/resource-authz", () => ({
  filterResourcesByPermission: (...args: unknown[]) => mockFilterResourcesByPermission(...args),
}));

import { getServerSession } from "next-auth";
import { isBootstrapAdmin } from "@/lib/auth-config";
import { GET } from "@/app/api/rbac/kb-tab-gates/route";

describe("GET /api/rbac/kb-tab-gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isBootstrapAdmin as jest.Mock).mockReturnValue(false);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    mockFilterResourcesByPermission.mockImplementation(async (_session, resources) => resources);
    delete process.env.RAG_ADMIN_BYPASS_DISABLED;
    process.env.RAG_SERVER_URL = "http://rag.test";
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ datasources: [] }),
      } as Response),
    ) as jest.Mock;
  });

  it("returns 401 when no session", async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("org admin (OpenFGA) sees every tab and reports kb_count=-1", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({
      accessToken: "tok",
      sub: "admin-sub",
      user: { email: "admin@example.com" },
    });
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toEqual({
      gates: {
        search: true,
        data_sources: true,
        graph: true,
        mcp_tools: true,
        has_any_kb: true,
        kb_count: -1,
      },
      org_admin_bypass: true,
    });
    // The route MUST NOT hit RAG when the org-admin bypass short-circuits.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockFilterResourcesByPermission).not.toHaveBeenCalled();
  });

  it("bootstrap-admin email is treated as org admin even without OpenFGA tuple", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({
      accessToken: "tok",
      sub: "boot-sub",
      user: { email: "bootstrap@example.com" },
    });
    (isBootstrapAdmin as jest.Mock).mockReturnValue(true);

    const res = await GET();
    const body = await res.json();
    expect(body.org_admin_bypass).toBe(true);
    expect(body.gates.has_any_kb).toBe(true);
    // OpenFGA is never queried when bootstrap-admin short-circuits.
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
  });

  it("non-admin with one readable KB sees all tabs and kb_count=1", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({
      accessToken: "tok",
      sub: "alice-sub",
      user: { email: "alice@example.com" },
    });
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ datasources: [{ datasource_id: "kb-alpha" }] }),
    });
    mockFilterResourcesByPermission.mockResolvedValueOnce([{ datasource_id: "kb-alpha" }]);

    const res = await GET();
    const body = await res.json();

    expect(body.org_admin_bypass).toBe(false);
    expect(body.gates).toEqual({
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: true,
      kb_count: 1,
    });
    // The KB-count probe MUST NOT take the org-admin shortcut — the
    // ReBAC count is exactly what we want to report to the sidebar.
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      expect.any(Object),
      [{ datasource_id: "kb-alpha" }],
      expect.objectContaining({ type: "knowledge_base", action: "read" }),
      { bypassForOrgAdmin: false },
    );
  });

  it("non-admin with zero readable KBs sees no tabs and has_any_kb=false", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({
      accessToken: "tok",
      sub: "newbie-sub",
      user: { email: "newbie@example.com" },
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ datasources: [{ datasource_id: "kb-x" }, { datasource_id: "kb-y" }] }),
    });
    mockFilterResourcesByPermission.mockResolvedValueOnce([]);

    const res = await GET();
    const body = await res.json();

    expect(body.gates).toEqual({
      search: false,
      data_sources: false,
      graph: false,
      mcp_tools: false,
      has_any_kb: false,
      kb_count: 0,
    });
  });

  it("RAG_ADMIN_BYPASS_DISABLED=true disables the org-admin short-circuit", async () => {
    process.env.RAG_ADMIN_BYPASS_DISABLED = "true";
    (getServerSession as jest.Mock).mockResolvedValue({
      accessToken: "tok",
      sub: "admin-sub",
      user: { email: "admin@example.com" },
    });
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ datasources: [{ datasource_id: "kb-1" }] }),
    });
    mockFilterResourcesByPermission.mockResolvedValueOnce([{ datasource_id: "kb-1" }]);

    const res = await GET();
    const body = await res.json();
    expect(body.org_admin_bypass).toBe(false);
    expect(body.gates.kb_count).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when RAG /v1/datasources returns a 5xx", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({
      accessToken: "tok",
      sub: "alice-sub",
      user: { email: "alice@example.com" },
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const res = await GET();
    const body = await res.json();
    expect(body.gates.has_any_kb).toBe(false);
    expect(body.gates.kb_count).toBe(0);
  });

  it("returns empty gates when the session has no access token", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({
      sub: "no-token-sub",
      user: { email: "no-token@example.com" },
    });
    const res = await GET();
    const body = await res.json();
    expect(body.gates.has_any_kb).toBe(false);
    expect(body.org_admin_bypass).toBe(false);
  });
});

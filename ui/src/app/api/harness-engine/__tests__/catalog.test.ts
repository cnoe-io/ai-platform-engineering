/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { GET } from "../harnesses/route";

const mockAuth = jest.fn();
const mockNativeCatalog = jest.fn();
const mockConfig = jest.fn();
const mockEngine = jest.fn();

jest.mock("@/lib/da-proxy", () => ({ authenticateRequest: (...args: unknown[]) => mockAuth(...args) }));
jest.mock("@/lib/dynamic-agents/runtime-profiles", () => ({ loadRuntimeCatalog: (...args: unknown[]) => mockNativeCatalog(...args) }));
jest.mock("@/lib/harness-engine-proxy", () => ({
  getHarnessEngineConfig: () => mockConfig(), proxyHarnessEngine: (...args: unknown[]) => mockEngine(...args),
}));

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.mockResolvedValue({ subject: "test-user" });
  mockConfig.mockReturnValue(NextResponse.json({ error: "Engine unavailable" }, { status: 503 }));
  mockNativeCatalog.mockResolvedValue({ profiles: [{ id: "primary", name: "Primary", harness: "claude-code", revision: "profile-v1",
    capabilities: { mcp: true, skills: false, attachments: true } }] });
});

it("keeps admitted native coding profiles available without Harness Engine", async () => {
  const response = await GET(new NextRequest("https://example.test/api/harness-engine/harnesses"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.catalog_revision).toBeNull();
  expect(body.data.harnesses).toHaveLength(1);
  expect(body.data.harnesses[0].profiles.map((profile: { native_execution: unknown }) => profile.native_execution)).toEqual([
    { kind: "native" }, { kind: "sandbox", profile_id: "primary" },
  ]);
  expect(body.data.harnesses[0].native_runtime_catalog.profiles[0].revision).toBe("profile-v1");
  expect(mockEngine).not.toHaveBeenCalled();
});

it("preserves the Engine validation revision while composing native profiles", async () => {
  mockConfig.mockReturnValue({ url: "http://engine.example.test", internalToken: "test" });
  mockEngine.mockResolvedValue(Response.json({ success: true, data: {
    contract_version: 1, catalog_revision: "engine-exact-revision",
    harnesses: [{ id: "agentcore", display_name: "AgentCore" }, { id: "dynamic_agents", display_name: "untrusted duplicate" }],
  } }));
  const body = await (await GET(new NextRequest("https://example.test/api/harness-engine/harnesses"))).json();
  expect(body.data.catalog_revision).toBe("engine-exact-revision");
  expect(body.data.harnesses.map((descriptor: { id: string }) => descriptor.id)).toEqual(["dynamic_agents", "agentcore"]);
});

it("returns managed-only native profiles with an explicit outage state", async () => {
  mockNativeCatalog.mockRejectedValue(new Error("profile service unavailable"));
  const body = await (await GET(new NextRequest("https://example.test/api/harness-engine/harnesses"))).json();
  expect(body.data.harnesses[0].profiles.map((profile: { id: string }) => profile.id)).toEqual(["native"]);
  expect(body.data.harnesses[0].runtime_catalog_unavailable).toBe(true);
});

it("does not load either catalog before authentication", async () => {
  mockAuth.mockResolvedValue(NextResponse.json({ error: "Unauthenticated" }, { status: 401 }));
  expect((await GET(new NextRequest("https://example.test/api/harness-engine/harnesses"))).status).toBe(401);
  expect(mockNativeCatalog).not.toHaveBeenCalled();
  expect(mockConfig).not.toHaveBeenCalled();
});

/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { loadRuntimeCatalog, loadRuntimeProfiles, normalizeAgentExecution, parseRuntimeCatalog, parseRuntimeProfiles, validateAgentExecution } from "../runtime-profiles";

const mockAuthenticate = jest.fn();
jest.mock("@/lib/da-proxy", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getDynamicAgentsConfig: () => ({ dynamicAgentsUrl: "https://runtime.example.test/base" }),
  buildBackendHeaders: (_type: string, auth: { bearerToken: string }) => ({ Authorization: `Bearer ${auth.bearerToken}` }),
}));
jest.mock("@/lib/api-middleware", () => ({
  ApiError: class extends Error { constructor(message: string, public statusCode: number, public code: string) { super(message); } },
}));
const profile = { id: "primary", name: "Primary", harness: "claude-code", revision: "v1", capabilities: { mcp: true, skills: false, attachments: true } };
const request = () => new NextRequest("https://ui.example.test/api/dynamic-agents/runtime-profiles?url=https://untrusted.example.test");

beforeEach(() => {
  mockAuthenticate.mockResolvedValue({ bearerToken: "test-token" });
  global.fetch = jest.fn().mockImplementation(async () => Response.json({ profiles: [profile] }));
});
afterEach(() => jest.restoreAllMocks());

it("uses the fixed authenticated catalog and exposes only public profile metadata", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(Response.json({ profiles: [{ ...profile, command: "private", env: { secret: "private" }, endpoint: "private" }] }));
  expect(await loadRuntimeProfiles(request())).toEqual([profile]);
  expect(global.fetch).toHaveBeenCalledWith(new URL("https://runtime.example.test/api/v1/runtime-profiles"), expect.objectContaining({ cache: "no-store", headers: { Authorization: "Bearer test-token" } }));
});
it("does not fetch profiles for native execution and preserves its default", async () => {
  expect(normalizeAgentExecution(undefined)).toEqual({ kind: "native" });
  await validateAgentExecution(request(), { kind: "native" });
  expect(global.fetch).not.toHaveBeenCalled();
});
it.each([null, { kind: "sandbox", profile_id: "https://remote.example.test" }, { kind: "native", command: "run" }, { kind: "sandbox", profile_id: "primary", env: {} }])("rejects untrusted execution configuration %p", (value) => {
  expect(() => normalizeAgentExecution(value)).toThrow();
});
it("denies non-admitted profiles before persistence", async () => {
  await expect(validateAgentExecution(request(), { kind: "sandbox", profile_id: "retired" })).rejects.toMatchObject({ code: "RUNTIME_PROFILE_NOT_ADMITTED" });
  await expect(validateAgentExecution(request(), { kind: "sandbox", profile_id: "primary" })).resolves.toBeUndefined();
});
it("rejects malformed or duplicate catalog entries rather than publishing partial admission", () => {
  expect(() => parseRuntimeProfiles({ profiles: [profile, profile] })).toThrow();
  expect(() => parseRuntimeProfiles({ profiles: [{ ...profile, capabilities: { mcp: true } }] })).toThrow();
});
it("refuses deferred harnesses rather than admitting them through a stale catalog", () => {
  expect(() => parseRuntimeProfiles({ profiles: [{ ...profile, harness: "codex" }] })).toThrow();
});
it("stops before backend access for an unauthorized caller", async () => {
  mockAuthenticate.mockResolvedValue(NextResponse.json({}, { status: 401 }));
  await expect(loadRuntimeProfiles(request())).rejects.toMatchObject({ statusCode: 401 });
  expect(global.fetch).not.toHaveBeenCalled();
});
it("fails closed on catalog failure without forwarding its body", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(Response.json({ error: "private failure detail" }, { status: 500 }));
  await expect(loadRuntimeProfiles(request())).rejects.toMatchObject({ statusCode: 503, message: "Runtime profiles are temporarily unavailable" });
});

it("bounds catalog bytes and refuses redirects while forwarding authority", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(new Response("x".repeat(256 * 1024 + 1)));
  await expect(loadRuntimeProfiles(request())).rejects.toMatchObject({ statusCode: 502, code: "INVALID_RUNTIME_PROFILES" });
  expect(global.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "error" }));
});

it("rejects saved skills unsupported by the admitted profile", async () => {
  await expect(validateAgentExecution(request(), { kind: "sandbox", profile_id: "primary" }, ["example-skill"])).rejects.toMatchObject({ code: "RUNTIME_SKILLS_UNSUPPORTED" });
});

const managedContract = { tier: "1", runtime: "deepagents", filesystem: "logical", workspace_scope: "conversation", isolation: "shared-runtime", policy_authority: "caipe" };
const privateContract = { tier: "3", runtime: "coding-harness", filesystem: "sandbox", workspace_scope: "conversation", isolation: "private-sandbox", policy_authority: "caipe-and-operator-profile" };
const tiers = (privateAvailable = true) => [
  { tier: "1", name: "Managed runtime", status: "supported", selectable: true, runtime_contract: managedContract },
  { tier: "3", name: "Private runtime", status: "supported", selectable: privateAvailable, runtime_contract: privateContract },
];

it("projects supported runtime contracts without private provider fields", async () => {
  const catalog = { profiles: [{ ...profile, runtime_contract: { ...privateContract, command: "private" } }], tiers: tiers().map(tier => ({ ...tier, endpoint: "private" })) };
  (global.fetch as jest.Mock).mockResolvedValue(Response.json(catalog));
  expect(await loadRuntimeCatalog(request())).toEqual({ profiles: [{ ...profile, runtime_contract: privateContract }], tiers: tiers() });
});

it("keeps a legacy catalog and its saved execution shape unchanged", () => {
  expect(parseRuntimeCatalog({ profiles: [profile] })).toEqual({ profiles: [profile] });
  expect(normalizeAgentExecution({ kind: "sandbox", profile_id: "primary" })).toEqual({ kind: "sandbox", profile_id: "primary" });
  expect(() => normalizeAgentExecution({ kind: "sandbox", profile_id: "primary", runtime_contract: privateContract })).toThrow();
  expect(() => normalizeAgentExecution({ kind: "native", tier: "2" })).toThrow();
});

it("retains the managed contract when no private profile is admitted", () => {
  expect(parseRuntimeCatalog({ profiles: [], tiers: tiers(false) })).toEqual({ profiles: [], tiers: tiers(false) });
});

it.each([
  { workspace_scope: "user" }, { workspace_scope: "team" }, { workspace_scope: "global" },
  { tier: "2" }, { runtime: "deepagents" }, { filesystem: "logical" },
])("refuses unsupported or mixed execution claims %p", (override) => {
  expect(() => parseRuntimeCatalog({ profiles: [{ ...profile, runtime_contract: { ...privateContract, ...override } }] })).toThrow();
});

it.each(["2", "2.5", "4", "unknown", 1, null])("rejects unimplemented or unknown runtime tier %p", (tier) => {
  expect(() => parseRuntimeCatalog({ profiles: [profile], tiers: [{ ...tiers()[0], tier }] })).toThrow();
});

it.each(["planned", "research", "unknown"])("rejects unsupported runtime status %p", (status) => {
  expect(() => parseRuntimeCatalog({ profiles: [profile], tiers: [{ ...tiers()[0], status }] })).toThrow();
});

it("rejects inconsistent admission, duplicate tiers and oversized tier catalogs", () => {
  const catalog = tiers();
  expect(() => parseRuntimeCatalog({ profiles: [], tiers: catalog })).toThrow();
  expect(() => parseRuntimeCatalog({ profiles: [profile], tiers: [{ ...catalog[0], selectable: false }, catalog[1]] })).toThrow();
  expect(() => parseRuntimeCatalog({ profiles: [profile], tiers: [catalog[0], catalog[0]] })).toThrow();
  expect(() => parseRuntimeCatalog({ profiles: [profile], tiers: [...catalog, catalog[0]] })).toThrow();
  expect(() => parseRuntimeCatalog({ profiles: [profile], tiers: [{ ...catalog[0], runtime_contract: privateContract }] })).toThrow();
});

import { ApiError } from "@/lib/api-middleware";
import { authenticateRequest, buildBackendHeaders, getDynamicAgentsConfig } from "@/lib/da-proxy";
import { readBoundedBody } from "@/lib/dynamic-agents/bounded-body";
import type { AgentExecution, AgentRuntimeCatalog, AgentRuntimeContract, AgentRuntimeOption, AgentRuntimeProfile } from "@/types/dynamic-agent";
import { NextRequest, NextResponse } from "next/server";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export { normalizeAgentExecution } from "./execution-config";

function invalidCatalog(): never {
  throw new ApiError("Runtime profiles are temporarily unavailable", 502, "INVALID_RUNTIME_PROFILES");
}

function parseRuntimeContract(value: unknown, kind: "native" | "sandbox"): AgentRuntimeContract {
  if (!record(value)) return invalidCatalog();
  const expected: AgentRuntimeContract = kind === "native"
    ? { kind: "native", runtime: "deepagents", filesystem: "logical", workspace_scope: "conversation",
        isolation: "shared-runtime", policy_authority: "caipe" }
    : { kind: "sandbox", runtime: "coding-harness", filesystem: "sandbox", workspace_scope: "conversation",
        isolation: "private-sandbox", policy_authority: "caipe-and-operator-profile" };
  if (Object.entries(expected).some(([key, entry]) => value[key] !== entry)) return invalidCatalog();
  return expected;
}

/** Project the public catalog explicitly; never forward provider commands or credentials. */
function parseProfiles(value: unknown): AgentRuntimeProfile[] {
  if (!record(value) || !Array.isArray(value.profiles) || value.profiles.length > 100) {
    throw new ApiError("Runtime profiles are temporarily unavailable", 502, "INVALID_RUNTIME_PROFILES");
  }
  const ids = new Set<string>();
  return value.profiles.map((entry: unknown) => {
    if (!record(entry) || typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(entry.id) || ids.has(entry.id) ||
        typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 200 ||
        entry.harness !== "claude-code" ||
        typeof entry.revision !== "string" || !entry.revision || entry.revision.length > 256 ||
        !record(entry.capabilities) || ["mcp", "skills", "attachments"].some((key) => typeof (entry.capabilities as Record<string, unknown>)[key] !== "boolean")) {
      throw new ApiError("Runtime profiles are temporarily unavailable", 502, "INVALID_RUNTIME_PROFILES");
    }
    ids.add(entry.id);
    return {
      id: entry.id, name: entry.name, harness: entry.harness as AgentRuntimeProfile["harness"], revision: entry.revision,
      ...(entry.runtime_contract === undefined ? {} : { runtime_contract: parseRuntimeContract(entry.runtime_contract, "sandbox") as Extract<AgentRuntimeContract, { kind: "sandbox" }> }),
      capabilities: { mcp: entry.capabilities.mcp as boolean, skills: entry.capabilities.skills as boolean, attachments: entry.capabilities.attachments as boolean },
    };
  });
}


/** Preserve legacy profiles while projecting only bounded, descriptive runtime metadata. */
export function parseRuntimeCatalog(value: unknown): AgentRuntimeCatalog {
  const profiles = parseProfiles(value);
  if (!record(value) || value.runtimes === undefined) return { profiles };
  if (!Array.isArray(value.runtimes) || value.runtimes.length > 2) return invalidCatalog();
  const ids = new Set<string>();
  const runtimes: AgentRuntimeOption[] = value.runtimes.map((entry: unknown) => {
    if (!record(entry) || (entry.kind !== "native" && entry.kind !== "sandbox") || ids.has(entry.kind) ||
        typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 200 || typeof entry.selectable !== "boolean" ||
        entry.status !== "supported") return invalidCatalog();
    ids.add(entry.kind);
    if (entry.kind === "native" && !entry.selectable || entry.kind === "sandbox" && entry.selectable !== (profiles.length > 0)) return invalidCatalog();
    return { kind: entry.kind, name: entry.name, status: entry.status, selectable: entry.selectable,
      runtime_contract: parseRuntimeContract(entry.runtime_contract, entry.kind) };
  });
  return { profiles, runtimes };
}

export function parseRuntimeProfiles(value: unknown): AgentRuntimeProfile[] {
  return parseRuntimeCatalog(value).profiles;
}
export async function loadRuntimeCatalog(request: NextRequest): Promise<AgentRuntimeCatalog> {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) throw new ApiError("Runtime profile access denied", auth.status, "RUNTIME_PROFILE_ACCESS_DENIED");
  const config = getDynamicAgentsConfig();
  if (config instanceof NextResponse) throw new ApiError("Runtime profiles are not configured", 503, "RUNTIME_PROFILES_UNAVAILABLE");
  let response: Response;
  try {
    response = await fetch(new URL("/api/v1/runtime-profiles", config.dynamicAgentsUrl), {
      headers: buildBackendHeaders("application/json", auth), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.warn("[runtime-profiles] Catalog request failed", { errorType: error instanceof Error ? error.name : "Unknown" });
    throw new ApiError("Runtime profiles are temporarily unavailable", 503, "RUNTIME_PROFILES_UNAVAILABLE");
  }
  if (!response.ok) throw new ApiError("Runtime profiles are temporarily unavailable", response.status === 401 || response.status === 403 ? response.status : 503, "RUNTIME_PROFILES_UNAVAILABLE");
  try { return parseRuntimeCatalog(JSON.parse(await readBoundedBody(response.body, 256 * 1024))); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Runtime profiles are temporarily unavailable", 502, "INVALID_RUNTIME_PROFILES");
  }
}

export async function loadRuntimeProfiles(request: NextRequest): Promise<AgentRuntimeProfile[]> {
  return (await loadRuntimeCatalog(request)).profiles;
}

export async function validateAgentExecution(request: NextRequest, execution: AgentExecution, skills?: unknown): Promise<void> {
  if (execution.kind === "native") return;
  const profiles = await loadRuntimeProfiles(request);
  const profile = profiles.find((profile) => profile.id === execution.profile_id);
  if (!profile) {
    throw new ApiError("This runtime profile is no longer available. Select another runtime.", 400, "RUNTIME_PROFILE_NOT_ADMITTED");
  }
  if (Array.isArray(skills) && skills.length > 0 && !profile.capabilities.skills) {
    throw new ApiError("This runtime profile does not support the selected skills. Choose a qualified profile or clear the skill selection.", 400, "RUNTIME_SKILLS_UNSUPPORTED");
  }
}

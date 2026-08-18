import { createHmac } from "crypto";

import type { AuthorizeRequest, AuthorizeResult } from "./contract";
import type { EvaluationPurpose, TimedAuthorizeResult } from "./client";

export type MigrationMode = "LEGACY" | "SHADOW" | "CANARY" | "AUTHZ" | "AUTHZ_ONLY";

interface MigrationScope {
  surface: string;
  resource_type: string;
  action: string;
  exact_resources?: string[];
  subject_types?: string[];
  mode: MigrationMode;
  canary_percent?: number;
  expression_mode?: "off" | "shadow" | "enforce";
  owner?: string;
}

export interface MigrationRevision {
  revision: string;
  default_mode: MigrationMode;
  canary_seed: string;
  shadow_timeout_ms?: number;
  scopes: MigrationScope[];
}

export interface RoutedDecision {
  result: AuthorizeResult;
  authoritativePath: "LEGACY" | "AUTHZ";
  configuredMode: MigrationMode;
  revision: string;
}

export interface Comparison {
  request: AuthorizeRequest;
  revision: string;
  authoritativePath: "LEGACY" | "AUTHZ";
  legacy: TimedAuthorizeResult;
  authz: TimedAuthorizeResult;
}

const MODES = new Set<MigrationMode>(["LEGACY", "SHADOW", "CANARY", "AUTHZ", "AUTHZ_ONLY"]);
const DEFAULT_REVISION: MigrationRevision = {
  revision: "legacy-default",
  default_mode: "LEGACY",
  canary_seed: "default-disabled-canary-seed",
  scopes: [],
};

let cachedRaw: string | undefined;
let cachedRevision = DEFAULT_REVISION;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMigrationRevision(raw = process.env.AUTHZ_ROLLOUT_JSON ?? ""): MigrationRevision {
  if (!raw.trim()) return DEFAULT_REVISION;
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error("AUTHZ_ROLLOUT_JSON must be an object");
  const allowed = new Set(["revision", "default_mode", "canary_seed", "shadow_timeout_ms", "scopes"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("unknown rollout field");
  if (typeof value.revision !== "string" || !value.revision) throw new Error("rollout revision is required");
  if (typeof value.canary_seed !== "string" || value.canary_seed.length < 16) throw new Error("canary seed is invalid");
  if (!MODES.has(value.default_mode as MigrationMode)) throw new Error("default migration mode is invalid");
  if (!Array.isArray(value.scopes)) throw new Error("rollout scopes must be an array");
  if (value.shadow_timeout_ms != null && (!Number.isInteger(value.shadow_timeout_ms) || Number(value.shadow_timeout_ms) < 10 || Number(value.shadow_timeout_ms) > 5000)) throw new Error("shadow timeout is invalid");
  const scopes = value.scopes.map((item) => {
    if (!isRecord(item)) throw new Error("rollout scope must be an object");
    const scopeAllowed = new Set(["surface", "resource_type", "action", "exact_resources", "subject_types", "mode", "canary_percent", "expression_mode", "owner"]);
    if (Object.keys(item).some((key) => !scopeAllowed.has(key))) throw new Error("unknown rollout scope field");
    if (typeof item.surface !== "string" || typeof item.resource_type !== "string" || typeof item.action !== "string") throw new Error("rollout scope selector is invalid");
    if (!MODES.has(item.mode as MigrationMode)) throw new Error("rollout scope mode is invalid");
    const percent = Number(item.canary_percent ?? 0);
    if (item.mode === "CANARY" && !(percent > 0 && percent <= 100)) throw new Error("CANARY requires a valid percentage");
    const expressionMode = item.expression_mode ?? "off";
    if (!["off", "shadow", "enforce"].includes(String(expressionMode))) throw new Error("expression mode is invalid");
    if (expressionMode === "enforce" && !["AUTHZ", "AUTHZ_ONLY"].includes(String(item.mode))) throw new Error("expression enforcement requires Authz authority");
    if (expressionMode === "enforce" && (typeof item.owner !== "string" || !item.owner.trim())) throw new Error("expression enforcement requires an owner");
    if (expressionMode !== "off" && (
      item.surface !== "agentgateway" || item.resource_type !== "tool" || item.action !== "invoke" ||
      !Array.isArray(item.exact_resources) || item.exact_resources.length === 0
    )) throw new Error("expression rollout requires exact AgentGateway tool scopes");
    return item as unknown as MigrationScope;
  });
  return { ...(value as unknown as MigrationRevision), scopes };
}

export function currentMigrationRevision(): MigrationRevision {
  const raw = process.env.AUTHZ_ROLLOUT_JSON ?? "";
  if (raw !== cachedRaw) {
    cachedRevision = parseMigrationRevision(raw);
    cachedRaw = raw;
  }
  return cachedRevision;
}

export function cohortBucket(revision: MigrationRevision, req: AuthorizeRequest): number {
  const message = [revision.revision, "bff", `${req.subject.type}:${req.subject.id}`, req.resource.type, req.resource.id, req.action].join("\x1f");
  const digest = createHmac("sha256", revision.canary_seed).update(message).digest();
  return Number(digest.readBigUInt64BE(0) % BigInt(10000));
}

export function scopeFor(revision: MigrationRevision, req: AuthorizeRequest): MigrationScope | undefined {
  const matches = revision.scopes.filter((scope) =>
    scope.surface === "bff" && scope.resource_type === req.resource.type && scope.action === req.action &&
    (!scope.exact_resources?.length || scope.exact_resources.includes(req.resource.id)) &&
    (!scope.subject_types?.length || scope.subject_types.includes(req.subject.type))
  );
  matches.sort((left, right) => Number(Boolean(right.exact_resources?.length)) + Number(Boolean(right.subject_types?.length)) - Number(Boolean(left.exact_resources?.length)) - Number(Boolean(left.subject_types?.length)));
  if (matches.length > 1) {
    const specificity = (scope: MigrationScope) => Number(Boolean(scope.exact_resources?.length)) + Number(Boolean(scope.subject_types?.length));
    if (specificity(matches[0]) === specificity(matches[1])) throw new Error("ambiguous migration scopes");
  }
  return matches[0];
}

export function modeFor(revision: MigrationRevision, req: AuthorizeRequest): MigrationMode {
  const scope = scopeFor(revision, req);
  const configured = scope?.mode ?? revision.default_mode;
  if (configured !== "CANARY") return configured;
  return cohortBucket(revision, req) < Math.round((scope?.canary_percent ?? 0) * 100) ? "AUTHZ" : "SHADOW";
}

function timed(result: AuthorizeResult, started: number): TimedAuthorizeResult {
  return { result, durationMs: performance.now() - started, error: result.reason === "AUTHZ_UNAVAILABLE" };
}

export async function routeAuthorization(
  req: AuthorizeRequest,
  legacy: () => Promise<AuthorizeResult>,
  authz: (purpose: EvaluationPurpose, timeoutMs: number) => Promise<TimedAuthorizeResult>,
  compare?: (comparison: Comparison) => void,
  revision = currentMigrationRevision(),
): Promise<RoutedDecision> {
  const configuredMode = scopeFor(revision, req)?.mode ?? revision.default_mode;
  const mode = modeFor(revision, req);
  if (mode === "LEGACY") {
    return { result: await legacy(), authoritativePath: "LEGACY", configuredMode, revision: revision.revision };
  }
  if (mode === "SHADOW") {
    const started = performance.now();
    const legacyResult = await legacy();
    void authz("shadow", revision.shadow_timeout_ms ?? 100).then((authzResult) => compare?.({
      request: req,
      revision: revision.revision,
      authoritativePath: "LEGACY",
      legacy: timed(legacyResult, started),
      authz: authzResult,
    }));
    return { result: legacyResult, authoritativePath: "LEGACY", configuredMode, revision: revision.revision };
  }
  const legacyStarted = performance.now();
  const legacyPromise = mode === "AUTHZ" ? legacy().then((result) => timed(result, legacyStarted)) : undefined;
  const authzResult = await authz(
    "authoritative",
    Number(process.env.AUTHZ_HTTP_TIMEOUT_MS ?? 500),
  );
  if (legacyPromise) {
    void legacyPromise.then((legacyResult) => compare?.({
      request: req,
      revision: revision.revision,
      authoritativePath: "AUTHZ",
      legacy: legacyResult,
      authz: authzResult,
    }));
  }
  return { result: authzResult.result, authoritativePath: "AUTHZ", configuredMode, revision: revision.revision };
}

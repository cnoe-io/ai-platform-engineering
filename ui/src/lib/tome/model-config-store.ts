/**
 * Scoped Tome model configuration.
 *
 * Configuration is stored only when an administrator or entity steward makes
 * an explicit choice. Runtime resolution is deterministic:
 *
 *   exact entity -> entity type -> global -> agent environment -> built-in
 *
 * The last two levels live in the agent process, where deployment environment
 * variables are available. This store deliberately returns `null` when Mongo
 * has no configured value so it never masks those fallbacks.
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ProjectType } from "@/types/projects";

export const MODEL_CONFIG_COLLECTION = "tome_model_config";

export const AGENT_ROLES = ["ingest", "chat", "synthesize", "compact", "presentation"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const MODEL_SCOPE_KINDS = ["global", "type", "exact"] as const;
export type ModelScopeKind = (typeof MODEL_SCOPE_KINDS)[number];

export type ModelScope =
  | { kind: "global" }
  | { kind: "type"; id: ProjectType }
  | { kind: "exact"; id: string };

export interface ModelConfigDoc {
  _id: string;
  scope_kind: ModelScopeKind;
  scope_id: string | null;
  role: AgentRole;
  model: string;
  version: number;
  tested_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ResolvedModelConfig {
  role: AgentRole;
  model: string;
  source: "exact" | "type" | "global";
  scope_kind: ModelScopeKind;
  scope_id: string | null;
  config_version: number;
  tested_at: string;
}

export interface ModelConfigValidationError {
  field: string;
  message: string;
}

export class ModelConfigValidationFailure extends Error {
  constructor(public readonly errors: ModelConfigValidationError[]) {
    super("Model config validation failed");
    this.name = "ModelConfigValidationFailure";
  }
}

function scopeId(scope: ModelScope): string | null {
  return scope.kind === "global" ? null : scope.id.trim();
}

export function modelConfigId(scope: ModelScope, role: AgentRole): string {
  const id = scopeId(scope);
  return `${scope.kind}:${id ?? "*"}:${role}`;
}

export function parseModelScope(kind: string | null, id: string | null): ModelScope {
  if (!kind || kind === "global") return { kind: "global" };
  if (kind === "type") return { kind, id: (id ?? "") as ProjectType };
  if (kind === "exact") return { kind, id: id ?? "" };
  throw new ModelConfigValidationFailure([
    { field: "scope_kind", message: `Unknown model scope "${kind}".` },
  ]);
}

export function validateModelScope(scope: ModelScope): ModelConfigValidationError[] {
  if (scope.kind === "global") return [];
  if (!scope.id.trim()) return [{ field: "scope_id", message: "Scope id is required." }];
  if (scope.kind === "type" && !["project", "area", "bhag"].includes(scope.id)) {
    return [{ field: "scope_id", message: `Unknown entity type "${scope.id}".` }];
  }
  return [];
}

export function validateModelConfig(model: string): ModelConfigValidationError[] {
  if (typeof model !== "string" || !model.trim()) {
    return [{ field: "model", message: "Model id is required." }];
  }
  return [];
}

export async function getModelConfig(
  scope: ModelScope,
  role: AgentRole,
): Promise<ModelConfigDoc | null> {
  if (!isMongoDBConfigured) return null;
  const col = await getCollection<ModelConfigDoc>(MODEL_CONFIG_COLLECTION);
  return col.findOne({ _id: modelConfigId(scope, role) });
}

export async function getScopeModelConfigs(scope: ModelScope): Promise<ModelConfigDoc[]> {
  if (!isMongoDBConfigured) return [];
  const col = await getCollection<ModelConfigDoc>(MODEL_CONFIG_COLLECTION);
  return col.find({ scope_kind: scope.kind, scope_id: scopeId(scope) }).toArray();
}

/** Resolve exact -> type -> global. Environment fallback is agent-side. */
export async function resolveModelConfig(
  role: AgentRole,
  input: { entityId: string; entityType: ProjectType },
): Promise<ResolvedModelConfig | null> {
  const candidates: Array<{ scope: ModelScope; source: ResolvedModelConfig["source"] }> = [
    { scope: { kind: "exact", id: input.entityId }, source: "exact" },
    { scope: { kind: "type", id: input.entityType }, source: "type" },
    { scope: { kind: "global" }, source: "global" },
  ];
  for (const candidate of candidates) {
    const doc = await getModelConfig(candidate.scope, role);
    if (doc) {
      return {
        role: doc.role,
        model: doc.model,
        source: candidate.source,
        scope_kind: doc.scope_kind,
        scope_id: doc.scope_id,
        config_version: doc.version,
        tested_at: doc.tested_at,
      };
    }
  }
  return null;
}

export async function resolveAllModelConfigs(input: {
  entityId: string;
  entityType: ProjectType;
}): Promise<ResolvedModelConfig[]> {
  const resolved = await Promise.all(AGENT_ROLES.map((role) => resolveModelConfig(role, input)));
  return resolved.filter((config): config is ResolvedModelConfig => config !== null);
}

export async function updateModelConfig(
  scope: ModelScope,
  role: AgentRole,
  model: string,
  updatedBy: string | null,
  testedAt: string,
): Promise<ModelConfigDoc> {
  const errors = [...validateModelScope(scope), ...validateModelConfig(model)];
  if (errors.length > 0) throw new ModelConfigValidationFailure(errors);

  const col = await getCollection<ModelConfigDoc>(MODEL_CONFIG_COLLECTION);
  const _id = modelConfigId(scope, role);
  const current = await col.findOne({ _id });
  const doc: ModelConfigDoc = {
    _id,
    scope_kind: scope.kind,
    scope_id: scopeId(scope),
    role,
    model: model.trim(),
    version: (current?.version ?? 0) + 1,
    tested_at: testedAt,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };
  await col.replaceOne({ _id }, doc, { upsert: true });
  return doc;
}

export async function deleteModelConfig(scope: ModelScope, role: AgentRole): Promise<void> {
  if (!isMongoDBConfigured) return;
  const col = await getCollection<ModelConfigDoc>(MODEL_CONFIG_COLLECTION);
  await col.deleteOne({ _id: modelConfigId(scope, role) });
}

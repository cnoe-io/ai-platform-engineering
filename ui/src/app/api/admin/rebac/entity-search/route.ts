// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";
import type { Filter } from "mongodb";

import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { CREDENTIAL_COLLECTIONS } from "@/lib/credentials/collections";
import type { SecretRefDocument } from "@/lib/credentials/secret-service";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { AgentSkill } from "@/types/agent-skill";
import type { LLMModelConfig } from "@/types/dynamic-agent";

type EntitySearchItem = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  type?: string;
  provider?: string;
  datasource_id?: string;
  model_id?: string;
  agent_name?: string;
};

type EntitySearchPayload = {
  skills: EntitySearchItem[];
  datasources: EntitySearchItem[];
  credentials: EntitySearchItem[];
  models: EntitySearchItem[];
};

const RESULT_LIMIT = 50;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textMatch(value: unknown, query: string): boolean {
  return typeof value === "string" && value.toLowerCase().includes(query.toLowerCase());
}

function mongoTextQuery<T>(query: string, fields: string[]): Filter<T> {
  const rx = new RegExp(escapeRegExp(query), "i");
  return { $or: fields.map((field) => ({ [field]: rx })) } as Filter<T>;
}

async function optionalSource<T>(loader: () => Promise<T>): Promise<T | null> {
  try {
    return await loader();
  } catch {
    return null;
  }
}

async function searchSkills(query: string): Promise<EntitySearchItem[]> {
  if (!isMongoDBConfigured) return [];
  const collection = await getCollection<AgentSkill>("agent_skills");
  const skills = await collection
    .find(query ? mongoTextQuery<AgentSkill>(query, ["id", "name", "description", "category"]) : {})
    .sort({ updated_at: -1 })
    .limit(RESULT_LIMIT)
    .toArray();
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    type: "skill",
  }));
}

async function searchCredentials(query: string): Promise<EntitySearchItem[]> {
  if (!getCredentialFeatureConfig().enabled || !isMongoDBConfigured) return [];
  const collection = await getCollection<SecretRefDocument>(CREDENTIAL_COLLECTIONS.secretRefs);
  const secrets = await collection
    .find(query ? mongoTextQuery<SecretRefDocument>(query, ["id", "name", "type", "description"]) : {})
    .sort({ updatedAt: -1 })
    .limit(RESULT_LIMIT)
    .toArray();
  return secrets.map((secret) => ({
    id: secret.id,
    name: secret.name,
    description: secret.description,
    type: secret.type,
  }));
}

async function searchModels(query: string): Promise<EntitySearchItem[]> {
  if (!isMongoDBConfigured) return [];
  const collection = await getCollection<LLMModelConfig>("llm_models");
  const models = await collection
    .find(query ? mongoTextQuery<LLMModelConfig>(query, ["_id", "model_id", "name", "provider", "description"]) : {})
    .sort({ name: 1 })
    .limit(RESULT_LIMIT)
    .toArray();
  return models.map((model) => ({
    id: String(model._id || model.model_id),
    model_id: model.model_id,
    name: model.name,
    provider: model.provider,
    description: model.description,
    type: "llm_model",
  }));
}

async function searchDatasources(request: NextRequest, query: string): Promise<EntitySearchItem[]> {
  const url = new URL("/api/rag/v1/datasources", request.url);
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      authorization: request.headers.get("authorization") ?? "",
    },
  });
  if (!response.ok) return [];
  const payload = await response.json();
  const datasources = Array.isArray(payload?.datasources) ? payload.datasources : [];
  return datasources
    .filter((datasource: Record<string, unknown>) => !query ||
      textMatch(datasource.datasource_id, query) ||
      textMatch(datasource.id, query) ||
      textMatch(datasource.name, query) ||
      textMatch(datasource.description, query)
    )
    .slice(0, RESULT_LIMIT)
    .map((datasource: Record<string, unknown>) => ({
      id: String(datasource.datasource_id || datasource.id || ""),
      datasource_id: String(datasource.datasource_id || datasource.id || ""),
      name: typeof datasource.name === "string" ? datasource.name : undefined,
      description: typeof datasource.description === "string" ? datasource.description : undefined,
      type: "data_source",
    }))
    .filter((datasource: EntitySearchItem) => Boolean(datasource.id));
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const [skills, datasources, credentials, models] = await Promise.all([
    optionalSource(() => searchSkills(query)),
    optionalSource(() => searchDatasources(request, query)),
    optionalSource(() => searchCredentials(query)),
    optionalSource(() => searchModels(query)),
  ]);

  return successResponse<EntitySearchPayload>({
    skills: skills ?? [],
    datasources: datasources ?? [],
    credentials: credentials ?? [],
    models: models ?? [],
  });
});

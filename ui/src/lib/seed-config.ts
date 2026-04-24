/**
 * Seed configuration loader for the Next.js gateway.
 *
 * Loads initial agents, MCP servers, and models from a YAML config file
 * at server startup (via instrumentation.ts). These config-driven entities:
 *
 * - Have explicit IDs specified in the config
 * - Override existing entities with the same ID (upsert behavior)
 * - Are marked as config_driven=true and cannot be edited/deleted via UI
 * - Are re-applied on every server restart (config is source of truth)
 * - Stale config-driven entities (removed from YAML) are cleaned up
 *
 * Ported from DA services/seed_config.py — DA no longer seeds configs.
 */

import fs from "fs";
import yaml from "js-yaml";
import { getCollection } from "@/lib/mongodb";
import { isMongoDBConfigured } from "@/lib/mongodb";
import type {
  DynamicAgentConfig,
  MCPServerConfig,
  SubAgentRef,
  TransportType,
  VisibilityType,
} from "@/types/dynamic-agent";

// Pattern to match ${VAR_NAME} or ${VAR_NAME:-default}
const ENV_VAR_PATTERN = /\$\{([^}:]+)(?::-([^}]*))?\}/g;

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface SeedModel {
  model_id: string;
  name: string;
  provider: string;
  description?: string;
}

interface SeedConfig {
  models: SeedModel[];
  agents: Record<string, unknown>[];
  mcp_servers: Record<string, unknown>[];
}

/** Shape of documents in the llm_models collection. */
interface LLMModelDoc {
  _id: string; // model_id
  model_id: string;
  name: string;
  provider: string;
  description: string;
  config_driven: boolean;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════
// Env var expansion
// ═══════════════════════════════════════════════════════════════

/**
 * Recursively expand ${VAR} and ${VAR:-default} in values.
 *
 * In Kubernetes, Helm resolves values before creating the ConfigMap,
 * so the mounted YAML contains literal values. But in docker-compose
 * dev mode, the raw config.yaml is mounted and uses ${VAR:-default}
 * syntax, so we need this expansion for dev compatibility.
 */
function expandEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(
      ENV_VAR_PATTERN,
      (_match: string, varName: string, defaultVal: string | undefined) => {
        const envValue = process.env[varName];
        if (envValue !== undefined) return envValue;
        if (defaultVal !== undefined) return defaultVal;
        console.warn(
          `[seed-config] Environment variable ${varName} not set and no default provided`,
        );
        return "";
      },
    );
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return value;
}

// ═══════════════════════════════════════════════════════════════
// YAML loading
// ═══════════════════════════════════════════════════════════════

function loadSeedConfig(configPath: string): SeedConfig {
  console.log(`[seed-config] Loading configuration from: ${configPath}`);

  if (!fs.existsSync(configPath)) {
    console.warn(
      `[seed-config] Config not found at ${configPath}, skipping seed`,
    );
    return { models: [], agents: [], mcp_servers: [] };
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = (yaml.load(raw) as Record<string, unknown>) || {};

  // Models don't need env var expansion (no secrets)
  const models = (parsed.models ?? []) as SeedModel[];
  // Agents and servers may reference env vars in dev mode
  const agents = expandEnvVars(parsed.agents ?? []) as Record<
    string,
    unknown
  >[];
  const mcp_servers = expandEnvVars(parsed.mcp_servers ?? []) as Record<
    string,
    unknown
  >[];

  return { models, agents, mcp_servers };
}

// ═══════════════════════════════════════════════════════════════
// Seeding functions
// ═══════════════════════════════════════════════════════════════

async function seedAgents(
  agents: Record<string, unknown>[],
): Promise<number> {
  if (agents.length === 0) return 0;

  const collection =
    await getCollection<DynamicAgentConfig>("dynamic_agents");
  let count = 0;

  for (const agentData of agents) {
    const agentId = agentData.id as string | undefined;
    if (!agentId) {
      console.warn(
        `[seed-config] Skipping agent without id: ${agentData.name ?? "unknown"}`,
      );
      continue;
    }

    const now = new Date().toISOString();

    // Preserve created_at if document already exists
    const existing = await collection.findOne({ _id: agentId });
    const createdAt = existing?.created_at ?? now;

    const doc = {
      _id: agentId,
      name: (agentData.name as string) ?? agentId,
      description: (agentData.description as string) ?? "",
      system_prompt: (agentData.system_prompt as string) ?? "",
      allowed_tools:
        (agentData.allowed_tools as Record<string, string[]>) ?? {},
      model_id: (agentData.model_id as string) ?? "",
      model_provider: (agentData.model_provider as string) ?? "",
      visibility: ((agentData.visibility as string) ?? "global") as VisibilityType,
      shared_with_teams:
        (agentData.shared_with_teams as string[]) ?? undefined,
      subagents: (agentData.subagents as SubAgentRef[]) ?? [],
      builtin_tools: agentData.builtin_tools ?? undefined,
      enabled: (agentData.enabled as boolean) ?? true,
      owner_id: "system",
      is_system: false,
      config_driven: true,
      created_at: createdAt,
      updated_at: now,
    };

    await collection.replaceOne({ _id: agentId }, doc, { upsert: true });
    console.log(`[seed-config] Seeded agent: ${agentId}`);
    count++;
  }

  return count;
}

async function seedMCPServers(
  servers: Record<string, unknown>[],
): Promise<number> {
  if (servers.length === 0) return 0;

  const collection = await getCollection<MCPServerConfig>("mcp_servers");
  let count = 0;

  for (const serverData of servers) {
    const serverId = serverData.id as string | undefined;
    if (!serverId) {
      console.warn(
        `[seed-config] Skipping MCP server without id: ${serverData.name ?? "unknown"}`,
      );
      continue;
    }

    const now = new Date().toISOString();

    // Preserve created_at if document already exists
    const existing = await collection.findOne({ _id: serverId });
    const createdAt = existing?.created_at ?? now;

    const doc = {
      _id: serverId,
      name: (serverData.name as string) ?? serverId,
      description: (serverData.description as string) ?? "",
      transport: ((serverData.transport as string) ?? "stdio") as TransportType,
      endpoint: (serverData.endpoint as string) ?? undefined,
      command: (serverData.command as string) ?? undefined,
      args: (serverData.args as string[]) ?? undefined,
      env: (serverData.env as Record<string, string>) ?? undefined,
      enabled: (serverData.enabled as boolean) ?? true,
      config_driven: true,
      created_at: createdAt,
      updated_at: now,
    };

    await collection.replaceOne({ _id: serverId }, doc, { upsert: true });
    console.log(`[seed-config] Seeded MCP server: ${serverId}`);
    count++;
  }

  return count;
}

async function seedModels(models: SeedModel[]): Promise<number> {
  if (models.length === 0) return 0;

  const collection = await getCollection<LLMModelDoc>("llm_models");
  let count = 0;

  for (const model of models) {
    if (!model.model_id) {
      console.warn(
        `[seed-config] Skipping model without model_id: ${model.name ?? "unknown"}`,
      );
      continue;
    }

    const now = new Date().toISOString();

    const doc: LLMModelDoc = {
      _id: model.model_id,
      model_id: model.model_id,
      name: model.name ?? model.model_id,
      provider: model.provider ?? "unknown",
      description: model.description ?? "",
      config_driven: true,
      updated_at: now,
    };

    await collection.replaceOne({ _id: model.model_id }, doc, {
      upsert: true,
    });
    count++;
  }

  console.log(`[seed-config] Seeded ${count} models`);
  return count;
}

// ═══════════════════════════════════════════════════════════════
// Stale cleanup
// ═══════════════════════════════════════════════════════════════

/**
 * Remove config-driven entities that are no longer in the config.
 *
 * When an entity is removed from config.yaml, it should be deleted
 * from the database on the next server restart.
 */
async function cleanupStaleConfigDriven(
  currentAgentIds: Set<string>,
  currentServerIds: Set<string>,
  currentModelIds: Set<string>,
): Promise<void> {
  // Cleanup stale agents
  const agentCollection =
    await getCollection<DynamicAgentConfig>("dynamic_agents");
  const staleAgents = await agentCollection
    .find({ config_driven: true })
    .toArray();
  let agentsDeleted = 0;
  for (const agent of staleAgents) {
    if (!currentAgentIds.has(agent._id)) {
      console.log(
        `[seed-config] Removing stale config-driven agent: ${agent._id}`,
      );
      await agentCollection.deleteOne({ _id: agent._id });
      agentsDeleted++;
    }
  }

  // Cleanup stale MCP servers
  const serverCollection =
    await getCollection<MCPServerConfig>("mcp_servers");
  const staleServers = await serverCollection
    .find({ config_driven: true })
    .toArray();
  let serversDeleted = 0;
  for (const server of staleServers) {
    if (!currentServerIds.has(server._id)) {
      console.log(
        `[seed-config] Removing stale config-driven MCP server: ${server._id}`,
      );
      await serverCollection.deleteOne({ _id: server._id });
      serversDeleted++;
    }
  }

  // Cleanup stale models
  const modelCollection = await getCollection<LLMModelDoc>("llm_models");
  const staleModels = await modelCollection
    .find({ config_driven: true })
    .toArray();
  let modelsDeleted = 0;
  for (const model of staleModels) {
    if (!currentModelIds.has(model._id)) {
      console.log(
        `[seed-config] Removing stale config-driven model: ${model._id}`,
      );
      await modelCollection.deleteOne({ _id: model._id });
      modelsDeleted++;
    }
  }

  if (agentsDeleted || serversDeleted || modelsDeleted) {
    console.log(
      `[seed-config] Cleaned up stale config-driven entities: ` +
        `${agentsDeleted} agents, ${serversDeleted} servers, ${modelsDeleted} models`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════

/**
 * Load and apply seed configuration from YAML.
 *
 * Called at server startup via instrumentation.ts to ensure config-driven
 * agents, MCP servers, and models are loaded into MongoDB.
 *
 * Also cleans up config-driven entities that have been removed from config.
 */
export async function applySeedConfig(): Promise<void> {
  const configPath = process.env.APP_CONFIG_PATH;
  if (!configPath) {
    console.log("[seed-config] APP_CONFIG_PATH not set, skipping seed");
    return;
  }

  if (!isMongoDBConfigured) {
    console.warn(
      "[seed-config] MongoDB not configured, skipping seed",
    );
    return;
  }

  try {
    const config = loadSeedConfig(configPath);

    console.log(
      `[seed-config] Found ${config.models.length} models, ` +
        `${config.mcp_servers.length} MCP servers, ` +
        `${config.agents.length} agents in config`,
    );

    // Extract current IDs for stale cleanup
    const currentAgentIds = new Set(
      config.agents
        .map((a) => a.id as string)
        .filter(Boolean),
    );
    const currentServerIds = new Set(
      config.mcp_servers
        .map((s) => s.id as string)
        .filter(Boolean),
    );
    const currentModelIds = new Set(
      config.models
        .map((m) => m.model_id)
        .filter(Boolean),
    );

    // Seed entities
    const modelCount = await seedModels(config.models);
    const serverCount = await seedMCPServers(config.mcp_servers);
    const agentCount = await seedAgents(config.agents);

    // Cleanup stale config-driven entities
    await cleanupStaleConfigDriven(
      currentAgentIds,
      currentServerIds,
      currentModelIds,
    );

    console.log(
      `[seed-config] Applied: ${modelCount} models, ` +
        `${serverCount} MCP servers, ${agentCount} agents`,
    );
  } catch (err) {
    // Log but don't crash — seeding failure shouldn't prevent startup
    console.error("[seed-config] Failed to apply seed config:", err);
  }

  // Spec 104: provision per-team Keycloak client scopes for any teams
  // that pre-date the slug field. Lives inside applySeedConfig because
  // Turbopack's instrumentation chunk tree-shakes a separate dynamic
  // import (the seed-config chunk is reliably emitted, so we piggyback
  // on it). Best-effort — failures are logged but don't block startup.
  try {
    const { syncTeamScopesOnStartup } = await import(
      "@/lib/rbac/team-scope-sync"
    );
    await syncTeamScopesOnStartup();
  } catch (err) {
    console.error("[seed-config] team-scope sync threw:", err);
  }
}

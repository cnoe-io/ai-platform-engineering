import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
} from "@/lib/api-middleware";
import type { TaskConfig } from "@/types/task-config";
import { parseTaskConfigYaml } from "@/types/task-config";
import yaml from "js-yaml";

/**
 * Seed task_configs collection from the task_config.yaml file.
 *
 * GET: Auto-seed from TASK_CONFIG_SEED_PATH env var (or default paths).
 *      Uses content-hash detection: upserts system configs whenever the
 *      YAML file changes, without affecting user-created workflows.
 *
 * POST (no action): Seed from YAML content provided in request body.
 *       Useful for manual seeding or when the file isn't mounted.
 *
 * POST (action=reset): Admin-only. Re-reads task_config.yaml from the
 *       ConfigMap mount and upserts all system task configs, overwriting
 *       any stale data in MongoDB. User-created configs are untouched.
 */

function findTaskConfigFile(): string | null {
  const candidates = [
    process.env.TASK_CONFIG_SEED_PATH,
    "/app/config/task-config/task_config.yaml",
    "/app/task_config.yaml",
    resolve(process.cwd(), "task_config.yaml"),
    resolve(process.cwd(), "..", "charts", "ai-platform-engineering", "data", "task_config.yaml"),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    try {
      readFileSync(path, "utf-8");
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

function loadYamlContent(): { raw: string; parsed: Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }> } | null {
  const filePath = findTaskConfigFile();
  if (!filePath) return null;

  const raw = readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw) as Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }>;
  return { raw, parsed };
}

interface SeedMeta {
  _id: string;
  content_hash: string;
  updated_at: Date;
}

async function upsertSystemConfigs(
  configs: TaskConfig[],
  yamlNames: Set<string>,
): Promise<{ updated: number; inserted: number; removed: number }> {
  const collection = await getCollection<TaskConfig>("task_configs");

  let updated = 0;
  let inserted = 0;
  for (const config of configs) {
    const result = await collection.updateOne(
      { name: config.name, is_system: true },
      {
        $set: {
          tasks: config.tasks,
          category: config.category,
          description: config.description,
          metadata: config.metadata,
          updated_at: new Date(),
        },
        $setOnInsert: {
          id: config.id,
          name: config.name,
          owner_id: "system",
          is_system: true,
          visibility: "global",
          created_at: new Date(),
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) inserted++;
    else if (result.modifiedCount > 0) updated++;
  }

  const removeResult = await collection.deleteMany({
    is_system: true,
    name: { $nin: Array.from(yamlNames) },
  });
  const removed = removeResult.deletedCount;

  return { updated, inserted, removed };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Task Builder requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async () => {
    const loaded = loadYamlContent();
    if (!loaded) {
      return successResponse({
        seeded: false,
        message: "No task_config.yaml found. Set TASK_CONFIG_SEED_PATH or mount at /app/task_config.yaml",
        count: 0,
      });
    }

    const contentHash = createHash("sha256").update(loaded.raw).digest("hex");

    const metaCollection = await getCollection<SeedMeta>("_seed_meta");
    const existing = await metaCollection.findOne({ _id: "task_config" as unknown as SeedMeta["_id"] });

    if (existing?.content_hash === contentHash) {
      return successResponse({
        seeded: false,
        message: "task_config.yaml unchanged — skipping",
        hash: contentHash,
      });
    }

    const configs = parseTaskConfigYaml(loaded.parsed);
    const yamlNames = new Set(Object.keys(loaded.parsed));
    const { updated, inserted, removed } = await upsertSystemConfigs(configs, yamlNames);

    await metaCollection.updateOne(
      { _id: "task_config" as unknown as SeedMeta["_id"] },
      { $set: { content_hash: contentHash, updated_at: new Date() } },
      { upsert: true },
    );

    return successResponse({
      seeded: true,
      message: `Synced system task configs: ${inserted} added, ${updated} updated, ${removed} removed`,
      inserted,
      updated,
      removed,
      total: configs.length,
      hash: contentHash,
    });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Task Builder requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "reset") {
    return await withAuth(request, async (_req, _user, session) => {
      requireAdmin(session);

      const loaded = loadYamlContent();
      if (!loaded) {
        throw new ApiError(
          "Cannot reset: no task_config.yaml found on disk. " +
            "Set TASK_CONFIG_SEED_PATH or mount at /app/task_config.yaml",
          404
        );
      }

      const configs = parseTaskConfigYaml(loaded.parsed);
      const yamlNames = new Set(Object.keys(loaded.parsed));
      const { updated, inserted, removed } = await upsertSystemConfigs(configs, yamlNames);

      const contentHash = createHash("sha256").update(loaded.raw).digest("hex");
      const metaCollection = await getCollection<SeedMeta>("_seed_meta");
      await metaCollection.updateOne(
        { _id: "task_config" as unknown as SeedMeta["_id"] },
        { $set: { content_hash: contentHash, updated_at: new Date() } },
        { upsert: true },
      );

      return successResponse({
        message: `Reset system task configs: ${inserted} added, ${updated} updated, ${removed} removed`,
        updated,
        inserted,
        removed,
        total: configs.length,
      });
    });
  }

  return await withAuth(request, async () => {
    const body = await request.json();

    if (!body.yaml_content && !body.configs) {
      throw new ApiError(
        "Provide either 'yaml_content' (string) or 'configs' (parsed object)",
        400
      );
    }

    const collection = await getCollection<TaskConfig>("task_configs");

    let yamlData: Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }>;

    if (body.yaml_content) {
      yamlData = yaml.load(body.yaml_content) as typeof yamlData;
    } else {
      yamlData = body.configs;
    }

    const configs = parseTaskConfigYaml(yamlData);

    let inserted = 0;
    for (const config of configs) {
      const existing = await collection.findOne({ name: config.name });
      if (!existing) {
        await collection.insertOne(config);
        inserted++;
      }
    }

    return successResponse({
      seeded: true,
      message: `Seeded ${inserted} new task configs (${configs.length - inserted} already existed)`,
      count: inserted,
      total: configs.length,
    });
  });
});

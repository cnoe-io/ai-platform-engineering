import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import type { TaskConfig } from "@/types/task-config";
import { parseTaskConfigYaml } from "@/types/task-config";
import yaml from "js-yaml";

/**
 * Seed task_configs collection from the task_config.yaml file.
 *
 * GET: Auto-seed from TASK_CONFIG_SEED_PATH env var (or default paths).
 *      Idempotent — skips if system configs already exist.
 *
 * POST: Seed from YAML content provided in request body.
 *       Useful for manual seeding or when the file isn't mounted.
 */

function findTaskConfigFile(): string | null {
  const candidates = [
    process.env.TASK_CONFIG_SEED_PATH,
    "/app/task_config.yaml",
    "./task_config.yaml",
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

function loadYamlFromFile(): Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }> | null {
  const filePath = findTaskConfigFile();
  if (!filePath) return null;

  const content = readFileSync(filePath, "utf-8");
  const parsed = yaml.load(content) as Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }>;
  return parsed;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Task Builder requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async () => {
    const collection = await getCollection<TaskConfig>("task_configs");

    const systemCount = await collection.countDocuments({ is_system: true });
    if (systemCount > 0) {
      return successResponse({
        seeded: false,
        message: `Skipped seeding — ${systemCount} system task configs already exist`,
        count: systemCount,
      });
    }

    const yamlData = loadYamlFromFile();
    if (!yamlData) {
      return successResponse({
        seeded: false,
        message: "No task_config.yaml found. Set TASK_CONFIG_SEED_PATH or mount at /app/task_config.yaml",
        count: 0,
      });
    }

    const configs = parseTaskConfigYaml(yamlData);
    if (configs.length > 0) {
      await collection.insertMany(configs);
    }

    return successResponse({
      seeded: true,
      message: `Seeded ${configs.length} task configs from YAML`,
      count: configs.length,
    });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Task Builder requires MongoDB to be configured", 503);
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

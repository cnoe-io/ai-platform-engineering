import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import type { AgentSkill } from "@/types/agent-skill";
import {
  loadSkillTemplatesInternal,
  type SkillTemplateData,
} from "@/app/api/skills/skill-templates-loader";

/**
 * Seed API Route
 *
 * POST /api/agent-skills/seed
 * Seeds the database with skill templates loaded from disk (charts/data/skills/).
 * Can be called on app startup or manually by admin.
 * Removes system templates that are no longer in the whitelist.
 *
 * GET /api/agent-skills/seed
 * Checks if seeding is needed (returns { needsSeeding: boolean, count: number })
 *
 * The BUILTIN_SKILL_IDS env var controls which disk templates are seeded.
 * When set, only templates whose IDs appear in the comma-separated list are seeded.
 * When unset or empty, all disk templates are seeded.
 */

/**
 * Convert a disk SkillTemplateData into an AgentSkill suitable for MongoDB.
 */
function templateToAgentSkill(t: SkillTemplateData): AgentSkill {
  const now = new Date();
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category || "Custom",
    tasks: [
      {
        display_text: t.title || t.name,
        llm_prompt: t.content,
        subagent: "user_input",
      },
    ],
    owner_id: "system",
    is_system: true,
    created_at: now,
    updated_at: now,
    is_quick_start: true,
    thumbnail: t.icon || "Zap",
    metadata: {
      tags: t.tags || [],
      schema_version: "1.0",
    },
  };
}

/**
 * Returns the subset of disk templates allowed by the BUILTIN_SKILL_IDS
 * environment variable. If the variable is unset or empty, all templates
 * are returned.
 */
function getEnabledTemplates(): SkillTemplateData[] {
  const allTemplates = loadSkillTemplatesInternal();
  const raw = process.env.BUILTIN_SKILL_IDS?.trim();
  if (!raw) {
    return allTemplates;
  }
  const allowedIds = new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
  return allTemplates.filter((t) => allowedIds.has(t.id));
}

// Check if seeding is needed
async function checkSeedingStatus(): Promise<{ needsSeeding: boolean; existingCount: number; templateCount: number }> {
  const enabledTemplates = getEnabledTemplates();
  const allTemplates = loadSkillTemplatesInternal();

  if (!isMongoDBConfigured) {
    return { needsSeeding: false, existingCount: 0, templateCount: enabledTemplates.length };
  }

  const collection = await getCollection<AgentSkill>("agent_skills");
  const enabledIds = enabledTemplates.map((t) => t.id);
  const allSystemIds = allTemplates.map((t) => t.id);
  const disabledIds = allSystemIds.filter((id) => !new Set(enabledIds).has(id));

  // Count how many of the enabled templates already exist
  const existingCount = await collection.countDocuments({
    is_system: true,
    id: { $in: enabledIds },
  });

  // Count system templates that should be removed
  const staleCount = disabledIds.length > 0
    ? await collection.countDocuments({ is_system: true, id: { $in: disabledIds } })
    : 0;

  return {
    needsSeeding: existingCount < enabledTemplates.length || staleCount > 0,
    existingCount,
    templateCount: enabledTemplates.length,
  };
}

// Seed the database with enabled disk templates and remove non-whitelisted ones
async function seedTemplatesFromDisk(): Promise<{ seeded: number; skipped: number; removed: number }> {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is not configured", 503);
  }

  const collection = await getCollection<AgentSkill>("agent_skills");
  const enabledTemplates = getEnabledTemplates();
  const allTemplates = loadSkillTemplatesInternal();
  const enabledIds = new Set(enabledTemplates.map((t) => t.id));

  let seeded = 0;
  let skipped = 0;

  for (const template of enabledTemplates) {
    // Check if this template already exists
    const existing = await collection.findOne({ id: template.id });

    if (existing) {
      skipped++;
      continue;
    }

    // Convert disk template to AgentSkill and insert
    const configToInsert = templateToAgentSkill(template);

    await collection.insertOne(configToInsert);
    seeded++;
    console.log(`[Seed] Seeded template: ${template.name}`);
  }

  // Remove system templates that are no longer in the whitelist
  const allSystemIds = allTemplates.map((t) => t.id);
  const disabledIds = allSystemIds.filter((id) => !enabledIds.has(id));
  let removed = 0;
  if (disabledIds.length > 0) {
    const result = await collection.deleteMany({
      is_system: true,
      id: { $in: disabledIds },
    });
    removed = result.deletedCount;
    if (removed > 0) {
      console.log(`[Seed] Removed ${removed} non-whitelisted system template(s)`);
    }
  }

  return { seeded, skipped, removed };
}

// GET /api/agent-skills/seed - Check if seeding is needed
export const GET = withErrorHandler(async (request: NextRequest) => {
  const enabledTemplates = getEnabledTemplates();

  if (!isMongoDBConfigured) {
    return NextResponse.json({
      needsSeeding: false,
      message: "MongoDB not configured - using disk templates from charts/data/skills/",
      existingCount: 0,
      templateCount: enabledTemplates.length,
    });
  }

  const status = await checkSeedingStatus();

  return NextResponse.json({
    ...status,
    message: status.needsSeeding
      ? `${status.templateCount - status.existingCount} templates need to be seeded`
      : "All templates are already seeded",
  });
});

// POST /api/agent-skills/seed - Seed the database (auto-seeds on first call, or admin can force)
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is not configured", 503);
  }

  // Check if this is an authenticated request (optional - allows auto-seeding on first load)
  let isAdmin = false;
  try {
    await withAuth(request, async (req, user) => {
      // Check if user is admin (via session role)
      const session = (req as any).session;
      isAdmin = session?.role === "admin";
      return NextResponse.json({ ok: true });
    });
  } catch {
    // Not authenticated - allow seeding anyway for initial setup
    isAdmin = false;
  }

  // Perform seeding (also removes non-whitelisted system templates)
  const result = await seedTemplatesFromDisk();

  console.log(`[Seed] Seeding complete: ${result.seeded} seeded, ${result.skipped} skipped, ${result.removed} removed`);

  return successResponse({
    message: `Successfully seeded ${result.seeded} templates (${result.removed} removed)`,
    ...result,
  }, 201);
});

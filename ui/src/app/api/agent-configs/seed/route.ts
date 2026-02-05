import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import type { AgentConfig } from "@/types/agent-config";
import { BUILTIN_QUICK_START_TEMPLATES } from "@/types/agent-config";

/**
 * Seed API Route
 * 
 * POST /api/agent-configs/seed
 * Seeds the database with built-in templates if they don't exist.
 * Can be called on app startup or manually by admin.
 * 
 * GET /api/agent-configs/seed
 * Checks if seeding is needed (returns { needsSeeding: boolean, count: number })
 */

// Check if seeding is needed
async function checkSeedingStatus(): Promise<{ needsSeeding: boolean; existingCount: number; templateCount: number }> {
  if (!isMongoDBConfigured) {
    return { needsSeeding: false, existingCount: 0, templateCount: BUILTIN_QUICK_START_TEMPLATES.length };
  }

  const collection = await getCollection<AgentConfig>("agent_configs");
  
  // Check how many system templates exist
  const existingSystemConfigs = await collection.countDocuments({ is_system: true });
  
  return {
    needsSeeding: existingSystemConfigs < BUILTIN_QUICK_START_TEMPLATES.length,
    existingCount: existingSystemConfigs,
    templateCount: BUILTIN_QUICK_START_TEMPLATES.length,
  };
}

// Seed the database with built-in templates
async function seedBuiltinTemplates(): Promise<{ seeded: number; skipped: number }> {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is not configured", 503);
  }

  const collection = await getCollection<AgentConfig>("agent_configs");
  
  let seeded = 0;
  let skipped = 0;

  for (const template of BUILTIN_QUICK_START_TEMPLATES) {
    // Check if this template already exists
    const existing = await collection.findOne({ id: template.id });
    
    if (existing) {
      skipped++;
      continue;
    }

    // Insert the template with proper dates
    const configToInsert: AgentConfig = {
      ...template,
      owner_id: "system",
      is_system: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await collection.insertOne(configToInsert);
    seeded++;
    console.log(`[Seed] Seeded template: ${template.name}`);
  }

  return { seeded, skipped };
}

// GET /api/agent-configs/seed - Check if seeding is needed
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json({
      needsSeeding: false,
      message: "MongoDB not configured - using built-in templates from code",
      existingCount: 0,
      templateCount: BUILTIN_QUICK_START_TEMPLATES.length,
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

// POST /api/agent-configs/seed - Seed the database (auto-seeds on first call, or admin can force)
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

  // Check current status
  const status = await checkSeedingStatus();
  
  if (!status.needsSeeding) {
    return successResponse({
      message: "All templates are already seeded",
      seeded: 0,
      skipped: status.existingCount,
    });
  }

  // Perform seeding
  const result = await seedBuiltinTemplates();
  
  console.log(`[Seed] Seeding complete: ${result.seeded} seeded, ${result.skipped} skipped`);

  return successResponse({
    message: `Successfully seeded ${result.seeded} templates`,
    ...result,
  }, 201);
});

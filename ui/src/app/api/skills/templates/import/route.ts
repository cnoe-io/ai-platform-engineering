import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import type { AgentSkill } from "@/types/agent-skill";
import {
  loadSkillTemplatesInternal,
  type SkillTemplateData,
} from "@/app/api/skills/skill-templates-loader";

/**
 * POST /api/skills/templates/import
 *
 * Import packaged disk templates as system-scoped rows with deterministic ids
 * `skill-{slug}-{6hex}` and dedupe on `metadata.template_source_id`.
 */

function slugFromTemplateId(templateId: string): string {
  const s = templateId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "template";
}

function deterministicSkillId(templateSourceId: string): string {
  const slug = slugFromTemplateId(templateSourceId);
  const suffix = createHash("sha256")
    .update(`${templateSourceId}:system`, "utf8")
    .digest("hex")
    .slice(0, 6);
  return `skill-${slug}-${suffix}`;
}

function templateToImportedAgentSkill(t: SkillTemplateData, mongoId: string): AgentSkill {
  const now = new Date();
  return {
    id: mongoId,
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
    visibility: "global",
    skill_content: t.content,
    metadata: {
      tags: t.tags || [],
      schema_version: "1.0",
      template_source_id: t.id,
      import_kind: "helm_template_v1",
    },
  };
}

interface ImportBody {
  template_ids?: string[];
  import_all?: boolean;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is not configured", 503);
  }

  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body = (await request.json()) as ImportBody;
    const all = loadSkillTemplatesInternal();
    let toImport: SkillTemplateData[];

    if (body.import_all) {
      toImport = all;
    } else if (body.template_ids?.length) {
      toImport = [];
      for (const id of body.template_ids) {
        const t = all.find((x) => x.id === id);
        if (t) toImport.push(t);
      }
    } else {
      throw new ApiError("Provide template_ids or import_all: true", 400);
    }

    const collection = await getCollection<AgentSkill>("agent_skills");
    const imported: { id: string; template_source_id: string }[] = [];
    const skipped: { template_source_id: string; reason: string }[] = [];
    const errors: { template_source_id: string; error: string }[] = [];

    for (const t of toImport) {
      try {
        const dup = await collection.findOne({
          is_system: true,
          "metadata.template_source_id": t.id,
        });
        if (dup) {
          skipped.push({ template_source_id: t.id, reason: "already_imported" });
          continue;
        }

        const mongoId = deterministicSkillId(t.id);
        const clash = await collection.findOne({ id: mongoId });
        if (clash && clash.metadata?.template_source_id !== t.id) {
          errors.push({
            template_source_id: t.id,
            error: `id collision: ${mongoId}`,
          });
          continue;
        }

        const doc = templateToImportedAgentSkill(t, mongoId);
        await collection.insertOne(doc);
        imported.push({ id: mongoId, template_source_id: t.id });
      } catch (e) {
        errors.push({
          template_source_id: t.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return successResponse({
      imported,
      skipped,
      errors,
    });
  });
});

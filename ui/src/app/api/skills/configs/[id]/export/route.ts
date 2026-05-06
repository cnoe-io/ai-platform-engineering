import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

import { isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getAgentSkillVisibleToUser } from "@/lib/agent-skill-visibility";
import type { AgentSkill } from "@/types/agent-skill";

/**
 * GET /api/skills/configs/[id]/export
 *
 * Streams a ZIP archive containing the skill's `SKILL.md` plus every
 * ancillary file, mirroring the on-disk folder layout used by built-in
 * chart templates (`charts/ai-platform-engineering/data/skills/<id>/`).
 *
 * Layout produced inside the archive:
 *   <skill-id>/SKILL.md
 *   <skill-id>/metadata.json     (category/icon/tags + visibility/timestamps)
 *   <skill-id>/<ancillary paths …>
 *
 * Visibility rules match the rest of the configs API (private to owner,
 * team-shared, global, or built-in `is_system` rows). The download is gated
 * by the same `getAgentSkillVisibleToUser` helper used by the read endpoints.
 *
 * Note: this route intentionally serves bytes (not JSON), so it is excluded
 * from the unified `successResponse` envelope.
 */

const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";
const SKILL_MD_PATH = "SKILL.md";
const METADATA_JSON_PATH = "metadata.json";

function safeFolderName(skill: AgentSkill): string {
  // Prefer a stable, file-system-safe slug derived from `id` (already a
  // sanitised slug for Mongo-backed rows). Fall back to `name` and finally
  // a hard-coded `skill` literal so we never produce an empty entry.
  const candidate = (skill.id || skill.name || "skill")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    // Collapse `..` (and longer runs) into a single `.` to avoid path
    // traversal markers leaking into archive entry names.
    .replace(/\.{2,}/g, ".")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return candidate || "skill";
}

function buildMetadataJson(skill: AgentSkill): string {
  // Mirror the shape consumed by `skill-templates-loader.ts`. Keep keys
  // optional so re-importing the archive doesn't require post-processing.
  const meta = {
    title: skill.name,
    category: skill.category ?? "Custom",
    icon: skill.thumbnail ?? "Zap",
    tags: (skill.metadata?.tags as string[] | undefined) ?? [],
    description: skill.description ?? "",
    visibility: skill.visibility ?? "private",
    is_system: Boolean(skill.is_system),
    owner_id: skill.owner_id ?? null,
    exported_at: new Date().toISOString(),
    exported_from_id: skill.id,
    schema_version: "1.0",
    ...(skill.input_form ? { input_form: skill.input_form } : {}),
  };
  return JSON.stringify(meta, null, 2) + "\n";
}

async function buildZip(skill: AgentSkill): Promise<Buffer> {
  const zip = new JSZip();
  const folder = zip.folder(safeFolderName(skill));
  if (!folder) throw new ApiError("Failed to initialise zip folder", 500);

  // SKILL.md (always present, even if empty — keeps the archive shape stable
  // so downstream tooling / re-imports see a predictable layout).
  folder.file(SKILL_MD_PATH, skill.skill_content ?? "");

  // metadata.json (gallery-facing presentation + lineage)
  folder.file(METADATA_JSON_PATH, buildMetadataJson(skill));

  // Ancillary files — preserve nested paths verbatim. JSZip handles slashes
  // by creating intermediate directory entries automatically.
  const ancillary = skill.ancillary_files ?? {};
  for (const [relPath, content] of Object.entries(ancillary)) {
    if (!relPath || relPath === SKILL_MD_PATH) continue; // SKILL.md already written
    folder.file(relPath, content ?? "");
  }

  // Use DEFLATE for moderate compression (skills are mostly text).
  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    if (STORAGE_TYPE !== "mongodb") {
      throw new ApiError("Skills require MongoDB to be configured", 503);
    }
    const { id } = await context.params;

    return await withAuth(request, async (_req, user) => {
      const skill = await getAgentSkillVisibleToUser(id, user.email);
      if (!skill) throw new ApiError("Skill not found", 404);

      const buffer = await buildZip(skill);
      const folderName = safeFolderName(skill);
      const filename = `${folderName}.zip`;

      // Copy the Node Buffer into a fresh `ArrayBuffer` so the resulting
      // `Uint8Array` is typed against `ArrayBuffer` (not the `SharedArrayBuffer`
      // union that Node's Buffer carries) — required by the DOM `BlobPart`
      // typing in this Next.js version.
      const ab = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(ab).set(buffer);
      const body = new Blob([new Uint8Array(ab)], { type: "application/zip" });

      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(buffer.byteLength),
          "Cache-Control": "private, no-store",
          // Hint clients that the response body is the actual file payload
          // and not an envelope/JSON document.
          "X-Skill-Export-Id": skill.id,
        },
      });
    });
  },
);

import { NextRequest } from "next/server";

import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { scanSkillContent, isSkillScannerConfigured } from "@/lib/skill-scan";
import { recordScanEvent } from "@/lib/skill-scan-history";
import {
  loadSkillTemplatesInternal,
  loadTemplateAncillaryFiles,
  resolveTemplateDir,
} from "@/app/api/skills/skill-templates-loader";
import type { ScanStatus } from "@/types/agent-skill";

const BUILTIN_SCAN_COLLECTION = "builtin_skill_scans";

interface BuiltinScanDoc {
  id: string;
  name: string;
  scan_status: ScanStatus;
  scan_summary?: string;
  scan_updated_at: Date;
}

/**
 * POST /api/skill-templates/[id]/scan
 *
 * Re-run the security scanner against a single packaged (built-in) skill
 * template. Mirrors `/api/skills/configs/[id]/scan` for filesystem-backed
 * templates that have no `agent_skills` row of their own.
 *
 * Permissions: any authenticated user (matches the read endpoint
 * `GET /api/skill-templates`). The bulk admin path lives at
 * `/api/skills/scan-all` with `scope: "builtin"`.
 *
 * Persistence: results land in `builtin_skill_scans`, keyed by the
 * loader's stable template id (frontmatter `name` || dirname). The
 * gallery shield reads from the same collection so badges update
 * without a refresh.
 */
export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    if (!isMongoDBConfigured) {
      // We only require Mongo for *persistence* of the result —
      // returning the scan is still useful, but without Mongo the
      // gallery can't cache it. Bail loudly so admins notice.
      throw new ApiError(
        "Built-in scan persistence requires MongoDB to be configured",
        503,
      );
    }
    if (!isSkillScannerConfigured()) {
      throw new ApiError(
        "Scanner is not configured. Set SKILL_SCANNER_URL (e.g. http://skill-scanner:8000) so the UI can reach the standalone skill-scanner service.",
        503,
      );
    }

    const { id } = await context.params;
    if (!id) {
      throw new ApiError("Template id is required", 400);
    }

    return await withAuth(request, async (_req, user) => {
      // Load the catalog (cached, ~ms) and find this template by id.
      // We resolve via the loader (not just `resolveTemplateDir`) so the
      // returned `name` matches the gallery and the on-the-wire row.
      const templates = loadSkillTemplatesInternal();
      const tpl = templates.find((t) => t.id === id);
      if (!tpl) {
        throw new ApiError(
          `Built-in skill template "${id}" not found in SKILLS_DIR`,
          404,
        );
      }

      const content = tpl.content?.trim();
      if (!content) {
        throw new ApiError(
          "No SKILL.md body to scan for this built-in template.",
          400,
        );
      }

      const tplDir = resolveTemplateDir(id);
      const ancillaryFiles = tplDir ? loadTemplateAncillaryFiles(tplDir) : {};

      const t0 = Date.now();
      const scanResult = await scanSkillContent(tpl.name, content, id, {
        ancillaryFiles,
      });
      const dur = Date.now() - t0;

      const persistedSummary =
        scanResult.scan_summary ?? scanResult.unscanned_reason;
      const now = new Date();

      try {
        const scanCol = await getCollection<BuiltinScanDoc>(
          BUILTIN_SCAN_COLLECTION,
        );
        await scanCol.updateOne(
          { id },
          {
            $set: {
              id,
              name: tpl.name,
              scan_status: scanResult.scan_status,
              ...(persistedSummary !== undefined
                ? { scan_summary: persistedSummary }
                : {}),
              scan_updated_at: now,
            },
          },
          { upsert: true },
        );
      } catch (err) {
        // Persistence is best-effort — surface the live result even
        // when the cache write fails so the UI can show fresh data.
        console.warn(
          `[scan-template] Failed to persist scan for builtin/${id}:`,
          err,
        );
      }

      await recordScanEvent({
        trigger: "manual_user_skill",
        skill_id: id,
        skill_name: tpl.name,
        source: "default",
        actor: user.email,
        scan_status: scanResult.scan_status,
        scan_summary: persistedSummary,
        scanner_unavailable: scanResult.scan_status === "unscanned",
        duration_ms: dur,
      });

      return successResponse({
        id,
        name: tpl.name,
        scan_status: scanResult.scan_status,
        scan_summary: persistedSummary,
        scan_updated_at: now.toISOString(),
        duration_ms: dur,
      });
    });
  },
);

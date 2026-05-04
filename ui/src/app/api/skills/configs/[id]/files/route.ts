import { NextRequest } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import {
  getAgentSkillVisibleToUser,
  userCanModifyAgentSkill,
} from "@/lib/agent-skill-visibility";
import type { AgentSkill } from "@/types/agent-skill";

const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";
const SKILL_MD_PATH = "SKILL.md";
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_FILES = 200;

interface ListEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

/**
 * GET    /api/skills/configs/[id]/files?path=<rel>
 * PUT    /api/skills/configs/[id]/files                — body: { path, content }
 * DELETE /api/skills/configs/[id]/files?path=<rel>
 *
 * Files API for non-hub skills. Treats `skill_content` as `SKILL.md` and
 * `ancillary_files` as a flat Record<path, text content>. Directories are
 * synthesized from path prefixes for the tree UI.
 */
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    if (STORAGE_TYPE !== "mongodb") {
      throw new ApiError("Skills require MongoDB to be configured", 503);
    }
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const relPath = sanitizePath(searchParams.get("path") ?? "");

    return await withAuth(request, async (_req, user) => {
      const skill = await getAgentSkillVisibleToUser(id, user.email);
      if (!skill) throw new ApiError("Skill not found", 404);

      // Listing
      if (!searchParams.get("file")) {
        const tree = listDir(skill, relPath);
        return successResponse({ entries: tree, path: relPath });
      }

      // Single file fetch
      const target = searchParams.get("file") ?? relPath;
      const cleanTarget = sanitizePath(target);
      const content = readFile(skill, cleanTarget);
      if (content == null) throw new ApiError("File not found", 404);
      return successResponse({
        path: cleanTarget,
        content,
        size: Buffer.byteLength(content, "utf-8"),
        truncated: false,
        type: "text",
      });
    });
  },
);

interface PutBody {
  path: string;
  content: string;
}

export const PUT = withErrorHandler(
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
      if (!userCanModifyAgentSkill(skill, user)) {
        throw new ApiError("You don't have permission to edit this skill", 403);
      }

      const body = (await request.json()) as PutBody;
      const path = sanitizePath(body?.path ?? "");
      if (!path) throw new ApiError("`path` is required", 400);
      const content = typeof body.content === "string" ? body.content : "";
      if (Buffer.byteLength(content, "utf-8") > MAX_FILE_BYTES) {
        throw new ApiError(
          `File exceeds ${MAX_FILE_BYTES} byte limit`,
          413,
        );
      }

      const collection = await getCollection<AgentSkill>("agent_skills");
      const now = new Date();

      if (path === SKILL_MD_PATH) {
        await collection.updateOne(
          { id },
          { $set: { skill_content: content, updated_at: now } },
        );
      } else {
        const ancillary = { ...(skill.ancillary_files ?? {}) };
        if (
          !ancillary[path] &&
          Object.keys(ancillary).length >= MAX_TOTAL_FILES
        ) {
          throw new ApiError(
            `Skill exceeds the ${MAX_TOTAL_FILES} file cap`,
            413,
          );
        }
        ancillary[path] = content;
        await collection.updateOne(
          { id },
          { $set: { ancillary_files: ancillary, updated_at: now } },
        );
      }
      return successResponse({ path, size: Buffer.byteLength(content, "utf-8") });
    });
  },
);

export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    if (STORAGE_TYPE !== "mongodb") {
      throw new ApiError("Skills require MongoDB to be configured", 503);
    }
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const path = sanitizePath(searchParams.get("path") ?? "");
    if (!path) throw new ApiError("`path` query param is required", 400);

    return await withAuth(request, async (_req, user) => {
      const skill = await getAgentSkillVisibleToUser(id, user.email);
      if (!skill) throw new ApiError("Skill not found", 404);
      if (!userCanModifyAgentSkill(skill, user)) {
        throw new ApiError("You don't have permission to edit this skill", 403);
      }
      const collection = await getCollection<AgentSkill>("agent_skills");
      const now = new Date();
      if (path === SKILL_MD_PATH) {
        await collection.updateOne(
          { id },
          { $set: { skill_content: "", updated_at: now } },
        );
      } else {
        const ancillary = { ...(skill.ancillary_files ?? {}) };
        if (!(path in ancillary)) {
          throw new ApiError("File not found", 404);
        }
        delete ancillary[path];
        await collection.updateOne(
          { id },
          { $set: { ancillary_files: ancillary, updated_at: now } },
        );
      }
      return successResponse({ path, deleted: true });
    });
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizePath(raw: string): string {
  const cleaned = raw.replace(/^\/+|\/+$/g, "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("/")) {
    throw new ApiError("Absolute paths are not allowed", 400);
  }
  const parts = cleaned.split("/");
  if (parts.some((p) => p === ".." || p === "" || p === ".")) {
    throw new ApiError("Path traversal segments are not allowed", 400);
  }
  return parts.join("/");
}

/** Project the flat (path → content) map into one directory level. */
function listDir(skill: AgentSkill, relPath: string): ListEntry[] {
  const entries = new Map<string, ListEntry>();
  const allPaths: string[] = [];
  if (skill.skill_content !== undefined) allPaths.push(SKILL_MD_PATH);
  for (const p of Object.keys(skill.ancillary_files ?? {})) allPaths.push(p);

  const prefix = relPath ? `${relPath}/` : "";
  for (const p of allPaths) {
    if (relPath && !p.startsWith(prefix)) continue;
    const remainder = relPath ? p.slice(prefix.length) : p;
    if (!remainder) continue;
    const slash = remainder.indexOf("/");
    if (slash === -1) {
      entries.set(remainder, {
        name: remainder,
        path: relPath ? `${relPath}/${remainder}` : remainder,
        type: "file",
        size:
          p === SKILL_MD_PATH
            ? Buffer.byteLength(skill.skill_content || "", "utf-8")
            : Buffer.byteLength(skill.ancillary_files?.[p] || "", "utf-8"),
      });
    } else {
      const dirName = remainder.slice(0, slash);
      if (!entries.has(dirName)) {
        entries.set(dirName, {
          name: dirName,
          path: relPath ? `${relPath}/${dirName}` : dirName,
          type: "dir",
        });
      }
    }
  }
  return [...entries.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function readFile(skill: AgentSkill, path: string): string | null {
  if (path === SKILL_MD_PATH) return skill.skill_content ?? "";
  const ancillary = skill.ancillary_files ?? {};
  return path in ancillary ? ancillary[path] : null;
}

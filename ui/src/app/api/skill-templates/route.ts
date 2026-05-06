import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ScanStatus } from "@/types/agent-skill";
import fs from "fs";
import path from "path";

/**
 * Skill Templates API
 *
 * GET /api/skill-templates
 * Returns built-in SKILL.md templates loaded from the filesystem.
 *
 * Supports two directory layouts:
 *
 * 1. **Folder-per-skill** (local dev):
 *    skills/review-specific-pr/SKILL.md
 *    skills/review-specific-pr/metadata.json
 *
 * 2. **Flat ConfigMap** (Kubernetes):
 *    skills/review-specific-pr--SKILL.md
 *    skills/review-specific-pr--metadata.json
 *
 * The dir is controlled by the SKILLS_DIR env var. Defaults to the
 * chart's data/skills directory for local development.
 *
 * Templates are cached for 30 seconds so new skills appear without a rebuild.
 */

interface SkillTemplateResponse {
  id: string;
  name: string;
  description: string;
  title: string;
  category: string;
  icon: string;
  tags: string[];
  content: string;
  /** Cached scan status (from `builtin_skill_scans`), if any. */
  scan_status?: ScanStatus;
  scan_summary?: string;
  scan_updated_at?: string;
}

interface BuiltinScanDoc {
  id: string;
  scan_status: ScanStatus;
  scan_summary?: string;
  scan_updated_at?: Date;
}

const BUILTIN_SCAN_COLLECTION = "builtin_skill_scans";

/**
 * Best-effort lookup of cached built-in scan results, keyed by template id.
 * Mongo is the source of truth; if it's unreachable we just return an empty
 * map so the gallery shows "Unscanned" badges instead of erroring.
 */
async function loadBuiltinScans(): Promise<Map<string, BuiltinScanDoc>> {
  if (!isMongoDBConfigured) return new Map();
  try {
    const col = await getCollection<BuiltinScanDoc>(BUILTIN_SCAN_COLLECTION);
    const docs = await col
      .find({})
      .project<BuiltinScanDoc>({ _id: 0 })
      .toArray();
    return new Map(docs.map((d) => [d.id, d]));
  } catch (err) {
    console.warn("[SkillTemplates] Failed to load built-in scan cache:", err);
    return new Map();
  }
}

interface SkillMetadata {
  title?: string;
  category?: string;
  icon?: string;
  tags?: string[];
}

function resolveSkillsDir(): string {
  if (process.env.SKILLS_DIR) {
    return process.env.SKILLS_DIR;
  }

  const chartPath = path.resolve(
    process.cwd(),
    "..",
    "charts",
    "ai-platform-engineering",
    "data",
    "skills"
  );
  if (fs.existsSync(chartPath)) {
    return chartPath;
  }

  const localPath = path.resolve(process.cwd(), "data", "skills");
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  return chartPath;
}

function parseFrontmatter(content: string): { name: string; description: string } {
  let name = "";
  let description = "";
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (match) {
    for (const line of match[1].split("\n")) {
      const nameMatch = line.match(/^name:\s*(.*)/);
      if (nameMatch) name = nameMatch[1].trim();
      const descMatch = line.match(/^description:\s*(.*)/);
      if (descMatch) description = descMatch[1].trim();
    }
  }
  return { name, description };
}

function parseMetadata(raw: string): SkillMetadata {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildTemplate(
  id: string,
  content: string,
  metadata: SkillMetadata
): SkillTemplateResponse {
  const fm = parseFrontmatter(content);
  return {
    id: fm.name || id,
    name: fm.name || id,
    description: fm.description,
    title: metadata.title || fm.name || id,
    category: metadata.category || "Custom",
    icon: metadata.icon || "Zap",
    tags: metadata.tags || [],
    content,
  };
}

/**
 * Load from folder-per-skill layout:
 *   <dir>/<skill-id>/SKILL.md
 *   <dir>/<skill-id>/metadata.json
 */
function loadFromFolderLayout(skillsDir: string): SkillTemplateResponse[] {
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const templates: SkillTemplateResponse[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const metadataPath = path.join(skillsDir, entry.name, "metadata.json");
      const metadata = fs.existsSync(metadataPath)
        ? parseMetadata(fs.readFileSync(metadataPath, "utf-8"))
        : {};

      templates.push(buildTemplate(entry.name, content, metadata));
    } catch (err) {
      console.error(`[SkillTemplates] Error loading ${entry.name}:`, err);
    }
  }

  return templates;
}

/**
 * Load from flat ConfigMap layout:
 *   <dir>/<skill-id>--SKILL.md
 *   <dir>/<skill-id>--metadata.json
 */
function loadFromFlatLayout(skillsDir: string): SkillTemplateResponse[] {
  const files = fs.readdirSync(skillsDir);
  const skillFiles = files.filter((f) => f.endsWith("--SKILL.md"));
  const templates: SkillTemplateResponse[] = [];

  for (const skillFile of skillFiles) {
    const id = skillFile.replace("--SKILL.md", "");
    try {
      const content = fs.readFileSync(path.join(skillsDir, skillFile), "utf-8");
      const metaFile = `${id}--metadata.json`;
      const metadata = files.includes(metaFile)
        ? parseMetadata(fs.readFileSync(path.join(skillsDir, metaFile), "utf-8"))
        : {};

      templates.push(buildTemplate(id, content, metadata));
    } catch (err) {
      console.error(`[SkillTemplates] Error loading flat skill ${id}:`, err);
    }
  }

  return templates;
}

function loadSkillTemplates(skillsDir: string): SkillTemplateResponse[] {
  if (!fs.existsSync(skillsDir)) {
    console.warn(`[SkillTemplates] Skills directory not found: ${skillsDir}`);
    return [];
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const hasSubdirs = entries.some((e) => e.isDirectory());
  const hasFlatFiles = entries.some((e) => e.isFile() && e.name.endsWith("--SKILL.md"));

  let templates: SkillTemplateResponse[];

  if (hasSubdirs) {
    templates = loadFromFolderLayout(skillsDir);
  } else if (hasFlatFiles) {
    templates = loadFromFlatLayout(skillsDir);
  } else {
    console.warn(`[SkillTemplates] No skill templates found in: ${skillsDir}`);
    return [];
  }

  templates.sort((a, b) => a.title.localeCompare(b.title));
  return templates;
}

// NOTE: We deliberately do NOT cache the response here anymore. The
// loader itself caches the filesystem read for 30s (cheap), and we
// merge in fresh `builtin_skill_scans` results on each request so an
// admin clicking "Scan now" in the gallery sees the new badge without
// waiting up to 30s for the in-memory cache to expire.
export const GET = withErrorHandler(async () => {
  const skillsDir = resolveSkillsDir();
  const [templates, scans] = await Promise.all([
    Promise.resolve(loadSkillTemplates(skillsDir)),
    loadBuiltinScans(),
  ]);

  const merged: SkillTemplateResponse[] = templates.map((tpl) => {
    const scan = scans.get(tpl.id);
    if (!scan) return tpl;
    return {
      ...tpl,
      scan_status: scan.scan_status,
      ...(scan.scan_summary !== undefined
        ? { scan_summary: scan.scan_summary }
        : {}),
      ...(scan.scan_updated_at
        ? {
            scan_updated_at:
              scan.scan_updated_at instanceof Date
                ? scan.scan_updated_at.toISOString()
                : String(scan.scan_updated_at),
          }
        : {}),
    };
  });

  return NextResponse.json(merged);
});

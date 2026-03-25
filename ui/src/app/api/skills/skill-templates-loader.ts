/**
 * Shared loader for filesystem skill templates.
 *
 * Extracted from /api/skill-templates so both /api/skill-templates and
 * /api/skills can reuse the same loading + caching logic.
 */

import fs from "fs";
import path from "path";

export interface SkillTemplateData {
  id: string;
  name: string;
  description: string;
  title: string;
  category: string;
  icon: string;
  tags: string[];
  content: string;
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
    "skills",
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

function parseFrontmatter(content: string): {
  name: string;
  description: string;
} {
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

interface SkillMetadata {
  title?: string;
  category?: string;
  icon?: string;
  tags?: string[];
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
  metadata: SkillMetadata,
): SkillTemplateData {
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

function loadFromFolderLayout(skillsDir: string): SkillTemplateData[] {
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const templates: SkillTemplateData[] = [];

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

function loadFromFlatLayout(skillsDir: string): SkillTemplateData[] {
  const files = fs.readdirSync(skillsDir);
  const skillFiles = files.filter((f) => f.endsWith("--SKILL.md"));
  const templates: SkillTemplateData[] = [];

  for (const skillFile of skillFiles) {
    const id = skillFile.replace("--SKILL.md", "");
    try {
      const content = fs.readFileSync(
        path.join(skillsDir, skillFile),
        "utf-8",
      );
      const metaFile = `${id}--metadata.json`;
      const metadata = files.includes(metaFile)
        ? parseMetadata(
            fs.readFileSync(path.join(skillsDir, metaFile), "utf-8"),
          )
        : {};

      templates.push(buildTemplate(id, content, metadata));
    } catch (err) {
      console.error(`[SkillTemplates] Error loading flat skill ${id}:`, err);
    }
  }

  return templates;
}

let cachedTemplates: SkillTemplateData[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Load skill templates from the filesystem (cached, 30s TTL).
 */
export function loadSkillTemplatesInternal(): SkillTemplateData[] {
  const now = Date.now();
  if (cachedTemplates && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedTemplates;
  }

  const skillsDir = resolveSkillsDir();
  if (!fs.existsSync(skillsDir)) {
    console.warn(`[SkillTemplates] Skills directory not found: ${skillsDir}`);
    return [];
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const hasSubdirs = entries.some((e) => e.isDirectory());
  const hasFlatFiles = entries.some(
    (e) => e.isFile() && e.name.endsWith("--SKILL.md"),
  );

  let templates: SkillTemplateData[];

  if (hasSubdirs) {
    templates = loadFromFolderLayout(skillsDir);
  } else if (hasFlatFiles) {
    templates = loadFromFlatLayout(skillsDir);
  } else {
    return [];
  }

  templates.sort((a, b) => a.title.localeCompare(b.title));

  cachedTemplates = templates;
  cacheTimestamp = now;

  return templates;
}

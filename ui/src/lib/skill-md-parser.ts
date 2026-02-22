/**
 * SKILL.md Parser & Generator
 *
 * Implements the Anthropic Agent Skills SKILL.md format:
 * https://github.com/anthropics/skills
 *
 * Format: YAML frontmatter (name + description + optional allowed-tools)
 * followed by freeform markdown body.
 *
 * Required frontmatter fields:
 *   - name: A unique identifier for the skill (lowercase, hyphens for spaces)
 *   - description: What the skill does and when to use it
 *
 * Optional frontmatter fields:
 *   - allowed-tools: Comma-separated list of tools the agent may use
 *
 * The markdown body contains all instructions, examples, and guidelines.
 */

export interface ParsedSkillMd {
  /** Skill identifier (kebab-case, from frontmatter) */
  name: string;
  /** What the skill does and when to use it (from frontmatter) */
  description: string;
  /** Human-readable title extracted from first H1, falls back to name */
  title: string;
  /** Full markdown body after frontmatter (instructions, examples, guidelines) */
  body: string;
  /** Map of H2 section heading -> content for structured access */
  sections: Map<string, string>;
  /** Full raw content including frontmatter */
  rawContent: string;
  /** (Experimental) Tool allowlist parsed from frontmatter `allowed-tools` */
  allowedTools: string[];
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/**
 * Parse YAML frontmatter key: value pairs.
 * Handles multi-line description values that continue on subsequent lines.
 */
export function parseFrontmatter(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split("\n");
  let currentKey = "";
  let currentValue = "";

  for (const line of lines) {
    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (keyMatch) {
      if (currentKey) {
        result[currentKey] = currentValue.trim();
      }
      currentKey = keyMatch[1];
      currentValue = keyMatch[2];
    } else if (currentKey) {
      currentValue += " " + line.trim();
    }
  }
  if (currentKey) {
    result[currentKey] = currentValue.trim();
  }
  return result;
}

/**
 * Split markdown body into sections keyed by their H2 heading.
 */
export function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const h2Pattern = /^## (.+)$/gm;
  const headings: { name: string; start: number; end: number }[] = [];
  let match;

  while ((match = h2Pattern.exec(body)) !== null) {
    headings.push({ name: match[1].trim(), start: match.index, end: match.index + match[0].length });
  }

  for (let i = 0; i < headings.length; i++) {
    const contentStart = headings[i].end;
    const contentEnd = i + 1 < headings.length ? headings[i + 1].start : body.length;
    sections.set(headings[i].name, body.slice(contentStart, contentEnd).trim());
  }

  return sections;
}

/**
 * Parse a SKILL.md file into structured data.
 *
 * Follows the Anthropic Agent Skills format:
 * - YAML frontmatter with `name` and `description`
 * - Freeform markdown body
 */
export function parseSkillMd(content: string): ParsedSkillMd {
  const frontmatterMatch = content.match(FRONTMATTER_RE);
  let frontmatter: Record<string, string> = {};
  let body = content;

  if (frontmatterMatch) {
    frontmatter = parseFrontmatter(frontmatterMatch[1]);
    body = content.slice(frontmatterMatch[0].length);
  }

  const titleMatch = body.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : frontmatter.name || "Untitled Skill";

  const sections = splitSections(body);

  const allowedToolsRaw = frontmatter["allowed-tools"] || "";
  const allowedTools = allowedToolsRaw
    ? allowedToolsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    name: frontmatter.name || "",
    description: frontmatter.description || "",
    title,
    body: body.trim(),
    sections,
    rawContent: content,
    allowedTools,
  };
}

/**
 * Generate a SKILL.md string following the Anthropic format.
 *
 * `name` and `description` always go in frontmatter.
 * `allowedTools` is written as `allowed-tools` when provided and non-empty.
 * Everything else is freeform markdown body.
 */
export function generateSkillMd(data: {
  name: string;
  description: string;
  body: string;
  allowedTools?: string[];
}): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`name: ${data.name}`);
  lines.push(`description: ${data.description}`);
  if (data.allowedTools && data.allowedTools.length > 0) {
    lines.push(`allowed-tools: ${data.allowedTools.join(", ")}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(data.body.trim());
  lines.push("");

  return lines.join("\n");
}

/**
 * Update the `allowed-tools` frontmatter field in an existing SKILL.md string
 * without altering the body or other frontmatter fields.
 *
 * If no frontmatter exists the content is returned unchanged.
 */
export function updateAllowedToolsInFrontmatter(
  content: string,
  allowedTools: string[],
): string {
  const fmMatch = content.match(FRONTMATTER_RE);
  if (!fmMatch) return content;

  const fmBlock = fmMatch[1];
  const afterFm = content.slice(fmMatch[0].length);
  const toolsLine = `allowed-tools: ${allowedTools.join(", ")}`;

  const existingLineRe = /^allowed-tools:.*$/m;
  let newFmBlock: string;

  if (existingLineRe.test(fmBlock)) {
    if (allowedTools.length === 0) {
      newFmBlock = fmBlock.replace(/\n?allowed-tools:.*$/m, "");
    } else {
      newFmBlock = fmBlock.replace(existingLineRe, toolsLine);
    }
  } else if (allowedTools.length > 0) {
    newFmBlock = fmBlock + "\n" + toolsLine;
  } else {
    return content;
  }

  return `---\n${newFmBlock.replace(/^\n+/, "")}\n---\n${afterFm}`;
}

/**
 * Create a blank SKILL.md template following the Anthropic format.
 */
export function createBlankSkillMd(): string {
  return generateSkillMd({
    name: "my-skill-name",
    description: "A clear description of what this skill does and when to use it.",
    body: `# My Skill Name

[Add your instructions here that Claude will follow when this skill is active]

## Examples
- Example usage 1
- Example usage 2

## Guidelines
- Guideline 1
- Guideline 2`,
  });
}

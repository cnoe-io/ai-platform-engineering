/**
 * GET /api/skills/bootstrap
 *
 * Returns the bootstrap skill markdown template used by the Skills API Gateway
 * UI page to render the `/skills` slash command.
 *
 * Resolution order (highest priority first):
 *   1. SKILLS_BOOTSTRAP_TEMPLATE env var (raw markdown)
 *   2. File at SKILLS_BOOTSTRAP_FILE env var
 *   3. <repo>/charts/ai-platform-engineering/data/skills/bootstrap.md
 *   4. Built-in fallback string
 *
 * Placeholders ({{COMMAND_NAME}}, {{DESCRIPTION}}, {{BASE_URL}}) are NOT
 * substituted server-side - the client performs substitution so a single
 * template can serve many slash-command variants without re-rendering.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const FALLBACK_TEMPLATE = `---
description: {{DESCRIPTION}}
---

## User Input

\`\`\`text
$ARGUMENTS
\`\`\`

## SECURITY — never expose the API key

- NEVER print, echo, or display the API key in any output.
- All API calls MUST go through the python3 helper which keeps the key internal.

## Steps

1. Search: call the gateway at {{BASE_URL}}/api/skills with header X-Caipe-Catalog-Key.
2. Display results as a table.
3. Offer to install (.claude/commands/<name>.md) or run inline (fetched live).

Slash command: /{{COMMAND_NAME}}
`;

function safeReadFile(filePath: string): string | null {
  try {
    if (!filePath) return null;
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return null;
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;
    // Cap at 256 KiB to prevent runaway reads / DoS.
    if (stat.size > 256 * 1024) {
      console.warn(
        `[skills/bootstrap] file too large (${stat.size} bytes): ${resolved}`,
      );
      return null;
    }
    return fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    console.warn(`[skills/bootstrap] failed to read ${filePath}:`, err);
    return null;
  }
}

function resolveBootstrapTemplate(): { template: string; source: string } {
  const envInline = process.env.SKILLS_BOOTSTRAP_TEMPLATE;
  if (envInline && envInline.trim().length > 0) {
    return { template: envInline, source: "env:SKILLS_BOOTSTRAP_TEMPLATE" };
  }

  const envFile = process.env.SKILLS_BOOTSTRAP_FILE;
  if (envFile) {
    const fromFile = safeReadFile(envFile);
    if (fromFile) {
      return { template: fromFile, source: `file:${envFile}` };
    }
  }

  const chartPath = path.resolve(
    process.cwd(),
    "..",
    "charts",
    "ai-platform-engineering",
    "data",
    "skills",
    "bootstrap.md",
  );
  const fromChart = safeReadFile(chartPath);
  if (fromChart) {
    return { template: fromChart, source: `file:${chartPath}` };
  }

  return { template: FALLBACK_TEMPLATE, source: "fallback" };
}

export async function GET() {
  const { template, source } = resolveBootstrapTemplate();
  return NextResponse.json(
    {
      template,
      source,
      placeholders: ["{{COMMAND_NAME}}", "{{DESCRIPTION}}", "{{BASE_URL}}"],
      defaults: {
        command_name: "skills",
        description: "Browse and install skills from the CAIPE skill catalog",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

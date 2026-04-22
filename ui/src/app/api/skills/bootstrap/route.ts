/**
 * GET /api/skills/bootstrap
 *
 * Returns the bootstrap skill template used by the Skills API Gateway UI to
 * render the `/skills` slash command for a particular coding agent.
 *
 * Query params:
 *   - agent:        agent id (claude | cursor | specify | codex | gemini |
 *                   continue). Defaults to "claude". Unknown values fall back
 *                   to the default and are reported in `agent_fallback`.
 *   - scope:        install scope ("user" | "project"). Optional. When omitted
 *                   the response surfaces `scopes_available` so the UI can
 *                   force the user to pick before showing install commands.
 *                   When the requested scope is unsupported by the agent
 *                   (e.g. ?agent=codex&scope=project), `install_path` is
 *                   `null` and `scope_fallback` is `true`.
 *   - command_name: slash command name to substitute for {{COMMAND_NAME}}.
 *                   Defaults to "skills".
 *   - description:  short description for the command. Defaults to the
 *                   frontmatter `description:` of the canonical template.
 *   - base_url:     gateway base URL. Defaults to the request origin.
 *
 * Canonical template resolution (highest priority first):
 *   1. SKILLS_BOOTSTRAP_TEMPLATE env var (raw markdown)
 *   2. File at SKILLS_BOOTSTRAP_FILE env var
 *   3. <repo>/charts/ai-platform-engineering/data/skills/bootstrap.md
 *   4. Built-in fallback string
 *
 * The canonical template is parsed once and re-rendered per agent (Markdown
 * frontmatter, plain Markdown, Gemini TOML, or Continue JSON fragment).
 *
 * Response shape (stable):
 *   {
 *     // Per-agent rendered artifact + metadata
 *     agent: "claude",
 *     agent_fallback: false,
 *     label: "Claude Code",
 *     template: "<rendered file contents>",
 *     install_path: "~/.claude/commands/skills.md" | null,
 *     install_paths: { user?: string, project?: string },
 *     scope: "user" | "project" | null,
 *     scope_requested: "user" | "project" | null,
 *     scope_fallback: false,
 *     scopes_available: ["user", "project"],
 *     file_extension: "md",
 *     format: "markdown-frontmatter",
 *     is_fragment: false,
 *     launch_guide: "Markdown launch instructions",
 *     docs_url: "https://...",
 *
 *     // Catalog of all known agents (for the UI dropdown)
 *     agents: [{id, label, ext, format, install_paths, scopes_available, is_fragment, docs_url}],
 *
 *     // Source of the canonical template (for operator visibility)
 *     source: "file:/app/data/skills-bootstrap/bootstrap.md",
 *
 *     // Inputs used (after defaulting)
 *     inputs: { command_name, description, base_url },
 *
 *     // Original canonical template + placeholders (for debugging / advanced UIs)
 *     canonical_template: "...",
 *     placeholders: ["{{COMMAND_NAME}}", "{{DESCRIPTION}}", "{{BASE_URL}}", "{{ARG_REF}}"],
 *     defaults: { command_name, description },
 *   }
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  AGENTS,
  DEFAULT_AGENT_ID,
  layoutsAvailableFor,
  renderForAgent,
  scopesAvailableFor,
  type AgentLayout,
  type AgentScope,
  type AgentSpec,
} from "./agents";
import { getRequestOrigin } from "../_lib/request-origin";

const FALLBACK_TEMPLATE = `---
description: Browse and install skills from the CAIPE skill catalog
---

## User Input

\`\`\`text
{{ARG_REF}}
\`\`\`

## SECURITY — never expose the API key

- NEVER print, echo, or display the API key in any output.
- All API calls MUST go through the python3 helper which keeps the key internal.

## Steps

1. Search: call the gateway at {{BASE_URL}}/api/skills with header X-Caipe-Catalog-Key.
2. Display results as a table.
3. Offer to install or run inline (fetched live).

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

/**
 * Validate slash-command name. Allow letters, digits, hyphens, underscores,
 * dots; cap length. Anything else falls back to the default.
 */
function sanitizeCommandName(raw: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "skills";
  if (trimmed.length > 64) return "skills";
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return "skills";
  return trimmed;
}

/** Cap description length to keep frontmatter sane. */
function sanitizeDescription(raw: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 500);
}

/**
 * Validate base URL: only http(s), no embedded credentials, no path traversal.
 * Returns null if invalid.
 */
function sanitizeBaseUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    // Strip trailing slashes for consistency.
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function selectAgent(raw: string | null): {
  agent: AgentSpec;
  fallback: boolean;
} {
  const id = (raw ?? "").trim().toLowerCase();
  if (id && AGENTS[id]) return { agent: AGENTS[id], fallback: false };
  return { agent: AGENTS[DEFAULT_AGENT_ID], fallback: !!id };
}

/**
 * Validate scope. Returns `null` when no scope was requested (the UI hasn't
 * forced a choice yet) so the caller can render scopes_available without
 * defaulting silently. Unknown values also collapse to `null` (the renderer
 * then sets `scope_fallback`).
 */
export function selectScope(raw: string | null): AgentScope | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "user" || v === "project") return v;
  return null;
}

/**
 * Validate layout. Returns `null` when no layout was requested so the
 * renderer can pick the agent's default. Unknown values also collapse to
 * `null` (the renderer then sets `layout_fallback: false` since there was
 * no real request to honor).
 */
export function selectLayout(raw: string | null): AgentLayout | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "skills" || v === "commands") return v;
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { agent, fallback } = selectAgent(url.searchParams.get("agent"));
  const requestedScope = selectScope(url.searchParams.get("scope"));
  const requestedLayout = selectLayout(url.searchParams.get("layout"));

  const commandName = sanitizeCommandName(url.searchParams.get("command_name"));
  const descriptionInput = sanitizeDescription(
    url.searchParams.get("description"),
  );
  // `request.url` is the internal listen address behind an ingress;
  // the public origin lives on x-forwarded-* headers. Use the helper.
  const baseUrl =
    sanitizeBaseUrl(url.searchParams.get("base_url")) ??
    getRequestOrigin(request);

  const { template: canonicalTemplate, source } = resolveBootstrapTemplate();

  const rendered = renderForAgent(agent, {
    canonicalTemplate,
    commandName,
    description: descriptionInput,
    baseUrl,
    scope: requestedScope,
    layout: requestedLayout,
  });

  return NextResponse.json(
    {
      agent: agent.id,
      agent_fallback: fallback,
      label: rendered.label,
      template: rendered.template,
      // Scope-aware install metadata.
      install_path: rendered.install_path,
      install_paths: rendered.install_paths,
      scope: rendered.scope,
      scope_requested: requestedScope,
      scope_fallback: rendered.scope_fallback,
      scopes_available: rendered.scopes_available,
      file_extension: rendered.file_extension,
      format: rendered.format,
      is_fragment: rendered.is_fragment,
      launch_guide: rendered.launch_guide,
      docs_url: rendered.docs_url,
      // Layout-aware metadata so the UI can render the layout toggle.
      layout: rendered.layout,
      layout_requested: requestedLayout,
      layout_fallback: rendered.layout_fallback,
      layouts_available: rendered.layouts_available,

      agents: Object.values(AGENTS).map((a) => {
        const layouts = layoutsAvailableFor(a);
        // Each agent advertises install_paths for ALL supported (layout, scope)
        // combinations so the UI can drive the toggle without re-fetching.
        const pathsByLayout: Partial<
          Record<AgentLayout, Partial<Record<AgentScope, string>>>
        > = {};
        for (const lay of layouts) {
          const scopes = scopesAvailableFor(a, lay);
          const layPaths: Partial<Record<AgentScope, string>> = {};
          const tpl = lay === "skills" && a.skillsPaths
            ? a.skillsPaths
            : a.installPaths;
          for (const s of scopes) {
            layPaths[s] = tpl[s]!.replace(/\{name\}/g, commandName);
          }
          pathsByLayout[lay] = layPaths;
        }
        // Back-compat: keep top-level `install_paths` keyed by the agent's
        // default layout (matches pre-skills-layout behavior).
        const defaultLayoutForAgent = layouts[0];
        return {
          id: a.id,
          label: a.label,
          ext: a.ext,
          format: a.format,
          install_paths: pathsByLayout[defaultLayoutForAgent] ?? {},
          install_paths_by_layout: pathsByLayout,
          scopes_available: scopesAvailableFor(a, defaultLayoutForAgent),
          layouts_available: layouts,
          default_layout: defaultLayoutForAgent,
          is_fragment: !!a.isFragment,
          docs_url: a.docsUrl,
        };
      }),

      source,
      inputs: {
        command_name: commandName,
        description: descriptionInput,
        base_url: baseUrl,
        scope: requestedScope,
        layout: requestedLayout,
      },
      canonical_template: canonicalTemplate,
      placeholders: [
        "{{COMMAND_NAME}}",
        "{{DESCRIPTION}}",
        "{{BASE_URL}}",
        "{{ARG_REF}}",
      ],
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

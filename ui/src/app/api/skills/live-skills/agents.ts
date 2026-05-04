/**
 * Agent registry + per-agent rendering for the live-skills skill.
 *
 * One canonical Markdown template (with `---\ndescription:\n---` frontmatter
 * and `{{COMMAND_NAME}}`, `{{DESCRIPTION}}`, `{{BASE_URL}}`, `{{ARG_REF}}`
 * placeholders) is parsed once, then re-wrapped per agent surface
 * (Markdown frontmatter, plain Markdown, Gemini TOML, or Continue JSON
 * fragment).
 *
 * Adding a new agent = one entry in AGENTS + one case in renderForAgent().
 */

export type AgentFormat =
  | "markdown-frontmatter"
  | "markdown-plain"
  | "gemini-toml"
  | "continue-json-fragment";

/**
 * Where on disk the rendered artifact lives.
 *
 * - `user`    — user-global (under `~`), reused across every project
 * - `project` — project-local (under the current repo), version-controllable
 *
 * Not every agent supports both scopes:
 * - Codex CLI only loads prompts from `~/.codex/prompts/` (project scope is
 *   "not planned" upstream — openai/codex#9848). Project scope is `undefined`.
 * - Spec Kit's slash commands live in `./.specify/templates/commands/` and
 *   are re-synced into agent dirs by `specify` itself; user-scope is an open
 *   feature request (github/spec-kit#317). User scope is `undefined`.
 */
export type AgentScope = "user" | "project";

/**
 * Agent file-system layout for skill artifacts.
 *
 * - `commands` — legacy slash-command layout (`<dir>/commands/{name}.<ext>`),
 *   one file per command. This is what shipped first, and is the only
 *   layout supported by Codex CLI, Spec Kit, Continue, and Gemini today.
 * - `skills`  — modern skills layout (`<dir>/skills/{name}/SKILL.md`), one
 *   directory per skill containing a canonical `SKILL.md`. Standardized by
 *   Claude Code (Oct 2025), Cursor, and opencode; all three back-scan
 *   `.claude/skills/` for cross-agent compatibility.
 *
 * The live-skills UI exposes this as a per-agent toggle for agents that
 * support both layouts (Claude, Cursor today). Agents without a
 * `skillsPaths` entry only support `commands`.
 */
export type AgentLayout = "commands" | "skills";

export interface AgentSpec {
  /** Stable id used in URLs (e.g. ?agent=gemini). */
  id: string;
  /** Human-readable label for the UI dropdown. */
  label: string;
  /** File extension for the rendered artifact (no leading dot). */
  ext: string;
  /**
   * Install paths per scope, for the legacy `commands` layout. `{name}` is
   * replaced with the slash command name.
   * Tilde paths (`~/...`) are expanded at install time by the shell or the
   * generated install.sh. Project paths use a leading `./` so they're
   * unambiguous in shell snippets.
   *
   * If a scope key is missing, the agent does not support that scope and the
   * UI should disable the radio for it.
   */
  installPaths: Partial<Record<AgentScope, string>>;
  /**
   * Install paths per scope for the modern `skills` layout
   * (`<dir>/skills/{name}/SKILL.md`). Optional: present only for agents
   * that support the skills layout (Claude, Cursor today).
   *
   * The path MUST end in `/{name}/SKILL.md` so `commandsDirFor()` can
   * strip the trailing two segments to find the parent skills directory
   * for bulk installs.
   */
  skillsPaths?: Partial<Record<AgentScope, string>>;
  /**
   * Default layout for this agent. If `skillsPaths` is present and this
   * is unset, `skills` is used as the default. If `skillsPaths` is absent,
   * `commands` is the only choice regardless of this field.
   */
  defaultLayout?: AgentLayout;
  /** How to wrap the canonical body. */
  format: AgentFormat;
  /**
   * Reference syntax for "the user's argument" in the agent's slash-command
   * surface. Substituted into the template's `{{ARG_REF}}` placeholder.
   */
  argRef: string;
  /**
   * Short, copy-pasteable launch + invocation guidance shown in the UI after
   * the install step. Markdown allowed. Use `{name}` for the slash command.
   */
  launchGuide: string;
  /**
   * If true, the rendered artifact is a *fragment* meant to be merged into
   * an existing config file (rather than dropped as a standalone file).
   * The UI renders different install instructions in this case.
   */
  isFragment?: boolean;
  /** Optional homepage / docs link. */
  docsUrl?: string;
}

export const AGENTS: Record<string, AgentSpec> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    ext: "md",
    installPaths: {
      user: "~/.claude/commands/{name}.md",
      project: "./.claude/commands/{name}.md",
    },
    skillsPaths: {
      user: "~/.claude/skills/{name}/SKILL.md",
      project: "./.claude/skills/{name}/SKILL.md",
    },
    defaultLayout: "skills",
    format: "markdown-frontmatter",
    argRef: "$ARGUMENTS",
    docsUrl: "https://docs.claude.com/en/docs/claude-code",
    launchGuide: [
      "**Install Claude Code**:",
      "```bash",
      "npm install -g @anthropic-ai/claude-code",
      "# or: brew install --cask claude-code",
      "```",
      "",
      "**Launch from your repo root**:",
      "```bash",
      "claude",
      "```",
      "",
      "**Use the command**:",
      "- `/{name}` &mdash; browse the catalog",
      "- `/{name} kubernetes` &mdash; search",
      "- `/{name} run create-ci-pipeline` &mdash; fetch & execute inline",
      "- `/{name} install create-ci-pipeline` &mdash; save locally",
      "",
      "Claude Code auto-discovers commands in `./.claude/commands/` (per-repo) and `~/.claude/commands/` (user-global).",
    ].join("\n"),
  },

  cursor: {
    id: "cursor",
    label: "Cursor",
    ext: "md",
    installPaths: {
      user: "~/.cursor/commands/{name}.md",
      project: "./.cursor/commands/{name}.md",
    },
    skillsPaths: {
      user: "~/.cursor/skills/{name}/SKILL.md",
      project: "./.cursor/skills/{name}/SKILL.md",
    },
    defaultLayout: "skills",
    format: "markdown-frontmatter",
    argRef: "$ARGUMENTS",
    docsUrl: "https://docs.cursor.com",
    launchGuide: [
      "**Install Cursor**: download from [cursor.com](https://cursor.com).",
      "",
      "**Open the repo in Cursor**, then open the chat (`Cmd/Ctrl + L`).",
      "",
      "**Use the command** in the chat:",
      "- `/{name}` &mdash; browse the catalog",
      "- `/{name} pipeline` &mdash; search",
      "- `/{name} run <skill>` &mdash; fetch & execute inline",
      "",
      "Cursor reads slash commands from `./.cursor/commands/` per repo and `~/.cursor/commands/` user-global. Reload the window if a new command does not appear in the picker.",
    ].join("\n"),
  },

  specify: {
    id: "specify",
    label: "Spec Kit",
    ext: "md",
    installPaths: {
      // No user/global scope yet — github/spec-kit#317.
      project: "./.specify/templates/commands/{name}.md",
    },
    format: "markdown-frontmatter",
    argRef: "$ARGUMENTS",
    docsUrl: "https://github.com/github/spec-kit",
    launchGuide: [
      "**Install Spec Kit** (uses `uv`):",
      "```bash",
      "uvx --from git+https://github.com/github/spec-kit.git specify init",
      "```",
      "",
      "Spec Kit re-syncs commands into the agent-specific directory (`./.claude/commands/`, `./.cursor/commands/`, etc.) the next time you run a Spec Kit command. Use `/specify`, `/plan`, `/tasks`, `/implement` as usual; the new `/{name}` command becomes available alongside them.",
      "",
      "_Spec Kit only supports project-local commands today (see github/spec-kit#317 for user-global support)._",
    ].join("\n"),
  },

  codex: {
    id: "codex",
    label: "Codex CLI (OpenAI)",
    ext: "md",
    installPaths: {
      // No project scope — openai/codex#9848 closed as not planned.
      user: "~/.codex/prompts/{name}.md",
    },
    format: "markdown-plain",
    // Codex CLI substitutes positional args; $1 is the first argument string.
    argRef: "$1",
    docsUrl: "https://github.com/openai/codex",
    launchGuide: [
      "**Install Codex CLI**:",
      "```bash",
      "npm install -g @openai/codex",
      "# or: brew install codex",
      "```",
      "",
      "**Launch**:",
      "```bash",
      "codex",
      "```",
      "",
      "**Use the prompt** from inside Codex with the slash menu, or invoke directly:",
      "- `/{name}` &mdash; runs the prompt with no argument (browse mode)",
      "- `/{name} kubernetes` &mdash; runs the prompt with `$1=\"kubernetes\"` (search mode)",
      "",
      "Codex CLI only loads prompts from `~/.codex/prompts/` (user-global); project-local prompts are not supported (openai/codex#9848). Codex picks them up on next launch.",
    ].join("\n"),
  },

  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    ext: "toml",
    installPaths: {
      user: "~/.gemini/commands/{name}.toml",
      project: "./.gemini/commands/{name}.toml",
    },
    format: "gemini-toml",
    // Gemini CLI uses $1 (or {{args}}); $1 is portable across recent versions.
    argRef: "$1",
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    launchGuide: [
      "**Install Gemini CLI**:",
      "```bash",
      "npm install -g @google/gemini-cli",
      "```",
      "",
      "**Launch from your repo root**:",
      "```bash",
      "gemini",
      "```",
      "",
      "**Use the command**:",
      "- `/{name}` &mdash; browse the catalog",
      "- `/{name} \"docker\"` &mdash; search (quote multi-word args)",
      "",
      "Commands live in `~/.gemini/commands/` (user-global) or `./.gemini/commands/` (per-repo). Gemini reloads commands on each invocation.",
    ].join("\n"),
  },

  continue: {
    id: "continue",
    label: "Continue (VS Code / JetBrains)",
    ext: "json",
    installPaths: {
      user: "~/.continue/config.json",
      project: "./.continue/config.json",
    },
    format: "continue-json-fragment",
    isFragment: true,
    // Continue passes the full slash-command string after the name; we use a
    // sentinel that the prompt template references in plain prose.
    argRef: "{{input}}",
    docsUrl: "https://docs.continue.dev",
    launchGuide: [
      "**Install Continue**: from the VS Code or JetBrains marketplace.",
      "",
      "**Add the command**: open the target `config.json` (`~/.continue/config.json` for user-global, `./.continue/config.json` for project-local) and merge the rendered fragment into the top-level `slashCommands` array (create the array if it does not exist):",
      "",
      "```json",
      "{",
      "  // ... existing config ...",
      "  \"slashCommands\": [",
      "    /* paste the rendered fragment here */",
      "  ]",
      "}",
      "```",
      "",
      "**Use it**: open the Continue chat panel and type `/{name}`. Continue reloads `config.json` automatically.",
    ].join("\n"),
  },
};

export const DEFAULT_AGENT_ID = "claude";

/* ---------- Markdown parsing & rendering helpers ---------- */

interface ParsedTemplate {
  description: string;
  body: string;
}

/**
 * Strip a leading YAML-ish frontmatter block (`---\n...\n---`) and capture
 * the `description:` field if present. Body retains everything after the
 * closing `---` (or the full input if no frontmatter).
 *
 * Intentionally conservative: only single-line `key: value` pairs are
 * recognized; multi-line/folded scalars are left in the body. The live-skills
 * template uses only `description:` so this is sufficient.
 */
export function parseFrontmatter(template: string): ParsedTemplate {
  const match = template.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { description: "", body: template };

  let description = "";
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv && kv[1] === "description") {
      description = kv[2].trim();
      break;
    }
  }

  return { description, body: template.slice(match[0].length) };
}

/** Substitute the four canonical placeholders. */
export function substitutePlaceholders(
  body: string,
  vars: { commandName: string; description: string; baseUrl: string; argRef: string },
): string {
  return body
    .replace(/\{\{COMMAND_NAME\}\}/g, vars.commandName)
    .replace(/\{\{DESCRIPTION\}\}/g, vars.description)
    .replace(/\{\{BASE_URL\}\}/g, vars.baseUrl)
    .replace(/\{\{ARG_REF\}\}/g, vars.argRef);
}

/**
 * Quote a string for safe inclusion in single-line YAML `key: value`. Wraps
 * in double quotes and escapes only `"` and `\`.
 */
function quoteYaml(value: string): string {
  // Plain values are fine if they don't contain YAML-significant characters.
  if (!/[:#\n"'\\&*!|>{}[\],%@`]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Render a TOML basic string, escaping `"` and backslash. Single line only.
 */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Render a TOML multi-line basic string. The only sequence that breaks a
 * multi-line basic string is a literal `"""`, so we escape the closing
 * delimiter only. Backslashes are preserved as-is (TOML multi-line basic
 * strings interpret `\` as an escape, but for our prose content we want
 * literal output, so we double up backslashes too).
 */
function tomlMultiline(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  return `"""\n${escaped}"""`;
}

/* ---------- Per-agent rendering ---------- */

export interface RenderResult {
  /** Final artifact contents (Markdown, TOML, or JSON fragment). */
  template: string;
  /**
   * Resolved install path for the requested (layout, scope), with `{name}`
   * substituted. `null` if that combination is unsupported.
   */
  install_path: string | null;
  /**
   * All install paths the agent supports for the resolved layout
   * (`{name}` substituted), keyed by scope. Lets the UI render the scope
   * chooser without re-fetching per scope.
   */
  install_paths: Partial<Record<AgentScope, string>>;
  /** Scopes the agent actually supports for the resolved layout. */
  scopes_available: AgentScope[];
  /** The scope that was actually rendered (may differ if requested was unsupported). */
  scope: AgentScope | null;
  /** True if the requested scope was unsupported and we returned no install_path. */
  scope_fallback: boolean;
  /** Layouts the agent supports, in display order. */
  layouts_available: AgentLayout[];
  /** The layout that was actually rendered. */
  layout: AgentLayout;
  /** True if the requested layout was unsupported and we fell back to the default. */
  layout_fallback: boolean;
  /** File extension (no leading dot). */
  file_extension: string;
  /** Format identifier — useful for the UI to choose syntax highlighting. */
  format: AgentFormat;
  /** True if `template` is a fragment to merge, not a standalone file. */
  is_fragment: boolean;
  /** Launch & invocation guidance, with `{name}` substituted. */
  launch_guide: string;
  /** Optional docs link for the agent. */
  docs_url?: string;
  /** Human-readable agent label. */
  label: string;
}

export interface RenderInputs {
  canonicalTemplate: string;
  commandName: string;
  description: string;
  baseUrl: string;
  /**
   * Requested install scope. If `null` / undefined, no `install_path` is
   * resolved (the UI is expected to require a scope before showing install
   * commands). If the requested scope is unsupported by the agent,
   * `install_path` is `null` and `scope_fallback` is `true`.
   */
  scope?: AgentScope | null;
  /**
   * Requested layout. If `null` / undefined, the agent's `defaultLayout` is
   * used (or `commands` if neither is set). If the requested layout is not
   * supported by the agent, falls back to the default and sets
   * `layout_fallback: true` on the result.
   */
  layout?: AgentLayout | null;
}

/** Resolve the install-paths map for a given layout. */
function pathsForLayout(
  agent: AgentSpec,
  layout: AgentLayout,
): Partial<Record<AgentScope, string>> {
  if (layout === "skills" && agent.skillsPaths) return agent.skillsPaths;
  return agent.installPaths;
}

/** Helper: list of scopes the agent supports for the given layout. */
export function scopesAvailableFor(
  agent: AgentSpec,
  layout: AgentLayout = layoutsAvailableFor(agent)[0],
): AgentScope[] {
  const paths = pathsForLayout(agent, layout);
  const out: AgentScope[] = [];
  if (paths.user) out.push("user");
  if (paths.project) out.push("project");
  return out;
}

/** Helper: list of layouts the agent supports, default-first. */
export function layoutsAvailableFor(agent: AgentSpec): AgentLayout[] {
  const out: AgentLayout[] = [];
  // Prefer the agent's stated default if present.
  if (agent.defaultLayout === "skills" && agent.skillsPaths) {
    out.push("skills");
    if (Object.keys(agent.installPaths).length > 0) out.push("commands");
    return out;
  }
  if (Object.keys(agent.installPaths).length > 0) out.push("commands");
  if (agent.skillsPaths) out.push("skills");
  return out;
}

export function renderForAgent(agent: AgentSpec, inputs: RenderInputs): RenderResult {
  const parsed = parseFrontmatter(inputs.canonicalTemplate);

  // The canonical live-skills.md ships `description: {{DESCRIPTION}}` so the
  // single template can be reused across agents. If we picked that string up
  // verbatim it would land in the rendered frontmatter as
  // `description: "{{DESCRIPTION}}"` (quoteYaml double-quotes anything with
  // curly braces) and the agent would see the literal placeholder. Treat any
  // value that still contains an unsubstituted `{{...}}` token as missing and
  // fall through to the inputs/default. (See PR #1268 review feedback.)
  const parsedDesc = parsed.description.trim();
  const parsedDescIsPlaceholder = /\{\{\w+\}\}/.test(parsedDesc);
  const description =
    inputs.description.trim() ||
    (parsedDescIsPlaceholder ? "" : parsedDesc) ||
    "Browse and install skills from the CAIPE skill catalog";

  const body = substitutePlaceholders(parsed.body, {
    commandName: inputs.commandName,
    description,
    baseUrl: inputs.baseUrl,
    argRef: agent.argRef,
  }).replace(/^\n+/, ""); // strip leading blank lines from frontmatter strip

  // Resolve the layout. If caller asked for `skills` but agent doesn't
  // support it, fall back to the agent's default layout and flag it.
  const layoutsAvail = layoutsAvailableFor(agent);
  const requestedLayout = inputs.layout ?? null;
  let resolvedLayout: AgentLayout = layoutsAvail[0];
  let layoutFallback = false;
  if (requestedLayout) {
    if (layoutsAvail.includes(requestedLayout)) {
      resolvedLayout = requestedLayout;
    } else {
      layoutFallback = true;
    }
  }

  // For the `skills` layout, every artifact is a Markdown file with
  // frontmatter (Cursor / Claude / opencode all REQUIRE name + description
  // frontmatter for skill auto-discovery). Override the per-agent format
  // when the skills layout is in use to make sure the live-skills skill is
  // discoverable. The frontmatter MUST include `name:` matching the
  // directory name — see Cursor / Claude / opencode docs.
  const useSkillsLayout = resolvedLayout === "skills";

  let rendered: string;
  if (useSkillsLayout) {
    rendered = `---\nname: ${quoteYaml(inputs.commandName)}\ndescription: ${quoteYaml(description)}\n---\n\n${body}`;
  } else {
    switch (agent.format) {
      case "markdown-frontmatter":
        rendered = `---\ndescription: ${quoteYaml(description)}\n---\n\n${body}`;
        break;
      case "markdown-plain":
        rendered = `# ${inputs.commandName}\n\n${body}`;
        break;
      case "gemini-toml":
        rendered = `description = ${tomlString(description)}\nprompt = ${tomlMultiline(body)}\n`;
        break;
      case "continue-json-fragment":
        rendered =
          JSON.stringify(
            { name: inputs.commandName, description, prompt: body },
            null,
            2,
          ) + "\n";
        break;
    }
  }

  const layoutPaths = pathsForLayout(agent, resolvedLayout);
  const scopesAvail = scopesAvailableFor(agent, resolvedLayout);

  // Resolve the requested scope. Three cases:
  //  - explicit and supported  → use it
  //  - explicit and unsupported → null, scope_fallback=true
  //  - not provided             → null, scope_fallback=false (UI hasn't picked yet)
  const requested = inputs.scope ?? null;
  let resolvedScope: AgentScope | null = null;
  let scopeFallback = false;
  if (requested) {
    if (layoutPaths[requested]) {
      resolvedScope = requested;
    } else {
      scopeFallback = true;
    }
  }

  const installPaths: Partial<Record<AgentScope, string>> = {};
  for (const s of scopesAvail) {
    installPaths[s] = layoutPaths[s]!.replace(/\{name\}/g, inputs.commandName);
  }

  const installPath = resolvedScope
    ? layoutPaths[resolvedScope]!.replace(/\{name\}/g, inputs.commandName)
    : null;

  return {
    template: rendered,
    install_path: installPath,
    install_paths: installPaths,
    scopes_available: scopesAvail,
    scope: resolvedScope,
    scope_fallback: scopeFallback,
    layouts_available: layoutsAvail,
    layout: resolvedLayout,
    layout_fallback: layoutFallback,
    file_extension: useSkillsLayout ? "md" : agent.ext,
    format: useSkillsLayout ? "markdown-frontmatter" : agent.format,
    is_fragment: useSkillsLayout ? false : !!agent.isFragment,
    launch_guide: agent.launchGuide.replace(/\{name\}/g, inputs.commandName),
    docs_url: agent.docsUrl,
    label: agent.label,
  };
}

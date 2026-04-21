/**
 * Agent registry + per-agent rendering for the bootstrap skill.
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

export interface AgentSpec {
  /** Stable id used in URLs (e.g. ?agent=gemini). */
  id: string;
  /** Human-readable label for the UI dropdown. */
  label: string;
  /** File extension for the rendered artifact (no leading dot). */
  ext: string;
  /**
   * Install path with `{name}` placeholder. Tilde paths are expanded by the
   * shell; chart-relative paths stay as-is.
   */
  installPath: string;
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
    installPath: ".claude/commands/{name}.md",
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
      "Claude Code auto-discovers commands in `.claude/commands/` (per-repo) and `~/.claude/commands/` (user-global).",
    ].join("\n"),
  },

  cursor: {
    id: "cursor",
    label: "Cursor",
    ext: "md",
    installPath: ".cursor/commands/{name}.md",
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
      "Cursor reads slash commands from `.cursor/commands/` per repo. Reload the window if a new command does not appear in the picker.",
    ].join("\n"),
  },

  specify: {
    id: "specify",
    label: "Spec Kit",
    ext: "md",
    installPath: ".specify/templates/commands/{name}.md",
    format: "markdown-frontmatter",
    argRef: "$ARGUMENTS",
    docsUrl: "https://github.com/github/spec-kit",
    launchGuide: [
      "**Install Spec Kit** (uses `uv`):",
      "```bash",
      "uvx --from git+https://github.com/github/spec-kit.git specify init",
      "```",
      "",
      "Spec Kit re-syncs commands into the agent-specific directory (`.claude/commands/`, `.cursor/commands/`, etc.) the next time you run a Spec Kit command. Use `/specify`, `/plan`, `/tasks`, `/implement` as usual; the new `/{name}` command becomes available alongside them.",
    ].join("\n"),
  },

  codex: {
    id: "codex",
    label: "Codex CLI (OpenAI)",
    ext: "md",
    installPath: "~/.codex/prompts/{name}.md",
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
      "Prompts live in `~/.codex/prompts/` (user-global). Codex picks them up on next launch.",
    ].join("\n"),
  },

  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    ext: "toml",
    installPath: "~/.gemini/commands/{name}.toml",
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
      "Commands live in `~/.gemini/commands/` (user-global) or `.gemini/commands/` (per-repo). Gemini reloads commands on each invocation.",
    ].join("\n"),
  },

  continue: {
    id: "continue",
    label: "Continue (VS Code / JetBrains)",
    ext: "json",
    installPath: "~/.continue/config.json",
    format: "continue-json-fragment",
    isFragment: true,
    // Continue passes the full slash-command string after the name; we use a
    // sentinel that the prompt template references in plain prose.
    argRef: "{{input}}",
    docsUrl: "https://docs.continue.dev",
    launchGuide: [
      "**Install Continue**: from the VS Code or JetBrains marketplace.",
      "",
      "**Add the command**: open `~/.continue/config.json` and merge the rendered fragment into the top-level `slashCommands` array (create the array if it does not exist):",
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
 * recognized; multi-line/folded scalars are left in the body. The bootstrap
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
  /** Resolved install path with `{name}` substituted. */
  install_path: string;
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
}

export function renderForAgent(agent: AgentSpec, inputs: RenderInputs): RenderResult {
  const parsed = parseFrontmatter(inputs.canonicalTemplate);
  const description =
    inputs.description.trim() ||
    parsed.description.trim() ||
    "Browse and install skills from the CAIPE skill catalog";

  const body = substitutePlaceholders(parsed.body, {
    commandName: inputs.commandName,
    description,
    baseUrl: inputs.baseUrl,
    argRef: agent.argRef,
  }).replace(/^\n+/, ""); // strip leading blank lines from frontmatter strip

  let rendered: string;
  switch (agent.format) {
    case "markdown-frontmatter":
      rendered = `---\ndescription: ${quoteYaml(description)}\n---\n\n${body}`;
      break;
    case "markdown-plain":
      // Codex prompts: just the body, optionally prefixed with a heading.
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

  return {
    template: rendered,
    install_path: agent.installPath.replace(/\{name\}/g, inputs.commandName),
    file_extension: agent.ext,
    format: agent.format,
    is_fragment: !!agent.isFragment,
    launch_guide: agent.launchGuide.replace(/\{name\}/g, inputs.commandName),
    docs_url: agent.docsUrl,
    label: agent.label,
  };
}

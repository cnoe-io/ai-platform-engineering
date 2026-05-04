/**
 * GET /api/skills/install.sh
 *
 * Returns a portable bash installer that fetches and writes CAIPE skill
 * artifacts to a user's machine. The script is intended for `curl … | bash`
 * or "download & inspect first" workflows surfaced from the Skills API
 * Gateway UI.
 *
 * Three modes (mutually exclusive — picked by query params):
 *
 * 1. `bulk-with-helpers` (DEFAULT, when no `catalog_url` and no
 *    `mode=live-only`): the new "everything for native discovery" flow.
 *    Bulk-installs every skill from the catalog, drops the two helper
 *    skills (`/skills` live-fetch + `/update-skills` user-driven refresh),
 *    installs the Python catalog helper at ~/.config/caipe/caipe-skills.py,
 *    and (Claude Code only) registers a SessionStart hook that injects
 *    the live catalog index into Claude's `additionalContext`. Auto-seeds
 *    ~/.config/caipe/config.json with the gateway base_url (never the
 *    api_key — user supplies that). Cleans up legacy install artifacts
 *    when `--upgrade` is passed.
 *
 *    Flags exposed by the generated script: `--no-bulk` (skip catalog
 *    materialization), `--no-helpers` (skip the two helper skills),
 *    `--no-hook` (skip the SessionStart hook even on Claude).
 *
 *    Fragment-config agents (Continue today) can't bulk-install — they
 *    silently fall back to live-only so the UI doesn't have to special-
 *    case them.
 *
 * 2. `live-only` (`?mode=live-only`): the legacy default, demoted to an
 *    Advanced toggle in the UI. Installs ONLY the single `/skills`
 *    live-skills slash command. No helpers, no hook, no auto-config.
 *
 * 3. `catalog-query bulk` (`?catalog_url=…`): unchanged. Materializes
 *    one file per skill returned by the gateway query the user built in
 *    the "Pick your skills" panel. No helpers, no hook.
 *
 * Query params:
 *   - agent:        agent id (claude | cursor | specify | codex | gemini |
 *                   continue). Required (we don't pick a default for an
 *                   installer; ambiguity here would write to the wrong path).
 *   - scope:        install scope ("user" | "project"). Required and must be
 *                   one of the agent's `scopes_available` (Codex has no
 *                   project, Spec Kit has no user). Mismatch returns 400.
 *   - command_name: slash command name. Defaults to "skills" (sanitized).
 *   - description:  optional description; defaults to the canonical template's
 *                   frontmatter description.
 *   - base_url:     gateway base URL the script should call back into when
 *                   fetching the rendered template at install time. Defaults
 *                   to the request origin.
 *
 * Security notes:
 *   - The script NEVER prints or logs the API key. Resolution order:
 *       1. `--api-key=<value>` flag (warns: visible in `ps` to other users on
 *          the same host)
 *       2. `$CAIPE_CATALOG_KEY` env var
 *       3. `~/.config/caipe/config.json` { "api_key": "..." }
 *       4. `~/.config/grid/config.json`  { "api_key": "..." } (fallback for
 *          shared dotfiles between Grid and CAIPE)
 *     The Step-3 UI walks users through creating the config.json file, so the
 *     happy path is "set it once, never type the key again."
 *   - The rendered template body is NOT baked into the script. Instead the
 *     script does a fresh GET to /api/skills/live-skills?... at install time,
 *     so users always get the latest canonical template and the script stays
 *     small and easy to audit.
 *   - We refuse to overwrite an existing target file unless `--upgrade` (for
 *     a previously-installed CAIPE skill) or `--force` (escape hatch) is
 *     passed, so re-running the one-liner is safe.
 *   - Ownership of installed files is tracked in a sidecar manifest at
 *     `~/.config/caipe/installed.json`. `--upgrade` consults the manifest to
 *     decide whether it's safe to overwrite a file. The manifest is the only
 *     state we keep on disk besides the installed skills themselves.
 *
 * Response:
 *   - Content-Type: text/x-shellscript; charset=utf-8
 *   - Content-Disposition: attachment; filename=install-skills-<agent>-<scope>.sh
 *   - Cache-Control: no-store
 *
 * Errors are returned as plain text so `curl … | bash` shows a readable
 * message instead of a JSON blob the shell would try to execute.
 */

import { NextResponse } from "next/server";
import {
  AGENTS,
  layoutsAvailableFor,
  scopesAvailableFor,
  type AgentLayout,
  type AgentSpec,
} from "../live-skills/agents";
import { getRequestOrigin } from "../_lib/request-origin";

/* ---------- input sanitizers (mirror the live-skills route) ---------- */

function sanitizeCommandName(raw: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "skills";
  if (trimmed.length > 64) return "skills";
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return "skills";
  return trimmed;
}

function sanitizeDescription(raw: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 500);
}

function sanitizeBaseUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Sanitize an optional ?catalog_url=… coming from the Skills API Gateway UI
 * Query Builder. We only allow URLs that point back at our own gateway's
 * `/api/skills` listing endpoint — never an arbitrary host. Returning the
 * normalized URL means `install.sh` switches into "bulk install" mode and
 * iterates the catalog response instead of installing the live-skills skill.
 *
 * Constraints (enforced server-side, not by the bash script):
 *   - http:// or https:// only
 *   - no userinfo
 *   - same origin as `base_url` (or the request origin if base_url is unset)
 *   - path must be exactly `/api/skills` (no path traversal, no other endpoints)
 */
function sanitizeCatalogUrl(
  raw: string | null,
  baseOrigin: string,
): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.origin !== baseOrigin) return null;
  if (parsed.pathname.replace(/\/+$/, "") !== "/api/skills") return null;
  // Force include_content=true so the script always has bodies to write.
  parsed.searchParams.set("include_content", "true");
  return parsed.toString();
}

/**
 * Per-format file extension used when bulk-writing one file per catalog skill.
 * Must stay in sync with the marker comment syntax below.
 */
function extensionForFormat(format: AgentSpec["format"]): string {
  switch (format) {
    case "gemini-toml":
      return "toml";
    case "markdown-frontmatter":
    case "markdown-plain":
      return "md";
    default:
      return "md";
  }
}

/**
 * Compute the parent directory used for bulk installs.
 *
 * - `commands` layout: install path is `<dir>/{name}.<ext>`, so we strip
 *   the last segment.
 * - `skills` layout: install path is `<dir>/{name}/SKILL.md`, so we strip
 *   the last TWO segments to recover `<dir>` (the skills directory itself).
 */
function commandsDirFor(
  installPathTemplate: string,
  layout: AgentLayout,
): string {
  if (layout === "skills") {
    // Expect /{name}/SKILL.md tail. Strip both segments.
    const stripped = installPathTemplate.replace(/\/\{name\}\/[^/]+$/, "");
    if (stripped !== installPathTemplate) return stripped;
    // Fallback: drop the last segment if the template doesn't match.
    const idx = installPathTemplate.lastIndexOf("/");
    return idx < 0 ? "." : installPathTemplate.slice(0, idx);
  }
  const idx = installPathTemplate.lastIndexOf("/");
  if (idx < 0) return ".";
  return installPathTemplate.slice(0, idx);
}

/* ---------- shell quoting ---------- */

/**
 * Single-quote a value for safe inclusion in a bash script. Replaces any
 * `'` with `'\''` (close, escaped quote, reopen) which works inside any
 * `bash`-compatible shell. Used for every value we templated into the script.
 */
function shq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/* ---------- error responses (plain text) ---------- */

function plainTextError(message: string, status: number): NextResponse {
  return new NextResponse(`# install-skills error: ${message}\nexit 64\n`, {
    status,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/* ---------- script generator ---------- */

/**
 * Which install flow the generated script implements. See the route
 * docstring for the user-visible behavior of each.
 *
 * - "bulk-with-helpers" — new default; full bulk + helpers + hook.
 * - "live-only"         — single /skills command only (legacy default).
 * - "catalog-query"     — bulk install from a custom ?catalog_url=...
 *                         (unchanged from the original "bulk" flow).
 */
type InstallMode = "bulk-with-helpers" | "live-only" | "catalog-query";

interface ScriptInputs {
  agent: AgentSpec;
  scope: "user" | "project";
  layout: AgentLayout;
  commandName: string;
  description: string;
  baseUrl: string;
  mode: InstallMode;
  /**
   * Only set when `mode === "catalog-query"`. URL of a `<baseUrl>/api/skills?...`
   * gateway listing to iterate; the script writes one file per returned
   * skill into the agent's commands directory.
   */
  catalogUrl: string | null;
}

function buildScript(inputs: ScriptInputs): string {
  if (inputs.mode === "bulk-with-helpers") {
    return buildBulkWithHelpersScript(inputs);
  }
  return buildLegacyScript(inputs);
}

/**
 * Generates the bash for the new "everything for native discovery" flow.
 *
 * The generated script:
 *
 *  1. Resolves the catalog API key (--api-key > env > config file).
 *  2. Optionally fetches & writes every catalog skill to disk so the
 *     agent gets native autocomplete (suppressed by --no-bulk).
 *  3. Optionally fetches & writes the two helper skill commands
 *     (`/skills` live-fetch + `/update-skills` user-driven refresh).
 *     Suppressed by --no-helpers.
 *  4. Always installs the Python catalog helper at
 *     ~/.config/caipe/caipe-skills.py (the helper skills depend on it).
 *  5. (Claude Code only) Installs ~/.claude/hooks/caipe-catalog.sh and
 *     patches ~/.claude/settings.json to register a SessionStart hook
 *     that injects the live catalog index into Claude's
 *     `additionalContext`. Suppressed by --no-hook or non-Claude agent.
 *  6. Auto-seeds ~/.config/caipe/config.json with the gateway base_url
 *     (never the api_key). Skips if the file already exists.
 *  7. (--upgrade only) Removes legacy install artifacts so the new
 *     model doesn't double up with the old single-skill install.
 *  8. Prints a success card with next-step commands, the recommended
 *     allowlist snippet for Claude/Cursor settings, and gitignore
 *     guidance for project-scoped installs.
 *
 * The generated script is ~400 lines of bash. Most of the bulk and
 * single-skill logic is shared with `buildLegacyScript` only by
 * convention (same shell quoting, same manifest schema), not by
 * code reuse — the two flows are different enough that duplicating
 * the bash is clearer than parameterizing one giant generator.
 */
function buildBulkWithHelpersScript({
  agent,
  scope,
  layout,
  commandName,
  description,
  baseUrl,
}: ScriptInputs): string {
  // Path resolution mirrors the legacy script: which `installPaths` table
  // we use depends on the requested layout. For bulk-with-helpers we
  // ALWAYS install the helper skills into the agent's commands dir
  // (so /skills and /update-skills are slash commands, not skill folders),
  // and we install the catalog skills into the requested layout's dir.
  //
  // For the helper SLASH COMMANDS we want the legacy commands layout
  // even when the user picked layout=skills for the bulk install — the
  // agent should be able to run `/skills` and `/update-skills` as
  // normal slash commands, not invoke them via skill-folder discovery.
  // (This matches how the live-skills route advertises them today.)
  const commandsLayoutPaths = agent.installPaths;
  const commandsDirTemplate = commandsDirFor(
    commandsLayoutPaths[scope] ??
      // Fragment-config agents won't reach here (handler routes them to
      // live-only first), but keep a safe fallback so a stray request
      // doesn't crash the route handler.
      "~/.caipe-helpers/{name}.md",
    "commands",
  );

  // Where catalog skills land (one per skill, either as <name>/SKILL.md
  // or <name>.<ext> depending on layout). We use the requested layout
  // table here so the user's "Skills layout" toggle is respected.
  const skillsLayoutPaths =
    layout === "skills" && agent.skillsPaths
      ? agent.skillsPaths
      : agent.installPaths;
  const skillsInstallTemplate =
    skillsLayoutPaths[scope] ?? commandsLayoutPaths[scope]!;
  const catalogTargetDir = commandsDirFor(skillsInstallTemplate, layout);
  const catalogFileExt =
    layout === "skills" ? "md" : extensionForFormat(agent.format);

  // The two helper commands are always rendered for THIS agent, so
  // their per-agent template URLs are computed up-front and baked in.
  // We pass `command_name` and `base_url` so the rendered output is
  // identical to what a fresh GET /api/skills/{live,update}-skills
  // would produce in the UI.
  const liveSkillsParams = new URLSearchParams({
    agent: agent.id,
    scope,
    layout: "commands",
    command_name: "skills",
    base_url: baseUrl,
  }).toString();
  const updateSkillsParams = new URLSearchParams({
    agent: agent.id,
    scope,
    layout: "commands",
    command_name: "update-skills",
    base_url: baseUrl,
  }).toString();
  const liveSkillsUrl = `${baseUrl}/api/skills/live-skills?${liveSkillsParams}`;
  const updateSkillsUrl = `${baseUrl}/api/skills/update-skills?${updateSkillsParams}`;
  const helperPyUrl = `${baseUrl}/api/skills/helpers/caipe-skills.py?base_url=${encodeURIComponent(baseUrl)}`;
  const hookShUrl = `${baseUrl}/api/skills/hooks/caipe-catalog.sh?base_url=${encodeURIComponent(baseUrl)}`;
  // Bulk catalog query: include_content=true so we have bodies to write.
  // page_size=200 covers any realistic single-organization catalog;
  // operators with larger catalogs can re-run with --no-bulk and use
  // /update-skills selectively from inside their agent.
  const bulkCatalogUrl = `${baseUrl}/api/skills?page=1&page_size=200&include_content=true`;

  // Whether THIS agent is Claude Code — only Claude has documented
  // SessionStart hook support today. Other agents skip the hook step
  // even if they support skills layouts.
  const isClaude = agent.id === "claude";

  // Pre-quote everything we templated in.
  const Q_AGENT_ID = shq(agent.id);
  const Q_AGENT_LABEL = shq(agent.label);
  const Q_SCOPE = shq(scope);
  const Q_LAYOUT = shq(layout);
  const Q_COMMAND = shq(commandName);
  const Q_BASE_URL = shq(baseUrl);
  const Q_COMMANDS_DIR = shq(commandsDirTemplate);
  const Q_CATALOG_DIR = shq(catalogTargetDir);
  const Q_CATALOG_EXT = shq(catalogFileExt);
  const Q_LIVE_URL = shq(liveSkillsUrl);
  const Q_UPDATE_URL = shq(updateSkillsUrl);
  const Q_HELPER_PY_URL = shq(helperPyUrl);
  const Q_HOOK_SH_URL = shq(hookShUrl);
  const Q_BULK_URL = shq(bulkCatalogUrl);
  const _description = description; // currently unused in this flow but kept for symmetry / future use
  void _description;

  return `#!/usr/bin/env bash
# install-skills.sh — CAIPE bulk-with-helpers installer
#
# Generated by ${baseUrl}/api/skills/install.sh
# Agent  : ${agent.label} (${agent.id})
# Scope  : ${scope} (${scope === "user" ? "user-global" : "project-local"})
# Layout : ${layout}
# Mode   : bulk-with-helpers (everything for native discovery)
#
# This installer writes:
#   - one file per skill from the live catalog (suppress with --no-bulk)
#   - the /skills helper command          (suppress with --no-helpers)
#   - the /update-skills helper command   (suppress with --no-helpers)
#   - the Python catalog helper at ~/.config/caipe/caipe-skills.py
${isClaude ? `#   - a SessionStart hook for Claude Code (suppress with --no-hook)\n` : `#   (no SessionStart hook — only Claude Code supports them today)\n`}#   - ~/.config/caipe/config.json (base_url only, never api_key)
#
# Usage:
#   CAIPE_CATALOG_KEY=<your-key> bash <(curl -fsSL <this-url>)
#   ./install-skills.sh --upgrade   # refresh existing CAIPE-owned files + clean legacy artifacts
#   ./install-skills.sh --no-bulk   # just helpers + hook + helper.py
#   ./install-skills.sh --no-helpers --no-hook --no-bulk   # only the python helper + config seed
#
# Security: this script NEVER prints, logs, or echoes the API key.

set -euo pipefail

AGENT_ID=${Q_AGENT_ID}
AGENT_LABEL=${Q_AGENT_LABEL}
SCOPE=${Q_SCOPE}
LAYOUT=${Q_LAYOUT}
COMMAND_NAME=${Q_COMMAND}
BASE_URL=${Q_BASE_URL}
COMMANDS_DIR_RAW=${Q_COMMANDS_DIR}
CATALOG_DIR_RAW=${Q_CATALOG_DIR}
CATALOG_EXT=${Q_CATALOG_EXT}
LIVE_SKILLS_URL=${Q_LIVE_URL}
UPDATE_SKILLS_URL=${Q_UPDATE_URL}
HELPER_PY_URL=${Q_HELPER_PY_URL}
HOOK_SH_URL=${Q_HOOK_SH_URL}
BULK_CATALOG_URL=${Q_BULK_URL}
IS_CLAUDE=${isClaude ? "1" : "0"}

API_KEY="\${CAIPE_CATALOG_KEY:-}"
FORCE=0
UPGRADE=0
NO_BULK=0
NO_HELPERS=0
NO_HOOK=0

# Sidecar manifest of files we wrote. Lives next to config.json; one file
# per workstation in user scope, per project in project scope so worktrees
# don't bleed into each other.
case "\$SCOPE" in
  user)    MANIFEST_PATH="\${HOME:-.}/.config/caipe/installed.json" ;;
  project) MANIFEST_PATH="./.caipe/installed.json" ;;
esac
MANIFEST_PATH="\${CAIPE_INSTALL_MANIFEST:-\$MANIFEST_PATH}"

# Dotfiles for auto-seeding the user-side config.
CAIPE_CONFIG_DIR="\${HOME:-.}/.config/caipe"
CAIPE_CONFIG_FILE="\$CAIPE_CONFIG_DIR/config.json"
CAIPE_HELPER_PY="\$CAIPE_CONFIG_DIR/caipe-skills.py"

# Claude-specific paths for the SessionStart hook. Only used when
# IS_CLAUDE=1. Project-scope: write the hook into ./.claude/, mirroring
# how Claude Code resolves project-local hooks.
case "\$SCOPE" in
  user)    CLAUDE_DIR="\${HOME:-.}/.claude" ;;
  project) CLAUDE_DIR="./.claude" ;;
esac
CLAUDE_HOOK_DIR="\$CLAUDE_DIR/hooks"
CLAUDE_HOOK_FILE="\$CLAUDE_HOOK_DIR/caipe-catalog.sh"
CLAUDE_SETTINGS_FILE="\$CLAUDE_DIR/settings.json"

usage() {
  cat <<USAGE
install-skills.sh — bulk-with-helpers installer for \$AGENT_LABEL.

Usage:
  $0 [flags]

Flags:
  --upgrade        Refresh existing CAIPE-owned files and clean up
                   legacy install artifacts from previous versions.
  --force          Overwrite ANY existing target file (escape hatch).
  --no-bulk        Skip the bulk catalog install. Only the helpers,
                   the python helper, and (Claude) the hook are written.
  --no-helpers     Skip writing the /skills and /update-skills helper
                   slash commands.
  --no-hook        Skip the Claude SessionStart hook + settings patch.
                   No-op when AGENT is not "claude".
  --api-key=<key>  Pass the catalog key on the command line.
                   WARNING: visible in 'ps' AND shell history. Prefer
                   storing the key in ~/.config/caipe/config.json once.
  --help           Show this message.

Environment:
  CAIPE_CATALOG_KEY        Catalog API key. Never echoed by this script.
  CAIPE_INSTALL_MANIFEST   Override path of the install manifest
                           (default: \$MANIFEST_PATH).
USAGE
}

while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --api-key=*)
      API_KEY="\${1#--api-key=}"
      echo "warning: --api-key passes the secret on the process command line." >&2
      echo "         It will appear in 'ps' output AND shell history." >&2
      ;;
    --api-key)
      shift
      API_KEY="\${1:-}"
      echo "warning: --api-key passes the secret on the process command line." >&2
      ;;
    --force) FORCE=1 ;;
    --upgrade) UPGRADE=1 ;;
    --no-bulk) NO_BULK=1 ;;
    --no-helpers) NO_HELPERS=1 ;;
    --no-hook) NO_HOOK=1 ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "error: unknown argument: \$1" >&2
      usage >&2
      exit 64
      ;;
  esac
  shift || true
done

# ---------- API key resolution (config > env > flag, same as legacy) ----------
read_api_key_from_config() {
  local cfg_path="\$1"
  [ -r "\$cfg_path" ] || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  python3 -c '
import json, sys
try:
  data = json.load(open(sys.argv[1]))
except Exception:
  sys.exit(1)
key = (data.get("api_key") or "").strip()
if not key:
  sys.exit(1)
sys.stdout.write(key)
' "\$cfg_path" 2>/dev/null && return 0
  return 1
}

if [ -z "\$API_KEY" ]; then
  for cfg in "\$CAIPE_CONFIG_FILE" "\${HOME:-.}/.config/grid/config.json"; do
    if k="\$(read_api_key_from_config "\$cfg")" && [ -n "\$k" ]; then
      API_KEY="\$k"
      echo "==> using API key from \$cfg" >&2
      break
    fi
  done
fi

if [ -z "\$API_KEY" ]; then
  echo "error: catalog API key is required." >&2
  echo "       Easiest fix: create \$CAIPE_CONFIG_FILE with:" >&2
  echo "           { \\"api_key\\": \\"<your-key>\\" }" >&2
  echo "       Or pass --api-key=<key> / set CAIPE_CATALOG_KEY=<key>." >&2
  exit 64
fi

# Required tooling.
if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required but was not found in PATH." >&2
  exit 69
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required (the helper scripts and manifest" >&2
  echo "       writer both use it). Install python3 and re-run." >&2
  exit 69
fi

# ---------- Resolve install paths for this scope ----------
case "\$SCOPE" in
  user)
    if [ -z "\${HOME:-}" ]; then
      echo "error: \\$HOME is not set; cannot resolve user-global install path." >&2
      exit 78
    fi
    COMMANDS_DIR="\${COMMANDS_DIR_RAW/#~\\//\$HOME/}"
    CATALOG_DIR="\${CATALOG_DIR_RAW/#~\\//\$HOME/}"
    ;;
  project)
    COMMANDS_DIR="\$COMMANDS_DIR_RAW"
    CATALOG_DIR="\$CATALOG_DIR_RAW"
    ;;
esac

mkdir -p "\$COMMANDS_DIR" "\$CATALOG_DIR" "\$CAIPE_CONFIG_DIR"

# ---------- Install manifest helpers (shared with the legacy flow) ----------
manifest_register() {
  # manifest_register <abs-path> <kind>  (kind: skill|helper|catalog|hook|config)
  local target="\$1" kind="\${2:-catalog}"
  local cfg_dir; cfg_dir="\$(dirname "\$MANIFEST_PATH")"
  mkdir -p "\$cfg_dir" 2>/dev/null || return 0
  python3 - "\$MANIFEST_PATH" "\$AGENT_ID" "\$SCOPE" "\$target" "\$kind" <<'PY' 2>/dev/null || true
import datetime, json, os, sys, tempfile
manifest_path, agent, scope, target, kind = sys.argv[1:]
data = {"version": 1, "installed": []}
if os.path.isfile(manifest_path):
    try:
        data = json.load(open(manifest_path))
        if not isinstance(data, dict):
            data = {"version": 1, "installed": []}
        data.setdefault("version", 1)
        data.setdefault("installed", [])
    except Exception:
        data = {"version": 1, "installed": []}
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
entry = {"agent": agent, "scope": scope, "path": target, "kind": kind, "installed_at": now}
data["installed"] = [
    e for e in data["installed"]
    if not (e.get("agent") == agent and e.get("scope") == scope and e.get("path") == target)
] + [entry]
fd, tmp = tempfile.mkstemp(prefix=".caipe-manifest-", dir=os.path.dirname(manifest_path) or ".")
try:
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\\n")
    os.replace(tmp, manifest_path)
    os.chmod(manifest_path, 0o600)
except Exception:
    try: os.unlink(tmp)
    except OSError: pass
PY
}

manifest_owns() {
  local target="\$1"
  [ -r "\$MANIFEST_PATH" ] || return 1
  python3 -c '
import json, sys
try: data = json.load(open(sys.argv[1]))
except Exception: sys.exit(1)
target = sys.argv[2]
for e in (data or {}).get("installed", []) or []:
  if e.get("path") == target: sys.exit(0)
sys.exit(1)
' "\$MANIFEST_PATH" "\$target" 2>/dev/null
}

# Centralized "may we write to this path?" gate. Honors --force (always),
# --upgrade (only if manifest claims ownership), and refuses otherwise.
# Returns 0 = write OK, 1 = skip.
may_write() {
  local target="\$1"
  if [ ! -e "\$target" ]; then
    return 0
  fi
  if [ "\$FORCE" -eq 1 ]; then
    return 0
  fi
  if [ "\$UPGRADE" -eq 1 ] && manifest_owns "\$target"; then
    return 0
  fi
  return 1
}

# ---------- Atomic curl-to-file ----------
# Fetches \$1 with the catalog key into \$2 atomically (tempfile + rename).
# Returns the curl exit status. Caller is responsible for permissions.
fetch_to() {
  local url="\$1" target="\$2"
  local parent; parent="\$(dirname "\$target")"
  mkdir -p "\$parent"
  local tmp; tmp="\$(mktemp "\$parent/.caipe-fetch-XXXXXX")"
  local status
  status="\$(curl -sS -o "\$tmp" -w '%{http_code}' \\
    -H "X-Caipe-Catalog-Key: \$API_KEY" \\
    -H 'Accept: */*' \\
    "\$url")" || { rm -f "\$tmp"; echo "error: curl failed for \$url" >&2; return 69; }
  if [ "\$status" != "200" ]; then
    echo "error: HTTP \$status for \$url" >&2
    if [ -s "\$tmp" ]; then echo "       body: \$(head -c 500 "\$tmp")" >&2; fi
    rm -f "\$tmp"
    return 76
  fi
  mv -f "\$tmp" "\$target"
  return 0
}

# Pull the rendered "template" field out of a /api/skills/{live,update}-skills
# response and write the unwrapped markdown to \$target.
fetch_template_to() {
  local url="\$1" target="\$2"
  local parent; parent="\$(dirname "\$target")"
  mkdir -p "\$parent"
  local tmp_json; tmp_json="\$(mktemp "\$parent/.caipe-tpl-XXXXXX")"
  local status
  status="\$(curl -sS -o "\$tmp_json" -w '%{http_code}' \\
    -H "X-Caipe-Catalog-Key: \$API_KEY" \\
    -H 'Accept: application/json' \\
    "\$url")" || { rm -f "\$tmp_json"; return 69; }
  if [ "\$status" != "200" ]; then
    echo "error: HTTP \$status for \$url" >&2
    rm -f "\$tmp_json"
    return 76
  fi
  python3 - "\$tmp_json" "\$target" <<'PY' || { rm -f "\$tmp_json"; return 76; }
import json, os, sys
src, dst = sys.argv[1:]
data = json.load(open(src))
body = data.get("template") or ""
if not body:
    sys.stderr.write("template field missing or empty in response\\n")
    sys.exit(1)
parent = os.path.dirname(dst) or "."
import tempfile
fd, tmp = tempfile.mkstemp(prefix=".caipe-tpl-", dir=parent)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write(body)
os.replace(tmp, dst)
os.chmod(dst, 0o644)
PY
  rm -f "\$tmp_json"
  return 0
}

# ---------- Step: legacy cleanup (--upgrade only) ----------
# Removes leftovers from earlier install models that would now conflict
# with bulk-with-helpers. We only delete files we KNOW were CAIPE-owned
# (either via the manifest or by canonical path/name heuristics for the
# pre-manifest era).
do_legacy_cleanup() {
  [ "\$UPGRADE" -eq 1 ] || return 0
  local removed=0

  # 1. Old single-skill install at ~/.claude/commands/skills.md (or
  #    ./.claude/commands/skills.md). Always replaced by the new
  #    /skills helper, so safe to remove unconditionally when --upgrade.
  for legacy in "\$COMMANDS_DIR/skills.md" "\$COMMANDS_DIR/skills.toml"; do
    if [ -f "\$legacy" ]; then
      rm -f "\$legacy" && echo "==> removed legacy \$legacy" && removed=\$((removed+1))
    fi
  done

  # 2. The pre-bug-fix dual-install path ~/.claude/skills/skills/SKILL.md
  #    (a "skills" folder named "skills" inside the skills directory),
  #    which only ever existed because the old code wrote BOTH the
  #    commands AND skills layout. Remove only if the directory exists
  #    and contains just SKILL.md (defensive — we don't want to nuke a
  #    user's hand-authored skill that happens to be named "skills").
  if [ "\$IS_CLAUDE" = "1" ]; then
    local dual="\$CLAUDE_DIR/skills/skills"
    if [ -d "\$dual" ]; then
      local count
      count="\$(find "\$dual" -mindepth 1 -maxdepth 1 \\( -name SKILL.md -o -name 'metadata.json' \\) 2>/dev/null | wc -l | tr -d ' ')"
      local total
      total="\$(find "\$dual" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
      if [ "\$count" -gt 0 ] && [ "\$total" -le 2 ]; then
        rm -rf "\$dual" && echo "==> removed legacy \$dual" && removed=\$((removed+1))
      fi
    fi
  fi

  if [ "\$removed" -gt 0 ]; then
    echo "==> legacy cleanup: removed \$removed item(s)"
  fi
}

# ---------- Step: install python helper at ~/.config/caipe/caipe-skills.py ----------
do_install_helper_py() {
  if may_write "\$CAIPE_HELPER_PY"; then
    if fetch_to "\$HELPER_PY_URL" "\$CAIPE_HELPER_PY"; then
      chmod 0755 "\$CAIPE_HELPER_PY"
      manifest_register "\$CAIPE_HELPER_PY" helper
      echo "==> installed \$CAIPE_HELPER_PY"
    else
      echo "warn: failed to install \$CAIPE_HELPER_PY (helper skills will not work without it)" >&2
      return 1
    fi
  else
    echo "skip: \$CAIPE_HELPER_PY exists (re-run with --upgrade or --force to replace)" >&2
  fi
}

# ---------- Step: auto-seed ~/.config/caipe/config.json ----------
# Writes only if the file is missing. Never overwrites — the api_key
# field belongs to the user. We only seed base_url so a fresh checkout
# can immediately run the helper without manual config.
do_seed_config() {
  if [ -f "\$CAIPE_CONFIG_FILE" ]; then
    return 0
  fi
  python3 - "\$CAIPE_CONFIG_FILE" "\$BASE_URL" <<'PY'
import json, os, sys
path, base_url = sys.argv[1:]
parent = os.path.dirname(path) or "."
os.makedirs(parent, exist_ok=True)
data = {"base_url": base_url, "_comment": "Set api_key here to avoid passing --api-key on the command line."}
import tempfile
fd, tmp = tempfile.mkstemp(prefix=".caipe-config-", dir=parent)
with os.fdopen(fd, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\\n")
os.replace(tmp, path)
os.chmod(path, 0o600)
PY
  echo "==> seeded \$CAIPE_CONFIG_FILE (base_url only — add api_key yourself)"
  manifest_register "\$CAIPE_CONFIG_FILE" config
}

# ---------- Step: install /skills + /update-skills helper commands ----------
do_install_helpers() {
  [ "\$NO_HELPERS" -eq 1 ] && return 0

  local live="\$COMMANDS_DIR/skills.md"
  local upd="\$COMMANDS_DIR/update-skills.md"

  if may_write "\$live"; then
    if fetch_template_to "\$LIVE_SKILLS_URL" "\$live"; then
      manifest_register "\$live" helper
      echo "==> installed \$live (slash command: /skills)"
    fi
  else
    echo "skip: \$live exists (re-run with --upgrade or --force to replace)" >&2
  fi

  if may_write "\$upd"; then
    if fetch_template_to "\$UPDATE_SKILLS_URL" "\$upd"; then
      manifest_register "\$upd" helper
      echo "==> installed \$upd (slash command: /update-skills)"
    fi
  else
    echo "skip: \$upd exists (re-run with --upgrade or --force to replace)" >&2
  fi
}

# ---------- Step: bulk catalog materialization ----------
# Same algorithm as the legacy catalog-query bulk flow, but driven by
# the canonical /api/skills query (page=1, page_size=200, content=true)
# rather than a user-built query. We DO NOT touch the helper command
# names ("skills", "update-skills") — if the catalog happens to contain
# a skill with one of those names, we skip it with a warning so the
# helper command isn't clobbered.
do_install_bulk() {
  [ "\$NO_BULK" -eq 1 ] && return 0

  local catalog_tmp; catalog_tmp="\$(mktemp -t caipe-catalog-XXXXXX)"
  trap 'rm -f "\$catalog_tmp"' RETURN
  local status
  status="\$(curl -sS -o "\$catalog_tmp" -w '%{http_code}' \\
    -H "X-Caipe-Catalog-Key: \$API_KEY" \\
    -H 'Accept: application/json' \\
    "\$BULK_CATALOG_URL")" || {
      echo "warn: failed to reach catalog at \$BASE_URL — skipping bulk install" >&2
      return 0
    }
  if [ "\$status" != "200" ]; then
    echo "warn: catalog returned HTTP \$status — skipping bulk install" >&2
    return 0
  fi

  python3 - "\$catalog_tmp" "\$CATALOG_DIR" "\$LAYOUT" "\$CATALOG_EXT" "\$MANIFEST_PATH" "\$AGENT_ID" "\$SCOPE" "\$FORCE" "\$UPGRADE" <<'PY'
import base64, datetime, json, os, re, sys, tempfile

src, target_dir, layout, ext, manifest_path, agent, scope, force_s, upgrade_s = sys.argv[1:]
force = force_s == "1"; upgrade = upgrade_s == "1"
NAME_RE = re.compile(r"[^A-Za-z0-9._-]")
PART_RE = re.compile(r"[^A-Za-z0-9._-]")
RESERVED = {"skills", "update-skills"}  # never clobber the helper commands

# Load existing manifest for ownership checks.
owned = set()
if os.path.isfile(manifest_path):
    try:
        m = json.load(open(manifest_path))
        for e in (m or {}).get("installed", []) or []:
            owned.add(e.get("path"))
    except Exception:
        pass

def safe_path(rel):
    rel = rel.replace("\\\\", "/").lstrip("/")
    parts = []
    for p in rel.split("/"):
        if not p or p == "." or p == "..":
            return None
        parts.append(PART_RE.sub("_", p))
    return "/".join(parts) if parts else None

def may_write(path):
    if not os.path.exists(path):
        return True
    if force:
        return True
    if upgrade and path in owned:
        return True
    return False

data = json.load(open(src))
skills = data.get("skills", []) or []
wrote = 0; skipped = 0; reserved = 0; total = 0
new_entries = []
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

for s in skills:
    name = (s.get("name") or "").strip()
    if not name:
        continue
    total += 1
    if name in RESERVED:
        reserved += 1
        continue
    safe_name = NAME_RE.sub("_", name)
    body = s.get("content") or ""

    if layout == "skills":
        targets = {os.path.join(target_dir, safe_name, "SKILL.md"): body}
        anc = s.get("ancillary_files") or {}
        if isinstance(anc, dict):
            for rel, content in anc.items():
                if not isinstance(rel, str) or not isinstance(content, str):
                    continue
                sp = safe_path(rel)
                if not sp or sp == "SKILL.md":
                    continue
                targets[os.path.join(target_dir, safe_name, sp)] = content
    else:
        targets = {os.path.join(target_dir, f"{safe_name}.{ext}"): body}

    for path, content in targets.items():
        if not may_write(path):
            skipped += 1
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".caipe-install-", dir=os.path.dirname(path))
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, path)
        os.chmod(path, 0o644)
        new_entries.append({
            "agent": agent, "scope": scope, "path": path,
            "kind": "skill", "installed_at": now,
        })
        wrote += 1

# Atomic manifest update with the new entries appended (replacing any
# entry for the same path).
if new_entries:
    cfg_dir = os.path.dirname(manifest_path) or "."
    os.makedirs(cfg_dir, exist_ok=True)
    existing = {"version": 1, "installed": []}
    if os.path.isfile(manifest_path):
        try:
            existing = json.load(open(manifest_path))
            if not isinstance(existing, dict):
                existing = {"version": 1, "installed": []}
            existing.setdefault("version", 1)
            existing.setdefault("installed", [])
        except Exception:
            existing = {"version": 1, "installed": []}
    new_paths = {e["path"] for e in new_entries}
    existing["installed"] = [
        e for e in existing["installed"] if e.get("path") not in new_paths
    ] + new_entries
    fd, tmp = tempfile.mkstemp(prefix=".caipe-manifest-", dir=cfg_dir)
    with os.fdopen(fd, "w") as f:
        json.dump(existing, f, indent=2)
        f.write("\\n")
    os.replace(tmp, manifest_path)
    os.chmod(manifest_path, 0o600)

print(f"==> bulk: wrote {wrote} files for {total - reserved}/{total} skills (skipped {skipped}, reserved {reserved})")
PY
}

# ---------- Step: install Claude SessionStart hook ----------
do_install_hook() {
  [ "\$IS_CLAUDE" = "1" ] || return 0
  [ "\$NO_HOOK" -eq 1 ] && return 0

  if may_write "\$CLAUDE_HOOK_FILE"; then
    if fetch_to "\$HOOK_SH_URL" "\$CLAUDE_HOOK_FILE"; then
      chmod 0755 "\$CLAUDE_HOOK_FILE"
      manifest_register "\$CLAUDE_HOOK_FILE" hook
      echo "==> installed \$CLAUDE_HOOK_FILE"
    else
      echo "warn: failed to install \$CLAUDE_HOOK_FILE — skipping settings.json patch" >&2
      return 0
    fi
  else
    echo "skip: \$CLAUDE_HOOK_FILE exists (re-run with --upgrade or --force to replace)" >&2
  fi

  # Patch settings.json to register the SessionStart hook + allowlist
  # the helper invocations. This is a deep merge: we never wipe other
  # hooks or other allowlist entries.
  python3 - "\$CLAUDE_SETTINGS_FILE" "\$CLAUDE_HOOK_FILE" <<'PY'
import json, os, sys, tempfile

settings_path, hook_path = sys.argv[1:]
parent = os.path.dirname(settings_path) or "."
os.makedirs(parent, exist_ok=True)

data = {}
if os.path.isfile(settings_path):
    try:
        data = json.load(open(settings_path))
        if not isinstance(data, dict):
            data = {}
    except Exception:
        # Corrupt or non-JSON settings file — refuse to clobber it.
        sys.stderr.write(f"warn: {settings_path} is not valid JSON; skipping hook registration\\n")
        sys.stderr.write("      (your existing settings file is untouched)\\n")
        sys.exit(0)

# --- Register SessionStart hook (idempotent) ---
hooks = data.setdefault("hooks", {})
if not isinstance(hooks, dict):
    hooks = {}
    data["hooks"] = hooks

session_start = hooks.setdefault("SessionStart", [])
if not isinstance(session_start, list):
    session_start = []
    hooks["SessionStart"] = session_start

# Each entry can be either {"hooks": [{type, command, ...}, ...]}
# (Claude's documented schema) or a bare hook object. We use the
# documented schema so we play nicely with future hook tooling.
already_registered = False
for entry in session_start:
    if not isinstance(entry, dict):
        continue
    inner = entry.get("hooks") or []
    if not isinstance(inner, list):
        continue
    for h in inner:
        if isinstance(h, dict) and h.get("command") == hook_path:
            already_registered = True
            break
    if already_registered:
        break

if not already_registered:
    session_start.append({
        "hooks": [
            {
                "type": "command",
                "command": hook_path,
                "timeout": 5,
            }
        ]
    })
    print(f"==> registered SessionStart hook in {settings_path}")
else:
    print(f"==> SessionStart hook already registered in {settings_path}")

# --- Allowlist the python helper invocations (idempotent) ---
permissions = data.setdefault("permissions", {})
if not isinstance(permissions, dict):
    permissions = {}
    data["permissions"] = permissions
allow = permissions.setdefault("allow", [])
if not isinstance(allow, list):
    allow = []
    permissions["allow"] = allow
WANTED = [
    "Bash(uv run ~/.config/caipe/caipe-skills.py*)",
    "Bash(python3 ~/.config/caipe/caipe-skills.py*)",
]
for rule in WANTED:
    if rule not in allow:
        allow.append(rule)
        print(f"==> added allowlist rule: {rule}")

# --- Atomic write ---
fd, tmp = tempfile.mkstemp(prefix=".caipe-settings-", dir=parent, suffix=".json")
with os.fdopen(fd, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\\n")
os.replace(tmp, settings_path)
os.chmod(settings_path, 0o600)
PY
  manifest_register "\$CLAUDE_SETTINGS_FILE" config
}

# ---------- Run the steps in order ----------
do_legacy_cleanup
do_seed_config
do_install_helper_py
do_install_helpers
do_install_bulk
do_install_hook

# ---------- Success card ----------
echo
echo "================================================================"
echo "  CAIPE skills installed for \$AGENT_LABEL (\$SCOPE scope)"
echo "================================================================"
echo
echo "  next steps:"
if [ "\$NO_HELPERS" -eq 0 ]; then
  echo "    1. launch \$AGENT_LABEL"
  echo "    2. type /skills <query>          live-fetch a skill from the catalog"
  echo "    3. type /update-skills           refresh local copies from the catalog"
else
  echo "    /skills and /update-skills helper commands were skipped (--no-helpers)."
fi
echo
echo "  recommended (one-time): add the helper to your agent's allowlist"
echo "  to avoid approval prompts on every catalog lookup. Example for"
echo "  ~/.claude/settings.json or ~/.cursor/settings.json:"
echo
echo "    {"
echo "      \\"permissions\\": {"
echo "        \\"allow\\": ["
echo "          \\"Bash(uv run ~/.config/caipe/caipe-skills.py*)\\","
echo "          \\"Bash(python3 ~/.config/caipe/caipe-skills.py*)\\""
echo "        ]"
echo "      }"
echo "    }"
echo
if [ "\$IS_CLAUDE" = "1" ] && [ "\$NO_HOOK" -eq 0 ]; then
  echo "  Claude SessionStart hook installed — your next Claude Code session"
  echo "  will see the live catalog index in additionalContext."
elif [ "\$IS_CLAUDE" = "0" ]; then
  echo "  (SessionStart hook skipped — only Claude Code supports them today.)"
fi
echo
if [ "\$SCOPE" = "project" ]; then
  echo "  project scope: add this to your .gitignore so manifests and config"
  echo "  don't end up in version control:"
  echo
  echo "    .caipe/"
  echo
fi
echo "  manifest: \$MANIFEST_PATH"
echo "  config  : \$CAIPE_CONFIG_FILE"
echo "================================================================"
`;
}

/**
 * Legacy script generator for the live-only and catalog-query modes.
 * Behavior is byte-identical to the pre-refactor flow; only the entry
 * point name changed. The new bulk-with-helpers mode delegates to its
 * own generator above so this 500-line function stays untouched.
 */
function buildLegacyScript({
  agent,
  scope,
  layout,
  commandName,
  description,
  baseUrl,
  catalogUrl,
}: ScriptInputs): string {
  // Pick the right install path table for the requested layout.
  const layoutPaths =
    layout === "skills" && agent.skillsPaths
      ? agent.skillsPaths
      : agent.installPaths;
  const installPathTemplate = layoutPaths[scope]!;
  const resolvedPath = installPathTemplate.replace(/\{name\}/g, commandName);
  const commandsDirTemplate = commandsDirFor(installPathTemplate, layout);
  // In skills layout the per-agent format is irrelevant — every artifact is
  // a Markdown SKILL.md file with `name:` + `description:` frontmatter.
  const isFragment = layout === "skills" ? false : !!agent.isFragment;
  const queryString = new URLSearchParams({
    agent: agent.id,
    scope,
    layout,
    command_name: commandName,
    base_url: baseUrl,
    ...(description ? { description } : {}),
  }).toString();
  const liveSkillsUrl = `${baseUrl}/api/skills/live-skills?${queryString}`;
  const fileExt = layout === "skills" ? "md" : extensionForFormat(agent.format);
  const bulkMode = !!catalogUrl;

  // Pre-quote everything we templated in.
  const Q_AGENT_ID = shq(agent.id);
  const Q_AGENT_LABEL = shq(agent.label);
  const Q_SCOPE = shq(scope);
  const Q_LAYOUT = shq(layout);
  const Q_COMMAND = shq(commandName);
  const Q_FORMAT = shq(agent.format);
  const Q_INSTALL_PATH = shq(resolvedPath);
  const Q_LIVE_SKILLS_URL = shq(liveSkillsUrl);
  const Q_BASE_URL = shq(baseUrl);
  const Q_COMMANDS_DIR = shq(commandsDirTemplate);
  const Q_FILE_EXT = shq(fileExt);
  const Q_CATALOG_URL = shq(catalogUrl ?? "");

  return `#!/usr/bin/env bash
# install-skills.sh — fetch and install CAIPE skills as slash commands
#
# Generated by ${baseUrl}/api/skills/install.sh
# Agent : ${agent.label} (${agent.id})
# Scope : ${scope} (${scope === "user" ? "user-global" : "project-local"})
# Format: ${agent.format}
# Mode  : ${bulkMode ? "BULK (one file per skill from catalog query)" : "single live-skills skill"}
# Target: ${bulkMode ? commandsDirTemplate + "/<skill>." + fileExt : resolvedPath}
#
# Usage:
#   CAIPE_CATALOG_KEY=<your-key> ./install-skills.sh
#   ./install-skills.sh --api-key=<your-key>     # value leaks into shell history
#   ./install-skills.sh --upgrade                # replace a previously-installed CAIPE skill
#   ./install-skills.sh --force                  # overwrite an existing file unconditionally
#
# Security: this script NEVER prints the API key. The key is only used in
# the X-Caipe-Catalog-Key request header sent to the gateway.

set -euo pipefail

AGENT_ID=${Q_AGENT_ID}
AGENT_LABEL=${Q_AGENT_LABEL}
SCOPE=${Q_SCOPE}
LAYOUT=${Q_LAYOUT}
COMMAND_NAME=${Q_COMMAND}
FORMAT=${Q_FORMAT}
INSTALL_PATH_RAW=${Q_INSTALL_PATH}
COMMANDS_DIR_RAW=${Q_COMMANDS_DIR}
FILE_EXT=${Q_FILE_EXT}
LIVE_SKILLS_URL=${Q_LIVE_SKILLS_URL}
BASE_URL=${Q_BASE_URL}
CATALOG_URL=${Q_CATALOG_URL}
BULK_MODE=${bulkMode ? "1" : "0"}
IS_FRAGMENT=${isFragment ? "1" : "0"}

API_KEY="\${CAIPE_CATALOG_KEY:-}"
FORCE=0
UPGRADE=0

# Sidecar manifest of files this installer has written, used by --upgrade to
# decide whether it's safe to overwrite an existing target. Lives next to the
# config.json the live-skills helper already reads, so a single dotfile sync
# moves both with the user.
MANIFEST_PATH="\${CAIPE_INSTALL_MANIFEST:-\${HOME:-.}/.config/caipe/installed.json}"

usage() {
  cat <<USAGE
install-skills.sh — installs the CAIPE live-skills skill for \$AGENT_LABEL.

Usage:
  $0 [--upgrade|--force] [--api-key=<key>]

API key resolution (first match wins):
  1. --api-key=<key>              passed on the command line (WARNING: see below)
  2. \\\$CAIPE_CATALOG_KEY          environment variable (WARNING: see below)
  3. ~/.config/caipe/config.json     { "api_key": "..." }   ← recommended
  4. ~/.config/grid/config.json      { "api_key": "..." }   (shared dotfile)

The config.json approach keeps your key out of shell history entirely.
Options 1 and 2 both appear in shell history (--api-key as a flag on the
command line; CAIPE_CATALOG_KEY=<key> as an export or inline assignment).

Options:
  --api-key=<key>   Supply the catalog API key as a flag. WARNING: visible in
                    \\\`ps\\\` output AND shell history. Prefer config.json.
  --upgrade         Replace a previously-installed CAIPE skill at the target
                    path with the latest version. Looks up ownership in the
                    manifest at $MANIFEST_PATH and refuses to touch files it
                    doesn't own.
  --force           Overwrite the target file unconditionally. Use this only
                    if you know you want to discard the existing contents.
  --help            Show this message.

Environment:
  CAIPE_CATALOG_KEY        Catalog API key. Never echoed by this script.
  CAIPE_INSTALL_MANIFEST   Override path of the sidecar install manifest
                           (default: ~/.config/caipe/installed.json).
USAGE
}

# Parse args. Use "case" rather than getopts so --api-key=… and --force can
# appear in any order without surprises on macOS bash 3.2.
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --api-key=*)
      API_KEY="\${1#--api-key=}"
      echo "warning: --api-key passes the secret on the process command line." >&2
      echo "         It will appear in 'ps' output to other users on this host." >&2
      echo "         Prefer storing the key in ~/.config/caipe/config.json once." >&2
      ;;
    --api-key)
      shift
      API_KEY="\${1:-}"
      echo "warning: --api-key passes the secret on the process command line." >&2
      echo "         It will appear in 'ps' output to other users on this host." >&2
      echo "         Prefer storing the key in ~/.config/caipe/config.json once." >&2
      ;;
    --force) FORCE=1 ;;
    --upgrade) UPGRADE=1 ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "error: unknown argument: \$1" >&2
      usage >&2
      exit 64
      ;;
  esac
  shift || true
done

# Try the on-disk config files when no key has been supplied yet. We use
# python3 (always available where this script runs because the live-skills
# helper requires it) so we don't need to ship a JSON parser in bash.
read_api_key_from_config() {
  local cfg_path="\$1"
  if [ ! -r "\$cfg_path" ]; then
    return 1
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
try:
  data = json.load(open(sys.argv[1]))
except Exception:
  sys.exit(1)
key = (data.get("api_key") or "").strip()
if not key:
  sys.exit(1)
sys.stdout.write(key)
' "\$cfg_path" 2>/dev/null && return 0
  fi
  return 1
}

if [ -z "\$API_KEY" ]; then
  for cfg in "\${HOME:-.}/.config/caipe/config.json" "\${HOME:-.}/.config/grid/config.json"; do
    if k="\$(read_api_key_from_config "\$cfg")" && [ -n "\$k" ]; then
      API_KEY="\$k"
      echo "==> using API key from \$cfg" >&2
      break
    fi
  done
fi

if [ -z "\$API_KEY" ]; then
  echo "error: catalog API key is required." >&2
  echo "       Easiest fix: create ~/.config/caipe/config.json with:" >&2
  echo "           { \\"api_key\\": \\"<your-key>\\" }" >&2
  echo "       Or pass --api-key=<key> / set CAIPE_CATALOG_KEY=<key>." >&2
  exit 64
fi

# Required tooling.
if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required but was not found in PATH." >&2
  exit 69
fi

# Resolve install path for the chosen scope.
case "\$SCOPE" in
  user)
    if [ -z "\${HOME:-}" ]; then
      echo "error: \\$HOME is not set; cannot resolve user-global install path." >&2
      exit 78
    fi
    INSTALL_PATH="\${INSTALL_PATH_RAW/#~\\//\$HOME/}"
    ;;
  project)
    # ./… paths are already relative to \$PWD.
    INSTALL_PATH="\$INSTALL_PATH_RAW"
    ;;
  *)
    echo "error: unknown scope: \$SCOPE" >&2
    exit 64
    ;;
esac

INSTALL_DIR="\$(dirname "\$INSTALL_PATH")"

# Resolve the per-agent commands directory from the same scope substitution
# rule as INSTALL_PATH. Used in BULK_MODE only.
case "\$SCOPE" in
  user)    COMMANDS_DIR="\${COMMANDS_DIR_RAW/#~\\//\$HOME/}" ;;
  project) COMMANDS_DIR="\$COMMANDS_DIR_RAW" ;;
esac

# ---------- sidecar install manifest helpers ----------
#
# Ownership of installed files is tracked in a JSON manifest at
# \$MANIFEST_PATH. The on-disk file body is unmodified — no comment markers,
# no preamble lines — so what we write is byte-for-byte what the catalog
# returned, and \`grep\`/\`diff\` against the upstream skill source produces a
# clean diff.

manifest_owns() {
  # manifest_owns <abs-path>  →  exit 0 if the manifest records this path as
  # installed by us, exit 1 otherwise. Missing manifest means "we own
  # nothing". Robust to a corrupt file (treated as empty).
  local target="\$1"
  if [ ! -r "\$MANIFEST_PATH" ]; then
    return 1
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
try:
  data = json.load(open(sys.argv[1]))
except Exception:
  sys.exit(1)
target = sys.argv[2]
for entry in (data or {}).get("installed", []) or []:
  if entry.get("path") == target:
    sys.exit(0)
sys.exit(1)
' "\$MANIFEST_PATH" "\$target" 2>/dev/null
    return \$?
  fi
  return 1
}

manifest_register() {
  # manifest_register <abs-path>
  # Idempotently insert/update an entry for this path in the manifest. We
  # scope by (agent, scope, path) so re-installing the same skill at the same
  # path replaces its record rather than duplicating it.
  local target="\$1"
  local cfg_dir
  cfg_dir="\$(dirname "\$MANIFEST_PATH")"
  if ! mkdir -p "\$cfg_dir" 2>/dev/null; then
    echo "warning: could not create \$cfg_dir; --upgrade will not work next time" >&2
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    # No python3 means we also couldn't have parsed config.json above; skip
    # tracking gracefully so the install itself still succeeds.
    return 0
  fi
  python3 - "\$MANIFEST_PATH" "\$AGENT_ID" "\$SCOPE" "\$target" <<'PY' 2>/dev/null || true
import datetime, json, os, sys, tempfile

manifest_path, agent, scope, target = sys.argv[1:]
data = {"version": 1, "installed": []}
if os.path.isfile(manifest_path):
    try:
        data = json.load(open(manifest_path))
        if not isinstance(data, dict):
            data = {"version": 1, "installed": []}
        data.setdefault("version", 1)
        data.setdefault("installed", [])
    except Exception:
        data = {"version": 1, "installed": []}

now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
entry = {
    "agent": agent,
    "scope": scope,
    "path": target,
    "installed_at": now,
}
# Replace any existing entry for the same (agent, scope, path).
data["installed"] = [
    e for e in data["installed"]
    if not (e.get("agent") == agent and e.get("scope") == scope and e.get("path") == target)
] + [entry]

# Atomic write via tempfile in the same dir.
fd, tmp = tempfile.mkstemp(prefix=".caipe-manifest-", dir=os.path.dirname(manifest_path) or ".")
try:
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, manifest_path)
    os.chmod(manifest_path, 0o600)
except Exception:
    try:
        os.unlink(tmp)
    except OSError:
        pass
PY
}

# ---------- bulk install ("Pick your skills" selection) ----------
#
# Triggered when the gateway templated a non-empty CATALOG_URL into the
# script. We fetch the catalog listing, then write one file per returned
# skill into \$COMMANDS_DIR with the same manifest/--upgrade semantics as
# the single-skill flow below.
if [ "\$BULK_MODE" = "1" ]; then
  if [ "\$IS_FRAGMENT" = "1" ]; then
    echo "error: bulk install is not supported for \$AGENT_LABEL" >&2
    echo "       (\$AGENT_LABEL stores commands inside an existing config" >&2
    echo "       file; merging multiple skills automatically would risk" >&2
    echo "       clobbering your editor settings)." >&2
    exit 64
  fi

  CATALOG_TMP="\$(mktemp -t caipe-catalog-XXXXXX)"
  trap 'rm -f "\$CATALOG_TMP"' EXIT

  CAT_STATUS="\$(curl -sS -o "\$CATALOG_TMP" -w '%{http_code}' \\
    -H "X-Caipe-Catalog-Key: \$API_KEY" \\
    -H 'Accept: application/json' \\
    "\$CATALOG_URL")" || {
      echo "error: failed to reach catalog at \$BASE_URL" >&2
      exit 69
    }

  if [ "\$CAT_STATUS" != "200" ]; then
    echo "error: catalog returned HTTP \$CAT_STATUS for \$CATALOG_URL" >&2
    if [ -s "\$CATALOG_TMP" ]; then
      echo "       body: \$(head -c 500 "\$CATALOG_TMP")" >&2
    fi
    exit 76
  fi

  # Emit each *file* (SKILL.md + any ancillary files) as a NUL-delimited
  # "<safe_skill_name>\\0<relative_path>\\0<base64_body>\\0" triple.
  #
  # The SKILL.md body is emitted with rel_path = "SKILL.md"; ancillary
  # files keep the path the catalog/hub recorded (e.g. "scripts/extract.py",
  # "references/forms.json"). This lets multi-file skills (Anthropic's pdf,
  # docx, slack, etc.) install verbatim — the agent can resolve SKILL.md's
  # internal references against the same on-disk layout it had on GitHub.
  #
  # Path sanitization rules:
  #   - skill name -> strict [A-Za-z0-9._-]+
  #   - rel_path components individually sanitized; absolute paths, double-dot
  #     parents, leading slash, and empty components are rejected, so a hostile
  #     catalog cannot escape \$COMMANDS_DIR/<skill>/.
  emit_records() {
    if command -v python3 >/dev/null 2>&1; then
      python3 -c '
import base64, json, re, sys
data = json.load(open(sys.argv[1]))
out = sys.stdout.buffer
NAME_RE = re.compile(r"[^A-Za-z0-9._-]")
PART_RE = re.compile(r"[^A-Za-z0-9._-]")
def safe_path(rel):
    rel = rel.replace("\\\\", "/").lstrip("/")
    parts = []
    for p in rel.split("/"):
        if not p or p == "." or p == "..":
            return None
        parts.append(PART_RE.sub("_", p))
    return "/".join(parts) if parts else None
for s in data.get("skills", []) or []:
    name = (s.get("name") or "").strip()
    if not name:
        continue
    safe_name = NAME_RE.sub("_", name)
    body = (s.get("content") or "").encode("utf-8")
    out.write(safe_name.encode("ascii") + b"\\x00" + b"SKILL.md" + b"\\x00" + base64.b64encode(body) + b"\\x00")
    anc = s.get("ancillary_files") or {}
    if isinstance(anc, dict):
        for rel, content in anc.items():
            if not isinstance(rel, str) or not isinstance(content, str):
                continue
            sp = safe_path(rel)
            if not sp or sp == "SKILL.md":
                continue
            ab = content.encode("utf-8")
            out.write(safe_name.encode("ascii") + b"\\x00" + sp.encode("ascii") + b"\\x00" + base64.b64encode(ab) + b"\\x00")
' "\$CATALOG_TMP"
    elif command -v jq >/dev/null 2>&1; then
      # jq fallback: SKILL.md only (ancillary files require a real
      # tokenizer for path sanitization that jq can't safely express).
      # Operators who need full multi-file install should ensure python3
      # is on PATH; we still install the SKILL.md so the skill is at least
      # discoverable.
      jq -j '
        .skills[]
        | select((.name? // "") != "")
        | (
            (.name | gsub("[^A-Za-z0-9._-]"; "_"))
            + "\\u0000"
            + "SKILL.md"
            + "\\u0000"
            + ((.content // "") | @base64)
            + "\\u0000"
          )
      ' < "\$CATALOG_TMP"
      if jq -e '[.skills[]?.ancillary_files // {} | length] | add // 0 | . > 0' < "\$CATALOG_TMP" >/dev/null 2>&1; then
        echo "warn: ancillary files were skipped (install python3 to materialize the full skill folder)" >&2
      fi
    else
      echo "error: need jq or python3 to parse the catalog response." >&2
      return 69
    fi
  }

  mkdir -p "\$COMMANDS_DIR"

  WROTE=0
  SKIPPED=0
  TOTAL=0
  SKILLS_SEEN=""

  # Read NUL-delimited (name, rel_path, b64body) triples. Each skill emits
  # one record per file: SKILL.md first, then ancillary files (if any).
  while IFS= read -r -d '' SKILL_NAME && IFS= read -r -d '' REL_PATH && IFS= read -r -d '' SKILL_B64; do
    if [ -z "\$SKILL_NAME" ] || [ -z "\$REL_PATH" ]; then
      continue
    fi

    # Track unique skill names so the summary still counts skills, not files.
    case " \$SKILLS_SEEN " in
      *" \$SKILL_NAME "*) ;;
      *) SKILLS_SEEN="\$SKILLS_SEEN \$SKILL_NAME"; TOTAL=\$((TOTAL + 1)) ;;
    esac

    # Layout decisions:
    #   - "skills" layout (Claude/Cursor/opencode): one folder per skill,
    #     ancillary files preserved at their relative paths so SKILL.md's
    #     internal references (scripts/, references/, assets/) resolve.
    #   - "commands" layout (legacy slash commands): flat <skill>.<ext>
    #     file. Ancillary files don't make sense here — agents in this
    #     layout don't load sibling files — so we drop them with a notice.
    if [ "\$LAYOUT" = "skills" ]; then
      TARGET_DIR="\$COMMANDS_DIR/\$SKILL_NAME"
      if [ "\$REL_PATH" = "SKILL.md" ]; then
        TARGET="\$TARGET_DIR/SKILL.md"
      else
        TARGET="\$TARGET_DIR/\$REL_PATH"
      fi
      mkdir -p "\$(dirname "\$TARGET")"
    else
      if [ "\$REL_PATH" != "SKILL.md" ]; then
        # Commands-layout agents don't load ancillary files — skip silently
        # (the SKILL.md still installs and the user gets the prompt body).
        continue
      fi
      TARGET_DIR="\$COMMANDS_DIR"
      TARGET="\$COMMANDS_DIR/\$SKILL_NAME.\$FILE_EXT"
    fi

    # Per-file overwrite policy mirrors the single-skill flow:
    #   --force   : overwrite anything
    #   --upgrade : overwrite only if our manifest records this path
    #   neither   : skip (don't error — partial bulk should still complete)
    if [ -e "\$TARGET" ]; then
      if [ "\$FORCE" -eq 1 ]; then
        :
      elif [ "\$UPGRADE" -eq 1 ]; then
        if manifest_owns "\$TARGET"; then
          :
        else
          echo "skip: \$TARGET exists but is not tracked by \$MANIFEST_PATH" >&2
          SKIPPED=\$((SKIPPED + 1))
          continue
        fi
      else
        echo "skip: \$TARGET already exists (re-run with --upgrade or --force)" >&2
        SKIPPED=\$((SKIPPED + 1))
        continue
      fi
    fi

    # Decode the base64 body into a tempfile in the same dir, then atomic-rename.
    # The body is written verbatim — no marker line, no preamble — so what
    # lands on disk is byte-for-byte the catalog's content.
    PARENT_DIR="\$(dirname "\$TARGET")"
    PER_TMP="\$(mktemp "\$PARENT_DIR/.caipe-install-XXXXXX")"
    if command -v base64 >/dev/null 2>&1; then
      # macOS uses -D, GNU uses -d. Try -d first, fall back to -D.
      if ! printf '%s' "\$SKILL_B64" | base64 -d > "\$PER_TMP" 2>/dev/null; then
        if ! printf '%s' "\$SKILL_B64" | base64 -D > "\$PER_TMP" 2>/dev/null; then
          echo "error: failed to decode body for \$SKILL_NAME/\$REL_PATH" >&2
          rm -f "\$PER_TMP"
          continue
        fi
      fi
    else
      echo "error: 'base64' is required for bulk install" >&2
      rm -f "\$PER_TMP"
      exit 69
    fi
    mv -f "\$PER_TMP" "\$TARGET"
    chmod 0644 "\$TARGET"
    manifest_register "\$TARGET"
    echo "==> wrote \$TARGET"
    WROTE=\$((WROTE + 1))
  done < <(emit_records)

  echo
  echo "==> agent : \$AGENT_LABEL (\$AGENT_ID)"
  echo "==> scope : \$SCOPE"
  echo "==> dir   : \$COMMANDS_DIR"
  echo "==> wrote \$WROTE files across \$TOTAL skills (\$SKIPPED skipped)"
  if [ "\$WROTE" -eq 0 ] && [ "\$TOTAL" -gt 0 ]; then
    echo "    (re-run with --upgrade to refresh existing CAIPE skills" >&2
    echo "     or --force to overwrite unconditionally)" >&2
  fi
  exit 0
fi

if [ "\$IS_FRAGMENT" = "1" ]; then
  # Continue stores commands inside an existing config.json. We do NOT
  # rewrite the file from this script — it would risk clobbering user config.
  echo "==> \$AGENT_LABEL stores commands as a JSON fragment inside:"
  echo "    \$INSTALL_PATH"
  echo
  echo "    Fetching the rendered fragment now; please merge it into the"
  echo "    top-level \\"slashCommands\\" array of that file."
  echo
fi

# Fetch the rendered template from the gateway. We never log the key.
TMP_FILE="\$(mktemp -t caipe-install-XXXXXX)"
trap 'rm -f "\$TMP_FILE"' EXIT

HTTP_STATUS="\$(curl -sS -o "\$TMP_FILE" -w '%{http_code}' \\
  -H "X-Caipe-Catalog-Key: \$API_KEY" \\
  -H 'Accept: application/json' \\
  "\$LIVE_SKILLS_URL")" || {
    echo "error: failed to reach \$BASE_URL" >&2
    exit 69
  }

if [ "\$HTTP_STATUS" != "200" ]; then
  echo "error: gateway returned HTTP \$HTTP_STATUS for \$LIVE_SKILLS_URL" >&2
  if [ -s "\$TMP_FILE" ]; then
    echo "       body: \$(head -c 500 "\$TMP_FILE")" >&2
  fi
  exit 76
fi

# Pull the rendered "template" field out of the JSON response. Prefer jq
# (correct + simple); fall back to python3, then to a defensive sed/awk
# combo, so the installer keeps working in minimal environments.
extract_template() {
  if command -v jq >/dev/null 2>&1; then
    jq -er '.template' < "\$TMP_FILE"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json, sys; sys.stdout.write(json.load(open(sys.argv[1]))["template"])' "\$TMP_FILE"
  elif command -v python >/dev/null 2>&1; then
    python -c 'import json, sys; sys.stdout.write(json.load(open(sys.argv[1]))["template"])' "\$TMP_FILE"
  else
    echo "error: need jq or python3 to parse the gateway response." >&2
    return 69
  fi
}

RENDERED="\$(extract_template)" || exit \$?

if [ -z "\$RENDERED" ]; then
  echo "error: gateway returned an empty template." >&2
  exit 76
fi

# Decide if we may write to \$INSTALL_PATH.
#   --force   : overwrite anything (escape hatch)
#   --upgrade : overwrite ONLY if the manifest records this path as ours
#   neither   : refuse if the file already exists
if [ -e "\$INSTALL_PATH" ]; then
  if [ "\$FORCE" -eq 1 ]; then
    : # caller asked for unconditional overwrite
  elif [ "\$UPGRADE" -eq 1 ]; then
    if manifest_owns "\$INSTALL_PATH"; then
      : # safe to upgrade — manifest says we wrote this file previously
    else
      echo "error: \$INSTALL_PATH exists but is not tracked by" >&2
      echo "       \$MANIFEST_PATH. Re-run with --force to overwrite anyway," >&2
      echo "       or remove the file first." >&2
      exit 73
    fi
  else
    echo "error: \$INSTALL_PATH already exists." >&2
    echo "       Re-run with --upgrade to replace a previously-installed" >&2
    echo "       CAIPE skill, or --force to overwrite unconditionally." >&2
    exit 73
  fi
fi

mkdir -p "\$INSTALL_DIR"

# Atomic write: render to a tempfile in the same dir, then rename. The body
# is written verbatim — no marker line, no preamble — so what lands on disk
# is byte-for-byte the gateway's rendered template. Ownership is recorded in
# the sidecar manifest after the rename succeeds.
TARGET_TMP="\$(mktemp "\$INSTALL_DIR/.caipe-install-XXXXXX")"
printf '%s' "\$RENDERED" > "\$TARGET_TMP"
mv -f "\$TARGET_TMP" "\$INSTALL_PATH"
chmod 0644 "\$INSTALL_PATH"
manifest_register "\$INSTALL_PATH"

echo "==> wrote \$INSTALL_PATH"
echo "==> agent : \$AGENT_LABEL (\$AGENT_ID)"
echo "==> scope : \$SCOPE"
echo "==> command: /\$COMMAND_NAME"
echo
if [ "\$IS_FRAGMENT" = "1" ]; then
  echo "Next step: merge the fragment above into the \\"slashCommands\\" array"
  echo "of \$INSTALL_PATH (or your editor's Continue config). The current file"
  echo "now contains ONLY the fragment — back up first if you had existing"
  echo "config in place. (We refuse to merge automatically to avoid clobbering"
  echo "your editor settings.)"
else
  echo "Next step: launch \$AGENT_LABEL and run /\$COMMAND_NAME."
fi
`;
}

/* ---------- handler ---------- */

export async function GET(request: Request) {
  const url = new URL(request.url);

  const agentId = (url.searchParams.get("agent") ?? "").trim().toLowerCase();
  if (!agentId) {
    return plainTextError("missing required ?agent=<id> parameter", 400);
  }
  const agent = AGENTS[agentId];
  if (!agent) {
    return plainTextError(`unknown agent: ${agentId}`, 400);
  }

  const scopeRaw = (url.searchParams.get("scope") ?? "").trim().toLowerCase();
  if (scopeRaw !== "user" && scopeRaw !== "project") {
    return plainTextError(
      "missing or invalid ?scope=<user|project> parameter",
      400,
    );
  }
  const scope = scopeRaw as "user" | "project";

  // Resolve the layout BEFORE checking scope support — `scope_available` is
  // layout-dependent (an agent might support `user` only for `commands` and
  // both for `skills`, etc.). Default: agent's stated default; falls back to
  // `commands` if the request asked for an unsupported layout.
  const layoutsAvail = layoutsAvailableFor(agent);
  const layoutRaw = (url.searchParams.get("layout") ?? "").trim().toLowerCase();
  let layout: AgentLayout = layoutsAvail[0];
  if (layoutRaw === "skills" || layoutRaw === "commands") {
    if (!layoutsAvail.includes(layoutRaw as AgentLayout)) {
      return plainTextError(
        `agent ${agentId} does not support layout=${layoutRaw} (supported: ${layoutsAvail.join(", ")})`,
        400,
      );
    }
    layout = layoutRaw as AgentLayout;
  }

  const supported = scopesAvailableFor(agent, layout);
  if (!supported.includes(scope)) {
    return plainTextError(
      `agent ${agentId} does not support scope=${scope} for layout=${layout} (supported: ${supported.join(", ") || "none"})`,
      400,
    );
  }

  const commandName = sanitizeCommandName(url.searchParams.get("command_name"));
  const description = sanitizeDescription(url.searchParams.get("description"));
  // `request.url` is the internal listen address behind an ingress
  // (e.g. http://0.0.0.0:3000), so we MUST honor x-forwarded-* headers.
  // Otherwise the script we hand back tries to call back into the pod IP
  // and fails with `tlsv1 alert protocol version` / connection refused.
  const baseUrl =
    sanitizeBaseUrl(url.searchParams.get("base_url")) ??
    getRequestOrigin(request);

  // Optional catalog-query bulk mode driven by the Skills API Gateway
  // "Pick your skills" Query Builder. When present this wins over the new
  // default mode — the user has explicitly composed a query and wants
  // exactly its result set written to disk, no helpers, no hook.
  const catalogUrlRaw = url.searchParams.get("catalog_url");
  const catalogUrl = sanitizeCatalogUrl(catalogUrlRaw, new URL(baseUrl).origin);
  if (catalogUrlRaw && !catalogUrl) {
    return plainTextError(
      "invalid ?catalog_url= parameter (must be a same-origin URL pointing at /api/skills)",
      400,
    );
  }
  if (catalogUrl && agent.isFragment) {
    return plainTextError(
      `bulk install via ?catalog_url= is not supported for agent ${agent.id} (fragment-config agent)`,
      400,
    );
  }

  // Resolve install mode. Precedence:
  //   1. ?catalog_url=... locks us into catalog-query mode (existing flow).
  //   2. ?mode=live-only opts into the legacy single-skill flow.
  //   3. Otherwise default to bulk-with-helpers (the new "everything"
  //      flow), which silently degrades to live-only for fragment-config
  //      agents since they can't materialize one file per catalog skill.
  const modeRaw = (url.searchParams.get("mode") ?? "").trim().toLowerCase();
  let mode: InstallMode;
  if (catalogUrl) {
    mode = "catalog-query";
  } else if (modeRaw === "live-only") {
    mode = "live-only";
  } else if (modeRaw && modeRaw !== "bulk" && modeRaw !== "bulk-with-helpers") {
    return plainTextError(
      `invalid ?mode= value: ${modeRaw} (allowed: bulk, bulk-with-helpers, live-only)`,
      400,
    );
  } else if (agent.isFragment) {
    // Fragment-config agents can't bulk-install — fall back without
    // making the UI special-case them. The generated script's banner
    // explains the demotion so the user isn't confused.
    mode = "live-only";
  } else {
    mode = "bulk-with-helpers";
  }

  const script = buildScript({
    agent,
    scope,
    layout,
    commandName,
    description,
    baseUrl,
    mode,
    catalogUrl,
  });

  const filenameSuffix =
    mode === "catalog-query"
      ? "-bulk"
      : mode === "bulk-with-helpers"
        ? "-bundle"
        : "";
  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Content-Disposition": `attachment; filename="install-skills-${agent.id}-${scope}${filenameSuffix}.sh"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * GET /api/skills/install.sh
 *
 * Returns a portable bash installer that fetches the rendered bootstrap
 * template for a given agent + scope and writes it to disk. The script is
 * intended for `curl … | bash` or "download & inspect first" workflows
 * surfaced from the Skills API Gateway UI.
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
 *     script does a fresh GET to /api/skills/bootstrap?... at install time,
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
} from "../bootstrap/agents";
import { getRequestOrigin } from "../_lib/request-origin";

/* ---------- input sanitizers (mirror the bootstrap route) ---------- */

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
 * iterates the catalog response instead of installing the bootstrap skill.
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

interface ScriptInputs {
  agent: AgentSpec;
  scope: "user" | "project";
  layout: AgentLayout;
  commandName: string;
  description: string;
  baseUrl: string;
  /**
   * When set, the installer runs in BULK mode: it ignores the bootstrap
   * template and instead fetches this URL (must be `<baseUrl>/api/skills?…`),
   * iterating the response and writing one skill file per catalog entry into
   * the agent's commands directory.
   */
  catalogUrl: string | null;
}

function buildScript({
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
  const bootstrapUrl = `${baseUrl}/api/skills/bootstrap?${queryString}`;
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
  const Q_BOOTSTRAP_URL = shq(bootstrapUrl);
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
# Mode  : ${bulkMode ? "BULK (one file per skill from catalog query)" : "single bootstrap skill"}
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
BOOTSTRAP_URL=${Q_BOOTSTRAP_URL}
BASE_URL=${Q_BASE_URL}
CATALOG_URL=${Q_CATALOG_URL}
BULK_MODE=${bulkMode ? "1" : "0"}
IS_FRAGMENT=${isFragment ? "1" : "0"}

API_KEY="\${CAIPE_CATALOG_KEY:-}"
FORCE=0
UPGRADE=0

# Sidecar manifest of files this installer has written, used by --upgrade to
# decide whether it's safe to overwrite an existing target. Lives next to the
# config.json the bootstrap helper already reads, so a single dotfile sync
# moves both with the user.
MANIFEST_PATH="\${CAIPE_INSTALL_MANIFEST:-\${HOME:-.}/.config/caipe/installed.json}"

usage() {
  cat <<USAGE
install-skills.sh — installs the CAIPE bootstrap skill for \$AGENT_LABEL.

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
# python3 (always available where this script runs because the bootstrap
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

  # Emit each skill as a NUL-delimited "<safe_name>\\0<base64_content>\\0"
  # record. NUL/base64 keeps newlines and special chars in the body intact
  # across the read loop, and we sanitize the name to a strict allow-list
  # so a hostile catalog can't write outside \$COMMANDS_DIR.
  emit_records() {
    if command -v jq >/dev/null 2>&1; then
      jq -j '
        .skills[]
        | select((.name? // "") != "")
        | (
            (.name | gsub("[^A-Za-z0-9._-]"; "_"))
            + "\\u0000"
            + ((.content // "") | @base64)
            + "\\u0000"
          )
      ' < "\$CATALOG_TMP"
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c '
import base64, json, re, sys
data = json.load(open(sys.argv[1]))
out = sys.stdout.buffer
for s in data.get("skills", []) or []:
    name = (s.get("name") or "").strip()
    if not name:
        continue
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    body = (s.get("content") or "").encode("utf-8")
    out.write(safe.encode("ascii") + b"\\x00" + base64.b64encode(body) + b"\\x00")
' "\$CATALOG_TMP"
    else
      echo "error: need jq or python3 to parse the catalog response." >&2
      return 69
    fi
  }

  mkdir -p "\$COMMANDS_DIR"

  WROTE=0
  SKIPPED=0
  TOTAL=0

  # Read NUL-delimited (name, b64body) pairs.
  while IFS= read -r -d '' SKILL_NAME && IFS= read -r -d '' SKILL_B64; do
    TOTAL=\$((TOTAL + 1))
    if [ -z "\$SKILL_NAME" ]; then
      continue
    fi
    # In skills layout each skill lives in its own dir as SKILL.md (the
    # filename Claude/Cursor/opencode auto-discover). In commands layout
    # we keep the legacy flat <skill>.<ext> file.
    if [ "\$LAYOUT" = "skills" ]; then
      TARGET_DIR="\$COMMANDS_DIR/\$SKILL_NAME"
      TARGET="\$TARGET_DIR/SKILL.md"
      mkdir -p "\$TARGET_DIR"
    else
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
    PER_TMP="\$(mktemp "\$TARGET_DIR/.caipe-install-XXXXXX")"
    if command -v base64 >/dev/null 2>&1; then
      # macOS uses -D, GNU uses -d. Try -d first, fall back to -D.
      if ! printf '%s' "\$SKILL_B64" | base64 -d > "\$PER_TMP" 2>/dev/null; then
        if ! printf '%s' "\$SKILL_B64" | base64 -D > "\$PER_TMP" 2>/dev/null; then
          echo "error: failed to decode body for \$SKILL_NAME" >&2
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
  echo "==> wrote \$WROTE of \$TOTAL skills (\$SKIPPED skipped)"
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
  "\$BOOTSTRAP_URL")" || {
    echo "error: failed to reach \$BASE_URL" >&2
    exit 69
  }

if [ "\$HTTP_STATUS" != "200" ]; then
  echo "error: gateway returned HTTP \$HTTP_STATUS for \$BOOTSTRAP_URL" >&2
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

  // Optional bulk-install mode driven by the Skills API Gateway Query Builder.
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

  const script = buildScript({
    agent,
    scope,
    layout,
    commandName,
    description,
    baseUrl,
    catalogUrl,
  });

  const filenameSuffix = catalogUrl ? "-bulk" : "";
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

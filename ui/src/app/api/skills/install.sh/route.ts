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
 *   - The script NEVER prints or logs the API key. The key arrives via the
 *     `CAIPE_CATALOG_KEY` env var (preferred) or `--api-key=<value>` flag
 *     (printed once with a warning that it leaks into shell history).
 *   - The rendered template body is NOT baked into the script. Instead the
 *     script does a fresh GET to /api/skills/bootstrap?... at install time,
 *     so users always get the latest canonical template and the script stays
 *     small and easy to audit.
 *   - We refuse to overwrite an existing target file unless `--upgrade` (for
 *     a previously-installed CAIPE skill) or `--force` (escape hatch) is
 *     passed, so re-running the one-liner is safe.
 *   - Every file the script writes carries a marker line
 *     (`caipe-skill: <agent>/<command>`) in a format-appropriate comment so
 *     `--upgrade` can verify it's only overwriting files it owns.
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
import { AGENTS, scopesAvailableFor, type AgentSpec } from "../bootstrap/agents";

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
  commandName: string;
  description: string;
  baseUrl: string;
}

function buildScript({
  agent,
  scope,
  commandName,
  description,
  baseUrl,
}: ScriptInputs): string {
  const installPathTemplate = agent.installPaths[scope]!;
  const resolvedPath = installPathTemplate.replace(/\{name\}/g, commandName);
  const isFragment = !!agent.isFragment;
  const queryString = new URLSearchParams({
    agent: agent.id,
    scope,
    command_name: commandName,
    base_url: baseUrl,
    ...(description ? { description } : {}),
  }).toString();
  const bootstrapUrl = `${baseUrl}/api/skills/bootstrap?${queryString}`;

  // Pre-quote everything we templated in.
  const Q_AGENT_ID = shq(agent.id);
  const Q_AGENT_LABEL = shq(agent.label);
  const Q_SCOPE = shq(scope);
  const Q_COMMAND = shq(commandName);
  const Q_FORMAT = shq(agent.format);
  const Q_INSTALL_PATH = shq(resolvedPath);
  const Q_BOOTSTRAP_URL = shq(bootstrapUrl);
  const Q_BASE_URL = shq(baseUrl);

  return `#!/usr/bin/env bash
# install-skills.sh — fetch and install the CAIPE bootstrap skill
#
# Generated by ${baseUrl}/api/skills/install.sh
# Agent : ${agent.label} (${agent.id})
# Scope : ${scope} (${scope === "user" ? "user-global" : "project-local"})
# Format: ${agent.format}
# Target: ${resolvedPath}
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
COMMAND_NAME=${Q_COMMAND}
FORMAT=${Q_FORMAT}
INSTALL_PATH_RAW=${Q_INSTALL_PATH}
BOOTSTRAP_URL=${Q_BOOTSTRAP_URL}
BASE_URL=${Q_BASE_URL}
IS_FRAGMENT=${isFragment ? "1" : "0"}

API_KEY="\${CAIPE_CATALOG_KEY:-}"
FORCE=0
UPGRADE=0

# Marker baked into every file we write. Lets --upgrade verify ownership
# before clobbering. Format-specific comment syntax is applied below.
MARKER_TAG="caipe-skill: \$AGENT_ID/\$COMMAND_NAME"

usage() {
  cat <<USAGE
install-skills.sh — installs the CAIPE bootstrap skill for \$AGENT_LABEL.

Usage:
  CAIPE_CATALOG_KEY=<key> $0 [--upgrade|--force]
  $0 --api-key=<key> [--upgrade|--force]
  $0 --help

Options:
  --api-key=<key>   Supply the catalog API key as a flag. Prefer the
                    CAIPE_CATALOG_KEY env var; flags appear in shell history.
  --upgrade         Replace an existing CAIPE skill at the target path with
                    the latest version. Refuses to touch a file that wasn't
                    written by this installer (no marker found).
  --force           Overwrite the target file unconditionally. Use this only
                    if you know you want to discard the existing contents.
  --help            Show this message.

Environment:
  CAIPE_CATALOG_KEY  Catalog API key (preferred). Never echoed by this script.
USAGE
}

# Parse args. Use "case" rather than getopts so --api-key=… and --force can
# appear in any order without surprises on macOS bash 3.2.
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --api-key=*)
      API_KEY="\${1#--api-key=}"
      echo "warning: --api-key passes the secret on the command line and will" >&2
      echo "         be recorded in your shell history. Prefer:" >&2
      echo "             CAIPE_CATALOG_KEY=<key> $0" >&2
      ;;
    --api-key)
      shift
      API_KEY="\${1:-}"
      echo "warning: --api-key passes the secret on the command line and will" >&2
      echo "         be recorded in your shell history." >&2
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

if [ -z "\$API_KEY" ]; then
  echo "error: catalog API key is required." >&2
  echo "       Set CAIPE_CATALOG_KEY=<key> or pass --api-key=<key>." >&2
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

# Pick a marker comment appropriate to the file format. Non-fragment writes
# only — fragment agents (Continue) print merge instructions instead of
# touching the file.
case "\$FORMAT" in
  gemini-toml)             MARKER_LINE="# \$MARKER_TAG" ;;
  markdown-frontmatter|markdown-plain)
                           MARKER_LINE="<!-- \$MARKER_TAG -->" ;;
  *)                       MARKER_LINE="" ;;
esac

# Decide if we may write to \$INSTALL_PATH.
#   --force   : overwrite anything (escape hatch)
#   --upgrade : overwrite ONLY if the existing file carries our marker
#   neither   : refuse if the file already exists
if [ -e "\$INSTALL_PATH" ]; then
  if [ "\$FORCE" -eq 1 ]; then
    : # caller asked for unconditional overwrite
  elif [ "\$UPGRADE" -eq 1 ]; then
    if [ -n "\$MARKER_LINE" ] && grep -Fq -- "\$MARKER_TAG" "\$INSTALL_PATH" 2>/dev/null; then
      : # safe to upgrade — we wrote this file previously
    else
      echo "error: \$INSTALL_PATH exists but was not installed by this script" >&2
      echo "       (no '\$MARKER_TAG' marker found). Re-run with --force to" >&2
      echo "       overwrite anyway, or remove the file first." >&2
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

# Atomic write: render to a tempfile in the same dir, then rename. Prepend
# the marker (when applicable) so the next --upgrade run can recognize it.
TARGET_TMP="\$(mktemp "\$INSTALL_DIR/.caipe-install-XXXXXX")"
if [ -n "\$MARKER_LINE" ]; then
  printf '%s\\n%s' "\$MARKER_LINE" "\$RENDERED" > "\$TARGET_TMP"
else
  printf '%s' "\$RENDERED" > "\$TARGET_TMP"
fi
mv -f "\$TARGET_TMP" "\$INSTALL_PATH"
chmod 0644 "\$INSTALL_PATH"

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

  const supported = scopesAvailableFor(agent);
  if (!supported.includes(scope)) {
    return plainTextError(
      `agent ${agentId} does not support scope=${scope} (supported: ${supported.join(", ") || "none"})`,
      400,
    );
  }

  const commandName = sanitizeCommandName(url.searchParams.get("command_name"));
  const description = sanitizeDescription(url.searchParams.get("description"));
  const baseUrl =
    sanitizeBaseUrl(url.searchParams.get("base_url")) ?? url.origin;

  const script = buildScript({
    agent,
    scope,
    commandName,
    description,
    baseUrl,
  });

  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Content-Disposition": `attachment; filename="install-skills-${agent.id}-${scope}.sh"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

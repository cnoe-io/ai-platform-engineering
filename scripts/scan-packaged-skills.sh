#!/usr/bin/env bash
# Scan packaged/default skills under SKILLS_DIR with Cisco AI Defense skill-scanner (FR-023).
# Usage:
#   SKILLS_DIR=/path/to/skills ./scripts/scan-packaged-skills.sh
#   ./scripts/scan-packaged-skills.sh /path/to/skills
#
# Requires `skill-scanner` on PATH (e.g. uv pip install cisco-ai-skill-scanner).
# In CI without the CLI, the script exits 0 and prints a skip message so optional jobs stay green.

set -euo pipefail

TARGET="${1:-${SKILLS_DIR:-}}"

if [[ -z "${TARGET}" ]]; then
  echo "scan-packaged-skills: SKILLS_DIR not set and no path argument; nothing to scan." >&2
  exit 0
fi

if [[ ! -d "${TARGET}" ]]; then
  echo "scan-packaged-skills: directory does not exist: ${TARGET}" >&2
  exit 1
fi

if ! command -v skill-scanner >/dev/null 2>&1; then
  echo "scan-packaged-skills: skill-scanner not on PATH; skip (install: uv pip install cisco-ai-skill-scanner)." >&2
  exit 0
fi

POLICY="${SKILL_SCANNER_POLICY:-balanced}"
FAIL_ON="${SKILL_SCANNER_FAIL_ON:-}"

# Optional: fail build on severity (e.g. high) when SKILL_SCANNER_GATE=strict
if [[ "${SKILL_SCANNER_GATE:-warn}" == "strict" ]] && [[ -z "${FAIL_ON}" ]]; then
  FAIL_ON="high"
fi

# scan-all --recursive matches repos with many skill folders under SKILLS_DIR (see skill-scanner README).
ARGS=(scan-all "${TARGET}" --recursive --policy "${POLICY}")
if [[ -n "${FAIL_ON}" ]]; then
  ARGS+=("--fail-on-severity" "${FAIL_ON}")
fi

echo "scan-packaged-skills: running skill-scanner on ${TARGET} (policy=${POLICY}, gate=${SKILL_SCANNER_GATE:-warn})"
exec skill-scanner "${ARGS[@]}"

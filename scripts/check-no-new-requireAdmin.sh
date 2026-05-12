#!/usr/bin/env bash
# scripts/check-no-new-requireAdmin.sh
#
# Spec 102 / T051 — guard against new uses of the deprecated `requireAdmin` /
# `requireAdminView` helpers in `ui/src/app/api/**/route.ts`.
#
# Allow-list: any route whose matrix entry in `tests/rbac/rbac-matrix.yaml`
# is tagged `migration_status: pending` is permitted to keep its existing
# `requireAdmin` call until the migration task lands.
#
# Anything else — i.e. a NEW call site in a NEW route file, or a re-introduced
# call in a previously-migrated route — fails the script with non-zero exit.
#
# Usage:
#   scripts/check-no-new-requireAdmin.sh                 # check, exit non-zero on drift
#   STRICT=1 scripts/check-no-new-requireAdmin.sh        # also fail if pending allowlist is empty
#
# Wired into `make test-rbac-lint` (T032).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MATRIX="${REPO_ROOT}/tests/rbac/rbac-matrix.yaml"

if ! command -v rg >/dev/null 2>&1; then
  echo "[check-no-new-requireAdmin] ripgrep (rg) is required but not installed" >&2
  exit 2
fi

if [[ ! -f "${MATRIX}" ]]; then
  echo "[check-no-new-requireAdmin] matrix not found: ${MATRIX}" >&2
  exit 2
fi

cd "${REPO_ROOT}"

# 1) Pending allowlist — repo-relative route.ts paths that are allowed to keep
#    calling requireAdmin / requireAdminView until their migration task lands.
PENDING_TMP="$(mktemp)"
trap 'rm -f "${PENDING_TMP}" "${HITS_TMP:-}"' EXIT

python3 - <<'PYEOF' >"${PENDING_TMP}"
from pathlib import Path
import yaml
data = yaml.safe_load(Path("tests/rbac/rbac-matrix.yaml").read_text()) or {}
seen = set()
for r in data.get("routes", []) or []:
    if r.get("surface") != "ui_bff":
        continue
    if r.get("migration_status") != "pending":
        continue
    p = (r.get("path") or "").lstrip("/")
    if p:
        seen.add(f"ui/src/app/{p}/route.ts")
for s in sorted(seen):
    print(s)
PYEOF

PENDING_COUNT=$(wc -l <"${PENDING_TMP}" | tr -d ' ')

# 2) All route.ts files that import OR call the SHARED requireAdmin /
#    requireAdminView helpers from `@/lib/api-middleware`. We skip files that
#    only define a *local* `function requireAdmin(...)` helper — those need to
#    be migrated, but they're a different audit surface and are reported by
#    `make test-rbac-lint` directly via the matrix linter.
HITS_TMP="$(mktemp)"
( cd "${REPO_ROOT}" && \
  rg --files-with-matches --no-heading --no-line-number \
     --glob 'ui/src/app/api/**/route.ts' \
     -e "from ['\"]@/lib/api-middleware['\"]" \
     . \
   | sed 's|^\./||' \
   | sort -u \
   | while IFS= read -r f; do
       # Keep the file only if it imports requireAdmin* from api-middleware
       # and calls it from within a function body (not just declares its own).
       if rg -q -e '\brequireAdmin(View)?\b' "${f}" 2>/dev/null \
          && ! rg -q -e '^(async\s+)?function\s+requireAdmin' "${f}" 2>/dev/null; then
         echo "${f}"
       elif rg -q -e '\brequireAdmin(View)?\b' "${f}" 2>/dev/null \
          && rg -q -e 'requireAdmin\s*[,}]' "${f}" 2>/dev/null \
          && rg -q -e '^(async\s+)?function\s+requireAdmin' "${f}" 2>/dev/null; then
         # File both imports the shared helper AND defines a local one; flag it.
         echo "${f}"
       fi
     done ) >"${HITS_TMP}" || true

if [[ ! -s "${HITS_TMP}" ]]; then
  echo "[check-no-new-requireAdmin] OK — no route.ts files reference requireAdmin / requireAdminView"
  exit 0
fi

# 3) Diff: any hit not in the pending allowlist is a violation.
VIOLATIONS_TMP="$(mktemp)"
trap 'rm -f "${PENDING_TMP}" "${HITS_TMP}" "${VIOLATIONS_TMP}"' EXIT

# `comm -23` requires sorted inputs; PENDING_TMP is already sorted, HITS_TMP we sorted above.
comm -23 "${HITS_TMP}" "${PENDING_TMP}" >"${VIOLATIONS_TMP}"

VIOL_COUNT=$(wc -l <"${VIOLATIONS_TMP}" | tr -d ' ')
HIT_COUNT=$(wc -l <"${HITS_TMP}" | tr -d ' ')

if [[ "${VIOL_COUNT}" -gt 0 ]]; then
  echo "[check-no-new-requireAdmin] FAIL — ${VIOL_COUNT} route file(s) call deprecated requireAdmin/requireAdminView"
  echo "                            outside the pending-migration allowlist:"
  while IFS= read -r v; do
    [[ -z "${v}" ]] && continue
    line="$(rg -n -e '\brequireAdmin\b' -e '\brequireAdminView\b' "${v}" 2>/dev/null | head -1 || true)"
    echo "    ${v}    ${line}"
  done <"${VIOLATIONS_TMP}"
  echo ""
  echo "Fix: migrate the route to requireRbacPermission (see Spec 102 §Phase 3)"
  echo "     OR add a matrix entry with migration_status: pending if the migration is intentional"
  exit 1
fi

if [[ "${STRICT:-0}" == "1" && "${PENDING_COUNT}" -eq 0 && "${HIT_COUNT}" -gt 0 ]]; then
  echo "[check-no-new-requireAdmin] STRICT FAIL — pending allowlist is empty AND there are still requireAdmin call sites"
  exit 1
fi

echo "[check-no-new-requireAdmin] OK — ${HIT_COUNT} requireAdmin call site(s) found, all in pending allowlist (${PENDING_COUNT} entries)"
exit 0

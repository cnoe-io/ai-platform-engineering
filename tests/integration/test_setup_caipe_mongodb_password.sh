#!/usr/bin/env bash
# -------------------------------------------------------------------
# tests/integration/test_setup_caipe_mongodb_password.sh
#
# Unit test for the R2 randomization of the MongoDB root password
# inside setup-caipe.sh.
#
# _resolve_mongodb_password() keeps setup-caipe.sh idempotent without
# using a shared placeholder password. It:
#   (1) reads an existing password from the `caipe-mongodb-credentials`
#       Secret (so re-runs are idempotent), OR
#   (2) generates a fresh `openssl rand -hex 24` value, AND
#   (3) persists it in the `caipe-mongodb-credentials` Secret.
#
# This test isolates the helper from the rest of setup-caipe.sh by
# sourcing it directly with `__SETUP_CAIPE_SOURCE_ONLY__=1` and mocking
# kubectl on PATH. It then asserts:
#
#   * Pin 1 — first run with NO existing Secret → a fresh password is
#             generated, exported as $MONGODB_ROOT_PASSWORD, and
#             written to the Secret via `kubectl apply`.
#   * Pin 2 — second run WITH an existing Secret → the same password
#             is reused (idempotent re-run).
#   * Pin 3 — the generated password is exactly 48 hex chars (24 bytes
#             of entropy) and does NOT contain any of the URL-special
#             characters (`@`, `/`, `:`, `?`, `%`) that would break a
#             `mongodb://admin:<pw>@host:27017/db` connection string.
#   * Pin 4 — the password is NEVER the string "changeme" (regression
#             guard on R2 itself).
#
# Exits 0 on success, non-zero with a clear FAIL message otherwise.
#
# Usage:
#   ./tests/integration/test_setup_caipe_mongodb_password.sh
#
# assisted-by Claude:claude-opus-4-7
# -------------------------------------------------------------------

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
SETUP_SCRIPT="${REPO_ROOT}/setup-caipe.sh"

if [ ! -f "${SETUP_SCRIPT}" ]; then
  echo "FAIL: setup-caipe.sh not found at ${SETUP_SCRIPT}" >&2
  exit 2
fi

# Sandbox where the kubectl mock writes its "Secret store".
SANDBOX="$(mktemp -d /tmp/r2-test.XXXXXX)"
trap 'rm -rf "${SANDBOX}"' EXIT

# ---------------------------------------------------------------------
# kubectl mock — minimal, only handles the two calls _resolve_mongodb_password
# makes:
#   `kubectl get secret caipe-mongodb-credentials -n caipe -o jsonpath=…`
#   `kubectl apply -f -`            (consumes stdin)
#
# State is persisted under ${SANDBOX}/secret-store.txt — the mock
# writes the base64'd password there on apply, and reads it back on get.
# ---------------------------------------------------------------------
cat > "${SANDBOX}/kubectl" <<'KUBECTL_MOCK'
#!/usr/bin/env bash
set -uo pipefail
STORE="${MOCK_SECRET_STORE:-/tmp/r2-secret-store.txt}"
case "${1:-}" in
  get)
    # We only handle the `get secret caipe-mongodb-credentials` form.
    # Read the stored base64 from disk; emit empty string if not set.
    if [ -f "${STORE}" ]; then
      cat "${STORE}"
    fi
    exit 0
    ;;
  apply)
    # Consume the YAML on stdin and pull out the MONGODB_ROOT_PASSWORD
    # value. The YAML is built by `kubectl create secret generic --dry-run`
    # so the field is `MONGODB_ROOT_PASSWORD: <base64>` under `data:`.
    # We're not parsing YAML strictly — `grep` is enough for this shape.
    yaml=$(cat)
    pw_b64=$(printf '%s\n' "${yaml}" | grep '^  MONGODB_ROOT_PASSWORD:' | awk '{print $2}')
    # Sanity: refuse to write empty (catches a regression where the
    # helper forgets to actually generate a password).
    if [ -z "${pw_b64}" ]; then
      echo "kubectl-mock: refusing to apply Secret with empty MONGODB_ROOT_PASSWORD" >&2
      exit 1
    fi
    printf '%s' "${pw_b64}" > "${STORE}"
    exit 0
    ;;
  create)
    # `kubectl create secret generic … --dry-run=client -o yaml` is used
    # to build the Secret YAML that gets piped into `apply`. Just emit
    # the YAML it would produce — we hand-roll the relevant bits.
    pw_value=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --from-literal=MONGODB_ROOT_PASSWORD=*)
          # ##*= strips up to the LAST `=` (the `--from-literal=KEY=VALUE`
          # form has two of them); #*= would strip only the first and
          # store `KEY=VALUE`.
          pw_value="${1##*=}"
          ;;
      esac
      shift
    done
    if [ -z "${pw_value}" ]; then
      echo "kubectl-mock: --from-literal=MONGODB_ROOT_PASSWORD=… was missing" >&2
      exit 1
    fi
    # Build the minimal YAML that the real kubectl would produce. We
    # base64-encode the password ourselves so the apply step finds it
    # under `data:` exactly the way it would in production.
    pw_b64=$(printf '%s' "${pw_value}" | base64 | tr -d '\n')
    cat <<YAML
apiVersion: v1
kind: Secret
metadata:
  name: caipe-mongodb-credentials
  namespace: caipe
type: Opaque
data:
  MONGODB_ROOT_PASSWORD: ${pw_b64}
YAML
    exit 0
    ;;
  *)
    # Anything else (rollout, patch, etc.) is a no-op in this test.
    exit 0
    ;;
esac
KUBECTL_MOCK
chmod +x "${SANDBOX}/kubectl"

export MOCK_SECRET_STORE="${SANDBOX}/secret-store.txt"
export PATH="${SANDBOX}:${PATH}"

# ---------------------------------------------------------------------
# Source setup-caipe.sh in a way that exposes `_resolve_mongodb_password`
# without running the full installer. The script doesn't yet have an
# `__SETUP_CAIPE_SOURCE_ONLY__` guard, so we bypass `main` by extracting
# just the helper definition.
# ---------------------------------------------------------------------
# Extract _resolve_mongodb_password() definition + its dependency
# (`log` is the only function it calls); we redefine `log` to no-op
# stderr so the test output stays clean.
extract_helper() {
  awk '
    /^_resolve_mongodb_password\(\) \{/ { capture = 1 }
    capture { print }
    capture && /^\}$/ { capture = 0 }
  ' "${SETUP_SCRIPT}"
}

helper_src=$(extract_helper)
if [ -z "${helper_src}" ]; then
  echo "FAIL: could not extract _resolve_mongodb_password() from setup-caipe.sh" >&2
  echo "      Did the helper get renamed? Update this test." >&2
  exit 2
fi

# Define a no-op `log` so the helper's status messages don't pollute
# the test output, then drop in the extracted helper.
log() { :; }
eval "${helper_src}"

# ---------------------------------------------------------------------
# Pin 1 — first run: no existing Secret → fresh password generated.
# ---------------------------------------------------------------------
echo "[r2-test] Pin 1: first run with no existing Secret ..."
rm -f "${MOCK_SECRET_STORE}"
unset MONGODB_ROOT_PASSWORD
_resolve_mongodb_password

if [ -z "${MONGODB_ROOT_PASSWORD:-}" ]; then
  echo "[r2-test] FAIL: Pin 1 — MONGODB_ROOT_PASSWORD is empty after first run." >&2
  exit 1
fi

if [ ! -f "${MOCK_SECRET_STORE}" ]; then
  echo "[r2-test] FAIL: Pin 1 — kubectl apply was not called (Secret store not written)." >&2
  exit 1
fi

# Decode the stored base64 and confirm it matches the in-memory value.
stored_pw=$(cat "${MOCK_SECRET_STORE}" | base64 -d 2>/dev/null || true)
if [ "${stored_pw}" != "${MONGODB_ROOT_PASSWORD}" ]; then
  echo "[r2-test] FAIL: Pin 1 — stored Secret value (${stored_pw}) ≠ in-memory value (${MONGODB_ROOT_PASSWORD})." >&2
  exit 1
fi
first_run_pw="${MONGODB_ROOT_PASSWORD}"
echo "[r2-test]   OK: Pin 1 — fresh password generated and persisted."

# ---------------------------------------------------------------------
# Pin 2 — second run: existing Secret → same password reused.
# ---------------------------------------------------------------------
echo "[r2-test] Pin 2: second run reads the persisted Secret ..."
unset MONGODB_ROOT_PASSWORD
_resolve_mongodb_password

if [ "${MONGODB_ROOT_PASSWORD}" != "${first_run_pw}" ]; then
  echo "[r2-test] FAIL: Pin 2 — password changed between runs." >&2
  echo "         First run:  ${first_run_pw}" >&2
  echo "         Second run: ${MONGODB_ROOT_PASSWORD}" >&2
  echo "         R2 promises idempotent re-runs. Did the helper stop reading the Secret?" >&2
  exit 1
fi
echo "[r2-test]   OK: Pin 2 — re-run reused the persisted password."

# ---------------------------------------------------------------------
# Pin 3 — password shape: 48 hex chars, no URL-special characters.
# ---------------------------------------------------------------------
echo "[r2-test] Pin 3: password shape (hex, URL-safe) ..."
# `openssl rand -hex 24` → exactly 48 hex chars (0-9, a-f).
if ! printf '%s' "${first_run_pw}" | grep -qE '^[0-9a-f]{48}$'; then
  echo "[r2-test] FAIL: Pin 3 — password is not 48 hex chars (got ${#first_run_pw} chars: ${first_run_pw})." >&2
  echo "         If the helper switched generators (e.g. to base64), the MONGODB_URI" >&2
  echo "         connection string format may break: '@', '/', ':', '?' all need URL-encoding." >&2
  exit 1
fi

# Spot-check for URL-special characters that would corrupt the URI even
# inside the hex set's range (none should match, but pin it).
if printf '%s' "${first_run_pw}" | grep -q '[@:/?%]'; then
  echo "[r2-test] FAIL: Pin 3 — password contains URL-special characters." >&2
  exit 1
fi
echo "[r2-test]   OK: Pin 3 — password is 48-char hex, URL-safe."

# ---------------------------------------------------------------------
# Pin 4 — regression guard: password is NEVER "changeme".
# ---------------------------------------------------------------------
echo "[r2-test] Pin 4: password is not the legacy 'changeme' placeholder ..."
if [ "${first_run_pw}" = "changeme" ]; then
  echo "[r2-test] FAIL: Pin 4 — password is 'changeme'. R2 randomization broke." >&2
  exit 1
fi
echo "[r2-test]   OK: Pin 4 — password is randomized."

# ---------------------------------------------------------------------
# Pin 5 — regression guard: 'changeme' does not appear in setup-caipe.sh
# outside of comments documenting the prior behavior.
# ---------------------------------------------------------------------
echo "[r2-test] Pin 5: 'changeme' literal does not appear in active code ..."
# Strip comment lines and check for any remaining 'changeme'.
active_changeme=$(grep -v '^[[:space:]]*#' "${SETUP_SCRIPT}" | grep -c 'changeme' || true)
if [ "${active_changeme}" -gt 0 ]; then
  echo "[r2-test] FAIL: Pin 5 — 'changeme' still appears in non-comment lines of setup-caipe.sh." >&2
  echo "         Active occurrences:" >&2
  grep -nv '^[[:space:]]*#' "${SETUP_SCRIPT}" | grep 'changeme' | head -5 | sed 's/^/    /' >&2
  exit 1
fi
echo "[r2-test]   OK: Pin 5 — no active 'changeme' references remain."

echo ""
echo "[r2-test] PASS — all 5 pins green."
exit 0

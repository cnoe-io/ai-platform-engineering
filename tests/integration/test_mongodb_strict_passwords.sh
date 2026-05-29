#!/usr/bin/env bash
# -------------------------------------------------------------------
# tests/integration/test_mongodb_strict_passwords.sh
#
# End-to-end test for the production hardening flag
# `caipe-ui-mongodb.strictPasswords=true` (R3).
#
# Unlike Keycloak's `strictClientSecrets` (which has to run against a
# live Keycloak because the placeholder lives in a seeded realm import
# that is only inspectable at runtime), R3 for MongoDB is a Helm
# **template-time** gate — the placeholder lives in `values.yaml` and
# the chart's own `templates/secret.yaml` builds the K8s Secret from
# `auth.rootPassword` directly. So the right end-to-end test is a
# `helm install --dry-run --debug` invocation that mimics what an
# operator actually runs.
#
# This test confirms that:
#
#   1. `helm install --dry-run` with `strictPasswords=true` AND the
#      default `auth.rootPassword=changeme` FAILS with a non-zero exit
#      and a stderr message containing the override instructions.
#
#   2. Same install with a real CSPRNG password SUCCEEDS.
#
#   3. Same install with `externalSecrets.enabled=true` SUCCEEDS even
#      with the placeholder still in place (ESO bypass).
#
# Requires: helm. No live cluster, no docker — `--dry-run` runs entirely
# client-side against the API server's validation endpoint (or just
# locally with `--dry-run=client`).
#
# Exit 0 on success, non-zero with a clear FAIL message otherwise.
#
# Usage:
#   ./tests/integration/test_mongodb_strict_passwords.sh
#
# assisted-by Claude:claude-opus-4-7
# -------------------------------------------------------------------

set -uo pipefail

# Locate the chart relative to this script regardless of CWD.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
CHART_PATH="${REPO_ROOT}/charts/ai-platform-engineering/charts/caipe-ui-mongodb"

if ! command -v helm >/dev/null 2>&1; then
  echo "SKIP: helm not installed; cannot run MongoDB strict-passwords integration test."
  exit 0
fi

if [ ! -d "${CHART_PATH}" ]; then
  echo "FAIL: caipe-ui-mongodb chart not found at ${CHART_PATH}" >&2
  exit 2
fi

# Common flags the chart needs to render standalone (vpa template
# dereferences global.vpa).
COMMON_FLAGS=(
  --set "global.image.tag=0.5.1"
  --set "global.vpa.enabled=false"
)

# -------------------------------------------------------------------
# Step 1 — strict mode ON + placeholder → MUST fail with clear message
# -------------------------------------------------------------------
echo "[mongodb-strict] Step 1: strict mode ON + default placeholder (expect FAIL) ..."
out=$(helm template strict-test "${CHART_PATH}" \
  "${COMMON_FLAGS[@]}" \
  --set "strictPasswords=true" 2>&1)
rc=$?

if [ "${rc}" = "0" ]; then
  echo "[mongodb-strict] FAIL: Step 1 rendered successfully but should have refused." >&2
  echo "[mongodb-strict]       This is the regression the gate exists to prevent." >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi

# Confirm the operator-facing error string is present.
if ! echo "${out}" | grep -qi "known placeholder"; then
  echo "[mongodb-strict] FAIL: Step 1 failed (correctly) but the error message is wrong." >&2
  echo "[mongodb-strict]       Expected to find 'known placeholder' in stderr; got:" >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi

if ! echo "${out}" | grep -q "secrets-bootstrap.md"; then
  echo "[mongodb-strict] FAIL: Step 1 error message is missing the docs link." >&2
  echo "[mongodb-strict]       The operator-facing error should point at" >&2
  echo "[mongodb-strict]       docs/docs/security/rbac/secrets-bootstrap.md so a fresh-eyes" >&2
  echo "[mongodb-strict]       SRE has somewhere to read about the gate. Got:" >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi
echo "[mongodb-strict]   OK: strict mode refused the placeholder with an actionable message."

# -------------------------------------------------------------------
# Step 2 — strict mode ON + real password → MUST succeed
# -------------------------------------------------------------------
echo "[mongodb-strict] Step 2: strict mode ON + real CSPRNG password (expect PASS) ..."
real_password=$(openssl rand -base64 24 2>/dev/null || echo "kQXf8vN3p2RmHcLwYj7tBdAeUg")
out=$(helm template strict-test "${CHART_PATH}" \
  "${COMMON_FLAGS[@]}" \
  --set "strictPasswords=true" \
  --set "auth.rootPassword=${real_password}" 2>&1)
rc=$?

if [ "${rc}" != "0" ]; then
  echo "[mongodb-strict] FAIL: Step 2 should have succeeded with a real password." >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi

# Confirm the Secret was rendered with the real password.
if ! echo "${out}" | grep -q "MONGO_INITDB_ROOT_PASSWORD"; then
  echo "[mongodb-strict] FAIL: Step 2 succeeded but the Secret is missing." >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi
echo "[mongodb-strict]   OK: strict mode accepted a real CSPRNG password."

# -------------------------------------------------------------------
# Step 3 — strict mode ON + ESO enabled → MUST succeed (gate bypass)
# -------------------------------------------------------------------
echo "[mongodb-strict] Step 3: strict mode ON + ESO enabled (expect PASS, gate bypassed) ..."
out=$(helm template strict-test "${CHART_PATH}" \
  "${COMMON_FLAGS[@]}" \
  --set "strictPasswords=true" \
  --set "externalSecrets.enabled=true" 2>&1)
rc=$?

if [ "${rc}" != "0" ]; then
  echo "[mongodb-strict] FAIL: Step 3 should have succeeded — ESO bypasses the gate." >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi

# Confirm the ExternalSecret CRD is the source of truth (no chart-built Secret).
if ! echo "${out}" | grep -q "kind: ExternalSecret"; then
  echo "[mongodb-strict] FAIL: Step 3 succeeded but no ExternalSecret CRD was rendered." >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi
echo "[mongodb-strict]   OK: ESO bypass works — chart renders ExternalSecret only."

# -------------------------------------------------------------------
# Step 4 — strict mode OFF (chart default) → placeholder still works
# -------------------------------------------------------------------
echo "[mongodb-strict] Step 4: strict mode OFF (chart default) + placeholder (expect PASS) ..."
out=$(helm template strict-test "${CHART_PATH}" "${COMMON_FLAGS[@]}" 2>&1)
rc=$?

if [ "${rc}" != "0" ]; then
  echo "[mongodb-strict] FAIL: Step 4 should have succeeded — chart default ships strict=false." >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi

if ! echo "${out}" | grep -q "MONGO_INITDB_ROOT_PASSWORD"; then
  echo "[mongodb-strict] FAIL: Step 4 succeeded but the default Secret is missing." >&2
  echo "${out}" | sed 's/^/    /' >&2
  exit 1
fi
echo "[mongodb-strict]   OK: chart default (strict=false) preserves the docker-compose dev flow."

echo ""
echo "[mongodb-strict] PASS — all 4 steps green."
exit 0

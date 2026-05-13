#!/usr/bin/env bash
# Reconcile Keycloak realm state from MongoDB after a Keycloak data loss.
#
# Walks every team in MongoDB and, for each one:
#   1. Ensures the per-team client scope `team-<slug>` exists (delegates to
#      the BFF startup auto-sync — restart caipe-ui first; this script just
#      verifies).
#   2. Ensures the `team_member:<slug>` realm role exists (slug-keyed to
#      match the signed `active_team` claim and OpenFGA team tuples).
#   3. For each member email, looks up the Keycloak user; if found, assigns
#      the team_member realm role. Members who have not yet logged in via
#      SSO are listed at the end as "needs SSO login" — they will get their
#      role automatically the next time you re-run this script after they
#      log in.
#
# Why this exists: Keycloak's embedded H2 DB (the default in dev) wipes on
# every container recreate. MongoDB still has the team/membership truth, so
# this script makes Keycloak agree with Mongo. With docker-compose.dev.yaml's
# new `keycloak-postgres` durable backend this is rarely needed, but is the
# canonical recovery path after `docker compose down -v` or a manual KC
# restore.
#
# Usage:
#   scripts/reconcile-keycloak-from-mongo.sh          # uses defaults below
#   KC_URL=http://localhost:7080 \
#   KC_REALM=caipe \
#   KC_ADMIN=admin KC_ADMIN_PASSWORD=admin \
#   MONGO_CONTAINER=caipe-mongodb-dev \
#   MONGO_URI="mongodb://admin:changeme@localhost:27017/caipe?authSource=admin" \
#     scripts/reconcile-keycloak-from-mongo.sh

set -euo pipefail

KC_URL="${KC_URL:-http://localhost:7080}"
KC_REALM="${KC_REALM:-caipe}"
KC_ADMIN="${KC_ADMIN:-admin}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-admin}"
MONGO_CONTAINER="${MONGO_CONTAINER:-caipe-mongodb-dev}"
MONGO_URI="${MONGO_URI:-mongodb://admin:changeme@localhost:27017/caipe?authSource=admin}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; }
err()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; }

bold "[1/4] Acquiring Keycloak admin token"
ADMIN_TOKEN=$(
  curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -d "client_id=admin-cli" \
    -d "username=${KC_ADMIN}" \
    -d "password=${KC_ADMIN_PASSWORD}" \
    -d "grant_type=password" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])'
)
ok "got admin token"

KC_ADMIN_BASE="${KC_URL}/admin/realms/${KC_REALM}"
H_AUTH="Authorization: Bearer ${ADMIN_TOKEN}"
H_JSON="Content-Type: application/json"

bold "[2/4] Listing teams in MongoDB"
TEAMS_JSON=$(
  docker exec "${MONGO_CONTAINER}" mongosh "${MONGO_URI}" --quiet --eval '
    JSON.stringify(db.teams.find({}, {_id:1,name:1,slug:1,members:1}).toArray())
  '
)

NUM_TEAMS=$(echo "${TEAMS_JSON}" | python3 -c 'import sys, json; print(len(json.load(sys.stdin)))')
info "found ${NUM_TEAMS} team(s) in Mongo"

bold "[3/4] Reconciling realm roles + assignments"

# Use python to drive the per-team work — easier JSON handling than bash.
# Heredoc is quoted ('PY') so bash does NOT interpret < > $ inside; we pass
# the variables in via the environment instead.
TEAMS_JSON="${TEAMS_JSON}" KC_ADMIN_BASE="${KC_ADMIN_BASE}" ADMIN_TOKEN="${ADMIN_TOKEN}" python3 - <<'PY'
import json
import os
import subprocess
import sys
import urllib.parse

teams = json.loads(os.environ["TEAMS_JSON"])
kc_base = os.environ["KC_ADMIN_BASE"]
token = os.environ["ADMIN_TOKEN"]
auth_header = f"Authorization: Bearer {token}"

def curl(method, path, body=None, expect_codes=(200, 201, 204, 409)):
    cmd = [
        "curl", "-sS", "-o", "/tmp/_curl_out", "-w", "%{http_code}",
        "-X", method, "-H", auth_header,
    ]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", body]
    cmd.append(f"{kc_base}{path}")
    code = subprocess.check_output(cmd, text=True).strip()
    with open("/tmp/_curl_out") as f:
        out = f.read()
    if int(code) not in expect_codes:
        raise RuntimeError(f"{method} {path} -> {code}: {out[:300]}")
    return code, out

needs_login = []  # list of (team_name, email) waiting for SSO

# --- Migration step: rename any legacy team_member:<ObjectId> roles to
#     team_member:<slug>. The previous BFF + reconcile script keyed roles
#     on the Mongo ObjectId, but AgentGateway's CEL evaluates
#     `team_member:<jwt.active_team>` where `active_team` is the slug.
#     A Keycloak role rename via PUT preserves the role's UUID and all
#     existing user assignments — no re-add needed.
print("\n  --- Migrating legacy team_member:<ObjectId> roles to team_member:<slug> ---")
for t in teams:
    tid = t["_id"]["$oid"] if isinstance(t.get("_id"), dict) else str(t["_id"])
    slug = (t.get("slug") or "").strip()
    if not slug:
        continue
    legacy_name = f"team_member:{tid}"
    correct_name = f"team_member:{slug}"
    if legacy_name == correct_name:
        continue
    enc_legacy = urllib.parse.quote(legacy_name, safe="")
    code, body = curl("GET", f"/roles/{enc_legacy}", expect_codes=(200, 404))
    if code == "404":
        continue
    # The legacy role exists. Rename only if the correct one isn't already
    # present (otherwise a rename would 409 with "Role already exists").
    enc_correct = urllib.parse.quote(correct_name, safe="")
    cc, _ = curl("GET", f"/roles/{enc_correct}", expect_codes=(200, 404))
    if cc == "200":
        print(f"    ! both {legacy_name} and {correct_name} exist — leaving legacy role in place (manual review)")
        continue
    role_obj = json.loads(body)
    role_obj["name"] = correct_name
    role_obj["description"] = f'Team member role for team "{slug}"'
    curl("PUT", f"/roles/{enc_legacy}", body=json.dumps(role_obj), expect_codes=(204,))
    print(f"    + renamed {legacy_name} -> {correct_name} (assignments preserved)")

for t in teams:
    tid = t["_id"]["$oid"] if isinstance(t.get("_id"), dict) else str(t["_id"])
    name = t.get("name", "(unnamed)")
    slug = (t.get("slug") or "").strip()
    members = t.get("members", []) or []

    print(f"\n  === Team: {name}  slug={slug}  id={tid}  members={len(members)} ===")

    if not slug:
        print(f"    ! team {tid} has no slug — skipping (run BFF startup auto-sync to backfill)")
        continue

    # Slug-keyed to match the signed active_team claim and OpenFGA team tuples.
    role_name = f"team_member:{slug}"
    enc = urllib.parse.quote(role_name, safe="")

    # Ensure role
    code, _ = curl("GET", f"/roles/{enc}", expect_codes=(200, 404))
    if code == "404":
        body = json.dumps({"name": role_name, "description": f'Team member role for team "{slug}"'})
        curl("POST", "/roles", body=body, expect_codes=(201, 409))
        print(f"    + created role {role_name}")
    else:
        print(f"    = role {role_name} already exists")

    # Refetch role object (need its id for assignment)
    _, role_body = curl("GET", f"/roles/{enc}")
    role_obj = json.loads(role_body)

    # For each member, look up user and assign
    seen = set()
    for m in members:
        email = (m.get("user_id") or "").lower()
        if not email or email in seen:
            continue
        seen.add(email)
        enc_email = urllib.parse.quote(email, safe="")
        _, ub = curl("GET", f"/users?email={enc_email}&exact=true&max=1")
        users = json.loads(ub)
        if not users:
            print(f"    ? {email}: not in Keycloak (needs SSO login)")
            needs_login.append((name, email))
            continue
        uid = users[0]["id"]
        body = json.dumps([role_obj])
        curl("POST", f"/users/{uid}/role-mappings/realm", body=body, expect_codes=(204,))
        print(f"    + {email} ({uid[:8]}…) assigned {role_name}")

print("\n=== Reconcile complete ===")
if needs_login:
    print("\nUsers who must log in via SSO before they will receive their team_member role:")
    for team_name, email in needs_login:
        print(f"  - {email} (team: {team_name})")
    print("\nAfter they log in once, re-run this script to finish the assignment.")
PY

bold "[4/4] Done"
info "Tip: also run 'make rbac-reinit' to re-apply the BOOTSTRAP_ADMIN_EMAILS bundle"
info "(admin_user, tool_user:*, agent_user:test-april-2025, etc.) for any newly-logged-in admins."

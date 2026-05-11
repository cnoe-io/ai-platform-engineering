#!/usr/bin/env bash
# Ship Loop mock-webhook flow.
#
# Drives a complete Epic -> sub-task -> PR -> review -> merge -> deploy
# scenario against a locally-running dev server with the mock repo
# pre-seeded by `npm run ship-loop:seed-mock-repo`. Each step is a
# separate signed POST to /api/ship-loop/webhooks/github so the
# operator can pause between steps and watch the per-Epic page
# update live (Pipeline / Kanban / Timeline views).
#
# Pre-flight (do these once):
#   1. Set SHIP_LOOP_ENABLED=true and SHIP_LOOP_ALLOW_NO_AUTH=true
#      in ui/.env.local.
#   2. Add GITHUB_WEBHOOK_SECRET=ship-loop-mock-secret (or whatever
#      the seed script printed) to ui/.env.local.
#   3. Restart the Next.js dev server so the env vars take effect.
#   4. Run `npm run ship-loop:create-indexes` and
#      `npm run ship-loop:seed-mock-repo` from the ui/ directory.
#
# Open the per-Epic page in your browser BEFORE running this:
#   http://localhost:3000/ship-loop/demoorg/agentic-demo/epics/I_42
#
# Then run this script and watch each step land in real time.

set -uo pipefail

BASE="${SHIP_LOOP_BASE:-http://localhost:3000}"
SECRET="${GITHUB_WEBHOOK_SECRET:-ship-loop-mock-secret}"
REPO_ID="${SHIP_LOOP_MOCK_REPO_ID:-99000001}"
FULL_NAME="${SHIP_LOOP_MOCK_FULL_NAME:-demoorg/agentic-demo}"
EPIC_ID="${SHIP_LOOP_MOCK_EPIC_ID:-I_42}"
SUBTASK_ID="${SHIP_LOOP_MOCK_SUBTASK_ID:-T_a}"
PR_NODE_ID="${SHIP_LOOP_MOCK_PR_ID:-PR_1}"
DEPLOY_ID="${SHIP_LOOP_MOCK_DEPLOY_ID:-D_1}"
PAUSE="${SHIP_LOOP_MOCK_PAUSE_S:-2}"

# --- helpers -----------------------------------------------------------------

reset='\033[0m'
cyan='\033[1;36m'
green='\033[32m'
red='\033[31m'
yellow='\033[33m'
dim='\033[2m'

step()    { printf "\n${cyan}== %s ==${reset}\n" "$1"; }
note()    { printf "${dim}   %s${reset}\n" "$1"; }
ok()      { printf "   ${green}OK${reset}    %s (got %s)\n" "$1" "$2"; }
fail()    { printf "   ${red}FAIL${reset}  %s (expected %s, got %s)\n" "$1" "$2" "$3"; FAILED=1; }

FAILED=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then ok "$desc" "$actual"; else fail "$desc" "$expected" "$actual"; fi
}

# Sign without trailing newlines. printf '%s' is the only portable
# way to do this in bash; here-strings (`<<<`) silently append a \n
# and break HMAC verification on every payload.
sign() {
  python3 -c '
import hmac, hashlib, sys
secret = sys.argv[1].encode()
body = sys.stdin.buffer.read()
print(hmac.new(secret, body, hashlib.sha256).hexdigest())
' "$SECRET" < <(printf '%s' "$1")
}

post_webhook() {
  local event="$1" delivery="$2" body="$3"
  local sig
  sig="sha256=$(sign "$body")"
  curl -s -o /dev/null -m 8 -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: $event" \
    -H "X-GitHub-Delivery: $delivery" \
    -H "X-Hub-Signature-256: $sig" \
    -d "$body" \
    "$BASE/api/ship-loop/webhooks/github"
}

uniq_id() { echo "mock-$(date +%s%N)-$$-$RANDOM"; }

# --- 0. liveness & repo presence --------------------------------------------

step "0. dev server liveness + mock repo seeded"
HEALTH=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$BASE/api/health" || echo "000")
check "GET /api/health" "200" "$HEALTH"

EPICS_LIST_CODE=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$BASE/api/ship-loop/repos/${FULL_NAME%/*}/${FULL_NAME##*/}/epics" || echo "000")
case "$EPICS_LIST_CODE" in
  200) note "repos/$FULL_NAME/epics returns 200 (no-auth bypass active, repo onboarded)" ;;
  401) printf "${red}\n   Server returned 401 -- SHIP_LOOP_ALLOW_NO_AUTH is not set.${reset}\n   Add SHIP_LOOP_ALLOW_NO_AUTH=true to ui/.env.local and restart the dev server.\n"; exit 2 ;;
  404) printf "${red}\n   Server returned 404 -- repo $FULL_NAME is not onboarded.${reset}\n   Run \`npm run ship-loop:seed-mock-repo\` from the ui/ directory.\n"; exit 2 ;;
  *)   printf "${red}\n   Unexpected status $EPICS_LIST_CODE for /api/ship-loop/repos/.../epics.${reset}\n"; exit 2 ;;
esac

note "Open this in your browser, then watch it light up:"
note "  ${BASE}/ship-loop/${FULL_NAME%/*}/${FULL_NAME##*/}/epics/${EPIC_ID}"
sleep 1

# --- 1. Epic created ---------------------------------------------------------

step "1. Epic opened (issues.opened, label=epic + agent:specify)"
BODY=$(cat <<JSON
{
  "action": "opened",
  "repository": { "id": $REPO_ID, "full_name": "$FULL_NAME" },
  "issue": {
    "node_id": "$EPIC_ID",
    "number": 42,
    "title": "Add OAuth device flow",
    "body": "Spec lives in docs/specs/.\n\nLabels: epic, agent:specify",
    "state": "open",
    "user": { "login": "alice", "type": "User" },
    "assignees": [{ "login": "alice" }],
    "labels": [{ "name": "epic" }, { "name": "agent:specify" }],
    "html_url": "https://github.com/$FULL_NAME/issues/42",
    "updated_at": "2026-05-05T12:00:00Z"
  },
  "sender": { "login": "alice", "type": "User" }
}
JSON
)
CODE=$(post_webhook issues "$(uniq_id)" "$BODY")
check "Epic opened webhook" "202" "$CODE"
sleep "$PAUSE"

# --- 2. Stage transition: agent moves Epic into "plan" ----------------------

step "2. Epic moved to plan (issues.labeled with agent:plan)"
BODY=$(cat <<JSON
{
  "action": "labeled",
  "repository": { "id": $REPO_ID, "full_name": "$FULL_NAME" },
  "issue": {
    "node_id": "$EPIC_ID",
    "number": 42,
    "title": "Add OAuth device flow",
    "body": "Spec lives in docs/specs/.",
    "state": "open",
    "user": { "login": "alice", "type": "User" },
    "assignees": [{ "login": "alice" }],
    "labels": [{ "name": "epic" }, { "name": "agent:plan" }],
    "html_url": "https://github.com/$FULL_NAME/issues/42",
    "updated_at": "2026-05-05T12:05:00Z"
  },
  "label": { "name": "agent:plan" },
  "sender": { "login": "agent-bot", "type": "Bot" }
}
JSON
)
CODE=$(post_webhook issues "$(uniq_id)" "$BODY")
check "Epic labeled agent:plan" "202" "$CODE"
sleep "$PAUSE"

# --- 3. Sub-task created with epic: link ------------------------------------

step "3. Sub-task created (issues.opened, label=epic:$EPIC_ID + agent:implement)"
BODY=$(cat <<JSON
{
  "action": "opened",
  "repository": { "id": $REPO_ID, "full_name": "$FULL_NAME" },
  "issue": {
    "node_id": "$SUBTASK_ID",
    "number": 101,
    "title": "Wire device-code endpoint",
    "body": "Implements step 1.\n\nParent-Epic: $EPIC_ID",
    "state": "open",
    "user": { "login": "agent-bot", "type": "Bot" },
    "assignees": [{ "login": "agent-bot" }],
    "labels": [{ "name": "epic:$EPIC_ID" }, { "name": "agent:implement" }],
    "html_url": "https://github.com/$FULL_NAME/issues/101",
    "updated_at": "2026-05-05T12:10:00Z"
  },
  "sender": { "login": "agent-bot", "type": "Bot" }
}
JSON
)
CODE=$(post_webhook issues "$(uniq_id)" "$BODY")
check "Sub-task opened" "202" "$CODE"
sleep "$PAUSE"

# --- 4. PR opened with epic: label and a reviewer (review_hitl) -------------

step "4. PR opened (pull_request.opened, label=epic:$EPIC_ID + reviewer)"
BODY=$(cat <<JSON
{
  "action": "opened",
  "repository": { "id": $REPO_ID, "full_name": "$FULL_NAME" },
  "pull_request": {
    "node_id": "$PR_NODE_ID",
    "number": 7,
    "title": "feat(auth): device-code endpoint",
    "body": "Implements sub-task #101.\n\nParent-Epic: $EPIC_ID",
    "state": "open",
    "merged": false,
    "draft": false,
    "user": { "login": "agent-bot", "type": "Bot" },
    "assignees": [],
    "requested_reviewers": [{ "login": "alice" }],
    "labels": [{ "name": "epic:$EPIC_ID" }, { "name": "agent:awaiting-review" }],
    "html_url": "https://github.com/$FULL_NAME/pull/7",
    "head": { "ref": "feat/device-code", "sha": "deadbeef1" },
    "base": { "ref": "main" },
    "updated_at": "2026-05-05T12:20:00Z"
  },
  "sender": { "login": "agent-bot", "type": "Bot" }
}
JSON
)
CODE=$(post_webhook pull_request "$(uniq_id)" "$BODY")
check "PR opened" "202" "$CODE"
sleep "$PAUSE"

# --- 5. Human approves PR ---------------------------------------------------

step "5. Reviewer approves (pull_request_review.submitted, state=approved)"
BODY=$(cat <<JSON
{
  "action": "submitted",
  "repository": { "id": $REPO_ID, "full_name": "$FULL_NAME" },
  "pull_request": {
    "node_id": "$PR_NODE_ID",
    "number": 7,
    "title": "feat(auth): device-code endpoint",
    "body": "Implements sub-task #101.\n\nParent-Epic: $EPIC_ID",
    "state": "open",
    "merged": false,
    "labels": [{ "name": "epic:$EPIC_ID" }, { "name": "agent:awaiting-review" }],
    "html_url": "https://github.com/$FULL_NAME/pull/7"
  },
  "review": {
    "state": "approved",
    "user": { "login": "alice", "type": "User" },
    "submitted_at": "2026-05-05T12:30:00Z"
  },
  "sender": { "login": "alice", "type": "User" }
}
JSON
)
CODE=$(post_webhook pull_request_review "$(uniq_id)" "$BODY")
check "PR approved" "202" "$CODE"
sleep "$PAUSE"

# --- 6. PR merged -----------------------------------------------------------

step "6. PR merged (pull_request.closed with merged=true)"
BODY=$(cat <<JSON
{
  "action": "closed",
  "repository": { "id": $REPO_ID, "full_name": "$FULL_NAME" },
  "pull_request": {
    "node_id": "$PR_NODE_ID",
    "number": 7,
    "title": "feat(auth): device-code endpoint",
    "body": "Implements sub-task #101.\n\nParent-Epic: $EPIC_ID",
    "state": "closed",
    "merged": true,
    "merged_at": "2026-05-05T12:35:00Z",
    "user": { "login": "agent-bot", "type": "Bot" },
    "assignees": [],
    "requested_reviewers": [],
    "labels": [{ "name": "epic:$EPIC_ID" }],
    "html_url": "https://github.com/$FULL_NAME/pull/7",
    "head": { "ref": "feat/device-code", "sha": "deadbeef1" },
    "base": { "ref": "main" },
    "updated_at": "2026-05-05T12:35:00Z"
  },
  "sender": { "login": "alice", "type": "User" }
}
JSON
)
CODE=$(post_webhook pull_request "$(uniq_id)" "$BODY")
check "PR merged" "202" "$CODE"
sleep "$PAUSE"

# --- 7. Deployment status: in_progress --------------------------------------

step "7. Deployment in progress (deployment_status.created, state=in_progress)"
BODY=$(cat <<JSON
{
  "action": "created",
  "repository": { "id": $REPO_ID, "full_name": "$FULL_NAME" },
  "deployment": {
    "node_id": "$DEPLOY_ID",
    "id": 9001,
    "environment": "sandbox-eks",
    "ref": "main",
    "sha": "deadbeef1",
    "payload": { "epic_id": "$EPIC_ID" },
    "creator": { "login": "agent-bot", "type": "Bot" },
    "html_url": "https://github.com/$FULL_NAME/deployments/9001"
  },
  "deployment_status": {
    "state": "in_progress",
    "description": "Rolling out to sandbox-eks",
    "updated_at": "2026-05-05T12:36:00Z"
  },
  "sender": { "login": "agent-bot", "type": "Bot" }
}
JSON
)
CODE=$(post_webhook deployment_status "$(uniq_id)" "$BODY")
check "Deploy in_progress" "202" "$CODE"
sleep "$PAUSE"

# --- 8. Deployment status: success ------------------------------------------

step "8. Deployment success (deployment_status.created, state=success)"
BODY=$(cat <<JSON
{
  "action": "created",
  "repository": { "id": $REPO_ID, "full_name": "$FULL_NAME" },
  "deployment": {
    "node_id": "$DEPLOY_ID",
    "id": 9001,
    "environment": "sandbox-eks",
    "ref": "main",
    "sha": "deadbeef1",
    "payload": { "epic_id": "$EPIC_ID" },
    "creator": { "login": "agent-bot", "type": "Bot" },
    "html_url": "https://github.com/$FULL_NAME/deployments/9001"
  },
  "deployment_status": {
    "state": "success",
    "description": "Healthy in sandbox-eks",
    "updated_at": "2026-05-05T12:38:00Z"
  },
  "sender": { "login": "agent-bot", "type": "Bot" }
}
JSON
)
CODE=$(post_webhook deployment_status "$(uniq_id)" "$BODY")
check "Deploy success" "202" "$CODE"
sleep "$PAUSE"

# --- 9. Final state via the API ---------------------------------------------

step "9. Verify final Epic state via GET /epics/$EPIC_ID"
DETAIL_URL="$BASE/api/ship-loop/repos/${FULL_NAME%/*}/${FULL_NAME##*/}/epics/$EPIC_ID"
DETAIL=$(curl -s -m 8 "$DETAIL_URL" || echo "{}")
SUBTASK_COUNT=$(printf '%s' "$DETAIL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("subtasks", [])))' 2>/dev/null || echo "?")
PR_COUNT=$(printf '%s' "$DETAIL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("pull_requests", [])))' 2>/dev/null || echo "?")
DEPLOY_COUNT=$(printf '%s' "$DETAIL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("deploys", [])))' 2>/dev/null || echo "?")
EVENTS_COUNT=$(printf '%s' "$DETAIL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("recent_events", [])))' 2>/dev/null || echo "?")

check "Epic has 1 sub-task" "1" "$SUBTASK_COUNT"
check "Epic has 1 PR" "1" "$PR_COUNT"
check "Epic has 1 deploy" "1" "$DEPLOY_COUNT"
note "recent_events: $EVENTS_COUNT"

# --- summary -----------------------------------------------------------------

printf "\n${cyan}== Summary ==${reset}\n"
if [[ $FAILED -eq 0 ]]; then
  printf "   ${green}All steps OK.${reset} Browser should now show:\n"
  printf "     - Pipeline view: cards across specify/plan/implement/merge/deploy\n"
  printf "     - Kanban view: deploy lane has the new deploy\n"
  printf "     - Timeline view: 8 newest events\n"
else
  printf "   ${red}One or more steps failed.${reset} Re-read the output above.\n"
  printf "   Common causes:\n"
  printf "     - GITHUB_WEBHOOK_SECRET in ui/.env.local does NOT match the seed-script secret\n"
  printf "     - SHIP_LOOP_ALLOW_NO_AUTH=true is not set, so the GET API path returns 401\n"
  printf "     - Mock repo was deleted; re-run npm run ship-loop:seed-mock-repo\n"
fi
exit $FAILED

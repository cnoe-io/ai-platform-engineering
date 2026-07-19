#!/usr/bin/env bash
# tests/rbac/end_to_end/test_webex_1to1.sh — T181
#
# Webex equivalent of test_slack_dm.sh — same FR-023 / FR-029 / FR-029a
# dispatch chain in a Webex 1:1 (direct) room.
#
# Pins mirror the Slack script. The data-layer pins (1, 2, 4, 5, 10) are
# identical because the BFF preferences API is shared. The Webex-specific
# pieces are in the manual checkpoints (3, 6, 7, 8, 9, 11).
#
# assisted-by Claude:claude-opus-4-7

set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

: "${TEST_AGENT_ID:?TEST_AGENT_ID must be set}"
: "${TEST_OVERRIDE_AGENT_ID:?TEST_OVERRIDE_AGENT_ID must be set}"

wait_for_bff

# Pin 1
_log "Pin 1 — clearing any pre-existing DM preference"
clear_body=$(_curl /api/user/preferences -X PUT -d '{"webex_default_agent_id": null}')
assert_jq_eq "Pin 1" "$clear_body" '.data.webex_default_agent_id' "null"

# Pin 2
_log "Pin 2 — GET preferences after clear"
get_body=$(_curl /api/user/preferences)
agent=$(jq -r '.data.webex_default_agent_id // "null"' <<<"$get_body")
if [[ "$agent" == "null" ]]; then
  _pass "Pin 2: webex_default_agent_id null after clear"
else
  _fail "Pin 2: expected null, got $agent"
fi

cat <<EOF
  [MANUAL CHECKPOINT 3] In Webex, message the bot in your 1:1 DM:
      "hello"
  Expected: reply from the deployment default agent
  (WEBEX_INTEGRATION_DM_AGENT_ID, falling back to WEBEX_INTEGRATION_DEFAULT_AGENT_ID).
  Press <Enter> when verified.
EOF
read -r _

# Pin 4
_log "Pin 4 — PUT saved preference to ${TEST_AGENT_ID}"
put_body=$(_curl /api/user/preferences -X PUT -d "{\"webex_default_agent_id\": \"${TEST_AGENT_ID}\"}")
assert_jq_eq "Pin 4" "$put_body" '.data.webex_default_agent_id' "$TEST_AGENT_ID"

# Pin 5
get_body=$(_curl /api/user/preferences)
assert_jq_eq "Pin 5" "$get_body" '.data.webex_default_agent_id' "$TEST_AGENT_ID"

cat <<EOF
  [MANUAL CHECKPOINT 6] In Webex, message the bot:
      "hello again"
  Expected: reply from ${TEST_AGENT_ID} (saved pref).
  Press <Enter> when verified.

  [MANUAL CHECKPOINT 7] In the SAME 1:1, message:
      "use ${TEST_OVERRIDE_AGENT_ID}"
  Expected: 1:1 DM reply: "Got it — this space will route to ${TEST_OVERRIDE_AGENT_ID}..."
  Press <Enter> when verified.

  [MANUAL CHECKPOINT 8] In the SAME 1:1, send any message.
  Expected: reply from ${TEST_OVERRIDE_AGENT_ID}.
  Press <Enter> when verified.

  [MANUAL CHECKPOINT 9] In the SAME 1:1, message:
      "use default"
  Expected: "Cleared your saved DM preference and any active space override."
  Press <Enter> when verified.
EOF
read -r _
read -r _
read -r _
read -r _

# Pin 10
get_body=$(_curl /api/user/preferences)
agent=$(jq -r '.data.webex_default_agent_id // "null"' <<<"$get_body")
if [[ "$agent" == "null" ]]; then
  _pass "Pin 10: 'use default' cleared the saved pref"
else
  _fail "Pin 10: expected null, got $agent"
fi

cat <<EOF
  [MANUAL CHECKPOINT 11] In the SAME 1:1, send: "final check".
  Expected: reply from deployment default agent.
  Press <Enter> when verified.
EOF
read -r _

print_summary

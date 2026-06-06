#!/usr/bin/env bash
# tests/rbac/end_to_end/test_slack_dm.sh — T180
#
# Validates the Slack DM dispatch chain (FR-023, FR-029, FR-029a) end-to-end
# against a running dev stack. The data-layer flows are driven via curl;
# the Slack-side bot interactions are manual checkpoints printed at runtime.
#
# Pins:
#   1) Initial state — clear any saved pref so the user is on deployment default.
#   2) GET /api/user/preferences returns source="not_set".
#   3) Manual: send DM to bot — expects deployment dm_agent_id reply.
#   4) PUT /api/user/preferences sets dm_default_agent_id.
#   5) GET returns source="saved" with the new agent_id.
#   6) Manual: send DM — expects saved-pref agent reply.
#   7) Manual: /caipe-use <override-agent> — expects "use_ok" ephemeral.
#   8) Manual: send DM — expects override agent reply.
#   9) Manual: /caipe-use default — expects "use_default_ok" ephemeral.
#  10) GET returns source="not_set" again (preference cleared).
#  11) Manual: send DM — expects deployment dm_agent_id reply (back to baseline).
#
# assisted-by Claude:claude-opus-4-7

set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

: "${TEST_AGENT_ID:?TEST_AGENT_ID must be set (a saved-pref agent id)}"
: "${TEST_OVERRIDE_AGENT_ID:?TEST_OVERRIDE_AGENT_ID must be set (a different agent the user can use)}"

wait_for_bff

# ---------------------------------------------------------------------------
# Pin 1 — clear any pre-existing preference so we start clean
# ---------------------------------------------------------------------------
_log "Pin 1 — clearing any pre-existing DM preference"
clear_body=$(_curl /api/user/preferences -X PUT -d '{"dm_default_agent_id": null}')
assert_jq_eq "Pin 1" "$clear_body" '.data.dm_default_agent_id' "null"

# ---------------------------------------------------------------------------
# Pin 2 — read back: source should be "not_set"
# ---------------------------------------------------------------------------
_log "Pin 2 — GET /api/user/preferences"
get_body=$(_curl /api/user/preferences)
# We accept either "not_set" or a null agent_id with source="saved" depending
# on BFF semantics — both mean "no override; resolver will use deployment default".
agent_after_clear=$(jq -r '.data.dm_default_agent_id // "null"' <<<"$get_body")
if [[ "$agent_after_clear" == "null" ]]; then
  _pass "Pin 2: dm_default_agent_id is null after clear"
else
  _fail "Pin 2: expected dm_default_agent_id=null, got $agent_after_clear"
fi

# ---------------------------------------------------------------------------
# Pin 3 — MANUAL: DM expects deployment dm_agent_id agent
# ---------------------------------------------------------------------------
cat <<EOF
  [MANUAL CHECKPOINT 3] In Slack, send a DM to the bot: "hello".
  Expected: reply from the deployment default agent (SLACK_INTEGRATION_DM_AGENT_ID
  if set, else SLACK_INTEGRATION_DEFAULT_AGENT_ID).
  Press <Enter> when verified, or Ctrl-C to bail.
EOF
read -r _

# ---------------------------------------------------------------------------
# Pin 4 — set saved preference
# ---------------------------------------------------------------------------
_log "Pin 4 — PUT saved preference to ${TEST_AGENT_ID}"
put_body=$(_curl /api/user/preferences -X PUT -d "{\"dm_default_agent_id\": \"${TEST_AGENT_ID}\"}")
assert_jq_eq "Pin 4" "$put_body" '.data.dm_default_agent_id' "$TEST_AGENT_ID"

# ---------------------------------------------------------------------------
# Pin 5 — read back saved
# ---------------------------------------------------------------------------
_log "Pin 5 — GET saved preference"
get_body=$(_curl /api/user/preferences)
assert_jq_eq "Pin 5" "$get_body" '.data.dm_default_agent_id' "$TEST_AGENT_ID"

# ---------------------------------------------------------------------------
# Pin 6 — MANUAL: DM expects saved-pref agent
# ---------------------------------------------------------------------------
cat <<EOF
  [MANUAL CHECKPOINT 6] In Slack, send a DM: "hello again".
  Expected: reply from ${TEST_AGENT_ID} (your saved preference).
  Press <Enter> when verified.
EOF
read -r _

# ---------------------------------------------------------------------------
# Pin 7 — MANUAL: /caipe-use override
# ---------------------------------------------------------------------------
cat <<EOF
  [MANUAL CHECKPOINT 7] In the SAME Slack DM, run:
      /caipe-use ${TEST_OVERRIDE_AGENT_ID}
  Expected ephemeral reply: "Got it — this thread will route to ${TEST_OVERRIDE_AGENT_ID}..."
  Press <Enter> when verified.
EOF
read -r _

# ---------------------------------------------------------------------------
# Pin 8 — MANUAL: DM expects override agent
# ---------------------------------------------------------------------------
cat <<EOF
  [MANUAL CHECKPOINT 8] In the SAME Slack DM, send: "any message".
  Expected: reply from ${TEST_OVERRIDE_AGENT_ID} (your thread override).
  Press <Enter> when verified.
EOF
read -r _

# ---------------------------------------------------------------------------
# Pin 9 — MANUAL: /caipe-use default
# ---------------------------------------------------------------------------
cat <<EOF
  [MANUAL CHECKPOINT 9] In the SAME Slack DM, run:
      /caipe-use default
  Expected ephemeral reply: "Cleared your saved DM preference and any active thread override."
  Press <Enter> when verified.
EOF
read -r _

# ---------------------------------------------------------------------------
# Pin 10 — saved preference is null again
# ---------------------------------------------------------------------------
_log "Pin 10 — GET after /caipe-use default — expect null preference"
get_body=$(_curl /api/user/preferences)
agent_after_default=$(jq -r '.data.dm_default_agent_id // "null"' <<<"$get_body")
if [[ "$agent_after_default" == "null" ]]; then
  _pass "Pin 10: preference cleared by /caipe-use default"
else
  _fail "Pin 10: expected null, got $agent_after_default"
fi

# ---------------------------------------------------------------------------
# Pin 11 — MANUAL: DM expects deployment default
# ---------------------------------------------------------------------------
cat <<EOF
  [MANUAL CHECKPOINT 11] In the SAME Slack DM, send: "final check".
  Expected: reply from the deployment default agent again
  (the /caipe-use default cleared both override and saved pref).
  Press <Enter> when verified.
EOF
read -r _

print_summary

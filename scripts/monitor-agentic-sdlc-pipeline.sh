#!/usr/bin/env bash
# Live monitor for the Agentic SDLC webhook pipeline.
#
# Watches all four hops simultaneously:
#   ① SQS queue depth (direct credentials or optional assumed reader role)
#   ② sqs-webhook-proxy-receiver container logs (SQS poll + forward)
#   ③ caipe-ui webhook route activity
#   ④ MongoDB ship_loop_events + ship_loop_artifacts (new docs and recent stage transitions)
#
# Usage:
#   scripts/monitor-agentic-sdlc-pipeline.sh
#   scripts/monitor-agentic-sdlc-pipeline.sh --no-clear   # don't clear screen each refresh
#   scripts/monitor-agentic-sdlc-pipeline.sh --interval 2 # refresh every 2s (default: 3)
#
# Press Ctrl-C to exit. Each refresh shows the *last N* lines/docs so you
# see new activity scroll naturally as it happens.
#
# Dependencies (all already in CAIPE dev env):
#   - docker compose, docker logs
#   - mongosh inside caipe-mongodb-dev
#   - aws cli on host (with creds that can read the queue or assume a reader role)

set -euo pipefail

CLEAR=1
INTERVAL=3
N_RECEIVER_LOG_LINES=12
N_CAIPE_UI_LOG_LINES=8
N_EVENTS=6
N_ARTIFACTS=6

while [ $# -gt 0 ]; do
  case "$1" in
    --no-clear) CLEAR=0 ;;
    --interval) INTERVAL="$2"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

QUEUE_URL="${SQS_WEBHOOK_QUEUE_URL:-}"
QUEUE_NAME="${SQS_WEBHOOK_QUEUE:-}"
AWS_REGION_FOR_QUEUE="${SQS_WEBHOOK_AWS_REGION:-${AWS_REGION:-us-east-1}}"
ROLE_ARN="${SQS_WEBHOOK_AWS_ASSUME_ROLE_ARN:-}"
EXTERNAL_ID="${SQS_WEBHOOK_AWS_ASSUME_ROLE_EXTERNAL_ID:-}"

# --- ANSI helpers -----------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; MAGENTA=$'\033[35m'; RED=$'\033[31m'
else
  BOLD=""; DIM=""; RESET=""; GREEN=""; YELLOW=""; CYAN=""; MAGENTA=""; RED=""
fi

# --- Hop 1: SQS queue depth -------------------------------------------------
# Cache STS creds across iterations; only re-assume when expired (~55min).
TMP_STS="${TMPDIR:-/tmp}/.caipe-monitor-sts"
sts_refresh() {
  if [[ -z "$ROLE_ARN" ]]; then
    rm -f "$TMP_STS"
    return 0
  fi

  # Load base creds from .env
  set +u
  source <(grep -E '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_REGION)=' .env | sed 's/^/export /')
  set -u
  unset AWS_SESSION_TOKEN
  local assume_args=(
    sts assume-role
    --role-arn "$ROLE_ARN"
    --role-session-name caipe-monitor
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken,Expiration]'
    --output text
  )
  if [[ -n "$EXTERNAL_ID" ]]; then
    assume_args+=(--external-id "$EXTERNAL_ID")
  fi
  AWS_DEFAULT_REGION="$AWS_REGION_FOR_QUEUE" aws "${assume_args[@]}" 2>/dev/null > "$TMP_STS" || true
}

sts_load() {
  export AWS_DEFAULT_REGION="$AWS_REGION_FOR_QUEUE"
  if [[ -z "$ROLE_ARN" ]]; then
    return 0
  fi

  if [[ ! -s "$TMP_STS" ]] || [[ $(find "$TMP_STS" -mmin +50 2>/dev/null | wc -l) -gt 0 ]]; then
    sts_refresh
  fi
  if [[ -s "$TMP_STS" ]]; then
    read -r AKI SAK STK EXP < "$TMP_STS"
    export AWS_ACCESS_KEY_ID="$AKI"
    export AWS_SECRET_ACCESS_KEY="$SAK"
    export AWS_SESSION_TOKEN="$STK"
    export AWS_DEFAULT_REGION="$AWS_REGION_FOR_QUEUE"
  fi
}

queue_depth() {
  sts_load
  local queue_url="$QUEUE_URL"
  if [[ -z "$queue_url" && -n "$QUEUE_NAME" ]]; then
    queue_url="$(aws sqs get-queue-url --queue-name "$QUEUE_NAME" --query QueueUrl --output text 2>/dev/null || true)"
  fi
  if [[ -z "$queue_url" ]]; then
    echo "(queue not configured)"
    return 0
  fi

  aws sqs get-queue-attributes \
    --queue-url "$queue_url" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
    --output json 2>/dev/null \
  | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)["Attributes"]
    v = int(d.get("ApproximateNumberOfMessages", 0))
    inf = int(d.get("ApproximateNumberOfMessagesNotVisible", 0))
    dl = int(d.get("ApproximateNumberOfMessagesDelayed", 0))
    print(f"visible={v}  inflight={inf}  delayed={dl}")
except Exception:
    print("(unavailable)")
'
}

# --- Hop 2: receiver container ----------------------------------------------
receiver_state() {
  docker inspect sqs-webhook-proxy-receiver --format \
    '{{.State.Status}} ({{.State.Health.Status}}) restarts={{.RestartCount}}' \
    2>/dev/null || echo "not running"
}

receiver_tail() {
  docker logs --tail "$N_RECEIVER_LOG_LINES" sqs-webhook-proxy-receiver 2>&1 \
    | sed -E "s/\[forward\] ok/${GREEN}[forward] ok${RESET}/g; \
              s/\[forward\] non-2xx/${RED}[forward] non-2xx${RESET}/g; \
              s/forward failed/${RED}forward failed${RESET}/g"
}

# --- Hop 3: caipe-ui webhook route ------------------------------------------
caipe_ui_state() {
  docker inspect caipe-ui --format \
    '{{.State.Status}} restarts={{.RestartCount}}' 2>/dev/null || echo "not running"
}

caipe_ui_tail() {
  # The Next.js route logs are quiet by default. Grep the recent log window
  # for anything webhook-shaped (the route's own console output + Next.js
  # access lines).
  docker logs --since 5m caipe-ui 2>&1 \
    | grep -iE 'agentic-sdlc/webhooks|POST /api/agentic-sdlc|webhook|hook' \
    | tail -"$N_CAIPE_UI_LOG_LINES" \
    | sed -E "s/( 20[0-9] )/${GREEN}\1${RESET}/g; s/( 4[0-9]{2} )/${YELLOW}\1${RESET}/g; s/( 5[0-9]{2} )/${RED}\1${RESET}/g"
}

# --- Hop 4: Mongo events + artifacts ----------------------------------------
mongo_recent_events() {
  docker exec caipe-mongodb-dev mongosh -u admin -p changeme --authenticationDatabase admin caipe \
    --quiet --eval "
      const events = db.ship_loop_events
        .find({}, { github_event_type:1, github_action:1, github_delivery_id:1, artifact_kind:1, projection_status:1, delivered_at:1 })
        .sort({ _id:-1 }).limit($N_EVENTS).toArray();
      events.forEach(e => {
        const t = e.delivered_at ? new Date(e.delivered_at).toISOString().slice(11,19) : '--:--:--';
        const did = e.github_delivery_id || '';
        const realMark = did && did.length > 0 ? '★' : ' ';
        const didShort = did ? did.slice(0, 8) : '-';
        const proj = e.projection_status || 'pending';
        print(\`  \${realMark} \${t}  \${(e.github_event_type||'?').padEnd(18)} \${(e.github_action||'-').padEnd(14)} kind=\${(e.artifact_kind||'-').padEnd(10)} proj=\${proj.padEnd(10)} did=\${didShort}\`);
      });
    " 2>/dev/null | grep -v -E '^$|deprecation|Using Mongo|Current Mongo' \
    | sed -E "s/proj=projected/proj=${GREEN}projected${RESET}/g; \
              s/proj=pending/proj=${YELLOW}pending${RESET}/g; \
              s/proj=failed/proj=${RED}failed${RESET}/g; \
              s/^( +★)/${GREEN}\1${RESET}/"
}

throughput_summary() {
  docker exec caipe-mongodb-dev mongosh -u admin -p changeme --authenticationDatabase admin caipe \
    --quiet --eval "
      const now = Date.now();
      const real = { github_delivery_id: { \$nin: [null, ''] } };
      const c5m  = db.ship_loop_events.countDocuments({ \$and: [real, { delivered_at: { \$gte: new Date(now -  5*60*1000) } }] });
      const c15m = db.ship_loop_events.countDocuments({ \$and: [real, { delivered_at: { \$gte: new Date(now - 15*60*1000) } }] });
      const c1h  = db.ship_loop_events.countDocuments({ \$and: [real, { delivered_at: { \$gte: new Date(now - 60*60*1000) } }] });
      const c24h = db.ship_loop_events.countDocuments({ \$and: [real, { delivered_at: { \$gte: new Date(now - 24*60*60*1000) } }] });
      print(\`5m=\${c5m}  15m=\${c15m}  1h=\${c1h}  24h=\${c24h}\`);
    " 2>/dev/null | grep -v -E '^$|deprecation|Using Mongo|Current Mongo' | tr -d '\n'
}

mongo_recent_artifacts() {
  docker exec caipe-mongodb-dev mongosh -u admin -p changeme --authenticationDatabase admin caipe \
    --quiet --eval "
      const arts = db.ship_loop_artifacts
        .find({ updated_at: { \$gte: new Date(Date.now() - 24*60*60*1000) } },
              { repo_id:1, kind:1, github_number:1, stage:1, title:1, updated_at:1 })
        .sort({ updated_at:-1 }).limit($N_ARTIFACTS).toArray();
      if (arts.length === 0) {
        print('  (no artifact updates in the last 24h)');
        quit();
      }
      arts.forEach(a => {
        const t = a.updated_at ? new Date(a.updated_at).toISOString().slice(11,19) : '--:--:--';
        const num = a.github_number ? '#' + a.github_number : '-';
        const title = (a.title || '').slice(0, 50);
        print(\`  \${t}  stage=\${(a.stage||'?').padEnd(12)} kind=\${(a.kind||'-').padEnd(8)} \${num.padEnd(6)} \${title}\`);
      });
    " 2>/dev/null | grep -v -E '^$|deprecation|Using Mongo|Current Mongo' \
    | sed -E "s/stage=specify/stage=${CYAN}specify${RESET}/g; \
              s/stage=plan/stage=${CYAN}plan${RESET}/g; \
              s/stage=implement/stage=${MAGENTA}implement${RESET}/g; \
              s/stage=review_hitl/stage=${YELLOW}review_hitl${RESET}/g; \
              s/stage=merge/stage=${GREEN}merge${RESET}/g; \
              s/stage=deploy/stage=${GREEN}deploy${RESET}/g; \
              s/stage=observe/stage=${GREEN}observe${RESET}/g; \
              s/stage=blocked/stage=${RED}blocked${RESET}/g"
}

# --- main loop --------------------------------------------------------------
trap 'echo; echo "monitor stopped"; exit 0' INT TERM
TICK=0
while true; do
  TICK=$((TICK + 1))
  [[ $CLEAR -eq 1 ]] && clear || echo
  NOW="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "${BOLD}${CYAN}═══ Agentic SDLC pipeline monitor  (tick #${TICK}  ${NOW})${RESET}"
  echo

  echo "${BOLD}① SQS  ${DIM}${QUEUE_NAME:-webhook-deliveries}${RESET}"
  echo -n "    queue: "; queue_depth
  echo

  echo "${BOLD}② Receiver  ${DIM}sqs-webhook-proxy-receiver${RESET}"
  echo "    status: $(receiver_state)"
  receiver_tail | sed 's/^/    /'
  echo

  echo "${BOLD}③ caipe-ui webhook route  ${DIM}/api/agentic-sdlc/webhooks/github${RESET}"
  echo "    status: $(caipe_ui_state)"
  if out="$(caipe_ui_tail)"; [[ -n "$out" ]]; then
    echo "$out" | sed 's/^/    /'
  else
    echo "    ${DIM}(no recent webhook log lines — caipe-ui is quiet by default)${RESET}"
  fi
  echo

  echo "${BOLD}④ Throughput  ${DIM}(real GitHub deliveries only — filtered by github_delivery_id present)${RESET}"
  echo -n "    "; throughput_summary
  echo

  echo "${BOLD}⑤ ship_loop_events  ${DIM}(newest first; ★ = real GitHub delivery)${RESET}"
  mongo_recent_events
  echo
  echo "${BOLD}⑥ ship_loop_artifacts  ${DIM}(last 24h, newest first)${RESET}"
  mongo_recent_artifacts
  echo
  echo "${DIM}next refresh in ${INTERVAL}s … ctrl-c to quit${RESET}"

  sleep "$INTERVAL"
done

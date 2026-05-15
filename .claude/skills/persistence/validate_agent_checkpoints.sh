#!/bin/bash
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
#
# Validate per-agent MongoDB checkpoint persistence.
# Checks that each running agent has auto-prefixed collections and is
# writing checkpoints to its own isolated collection pair.
#
# Usage:
#   ./skills/persistence/validate_agent_checkpoints.sh          # validate all
#   ./skills/persistence/validate_agent_checkpoints.sh aws jira # validate specific agents

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

MONGO_CONTAINER=${MONGO_CONTAINER:-caipe-mongodb-dev}
MONGO_URI=${MONGO_URI:-"mongodb://admin:changeme@localhost:27017/caipe?authSource=admin"}

ALL_AGENTS=(argocd aws backstage confluence github gitlab jira komodor netutils pagerduty slack splunk victorops weather webex)
SUPERVISOR=caipe_supervisor

# Use args if provided, otherwise all agents
if [ $# -gt 0 ]; then
  AGENTS=("$@")
else
  AGENTS=("${ALL_AGENTS[@]}")
fi

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Per-Agent MongoDB Checkpoint Validation${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

PASS=0
FAIL=0
WARN=0

# ── Helper ──────────────────────────────────────────────────────────────────

check_agent() {
  local name=$1
  local container=$2
  local prefix=$3

  local cp_coll="checkpoints_${prefix}"
  local wr_coll="checkpoint_writes_${prefix}"

  # Check container is running
  local status
  status=$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null)
  if [ "$status" != "running" ]; then
    echo -e "  ${RED}✗${NC} ${name}: container ${container} not running (${status:-not found})"
    ((FAIL++))
    return
  fi

  # Check logs for auto-prefix
  local auto_prefix
  auto_prefix=$(docker logs "$container" 2>&1 | grep "auto-prefixed collections with '${prefix}'" | tail -1)

  # Check MongoDB collections exist and have data
  local cp_count wr_count
  cp_count=$(docker exec "$MONGO_CONTAINER" mongosh "$MONGO_URI" --quiet --eval "db.${cp_coll}.countDocuments()" 2>/dev/null)
  wr_count=$(docker exec "$MONGO_CONTAINER" mongosh "$MONGO_URI" --quiet --eval "db.${wr_coll}.countDocuments()" 2>/dev/null)

  if [ -n "$auto_prefix" ]; then
    if [ "$cp_count" -gt 0 ] 2>/dev/null; then
      echo -e "  ${GREEN}✓${NC} ${name}: ${cp_coll} (${cp_count} docs), ${wr_coll} (${wr_count} docs)"
      ((PASS++))
    else
      echo -e "  ${YELLOW}~${NC} ${name}: collections configured but empty (${cp_coll}: ${cp_count}, ${wr_coll}: ${wr_count})"
      echo -e "       Auto-prefix detected. Send a message to trigger checkpoint writes."
      ((WARN++))
    fi
  else
    # Check if using InMemorySaver fallback
    local inmem
    inmem=$(docker logs "$container" 2>&1 | grep "InMemorySaver" | tail -1)
    if [ -n "$inmem" ]; then
      echo -e "  ${RED}✗${NC} ${name}: using InMemorySaver (missing langgraph-checkpoint-mongodb?)"
      ((FAIL++))
    else
      echo -e "  ${YELLOW}~${NC} ${name}: no auto-prefix log found (container may need restart)"
      ((WARN++))
    fi
  fi
}

# ── Supervisor ──────────────────────────────────────────────────────────────

echo -e "${BLUE}Supervisor${NC}"
check_agent "supervisor" "caipe-supervisor" "$SUPERVISOR"
echo ""

# ── Agents ──────────────────────────────────────────────────────────────────

echo -e "${BLUE}Agents${NC}"
for agent in "${AGENTS[@]}"; do
  check_agent "$agent" "agent-${agent}" "$agent"
done
echo ""

# ── MongoDB Overview ────────────────────────────────────────────────────────

echo -e "${BLUE}MongoDB Collections (caipe db)${NC}"
docker exec "$MONGO_CONTAINER" mongosh "$MONGO_URI" --quiet --eval '
  var colls = db.getCollectionNames().filter(c => c.includes("checkpoint")).sort();
  colls.forEach(function(c) {
    var count = db.getCollection(c).countDocuments();
    print("  " + c + ": " + count + " docs");
  });
' 2>/dev/null
echo ""

# ── Cross-contamination check ──────────────────────────────────────────────

echo -e "${BLUE}Cross-Contamination Check${NC}"
echo "  Checking for shared thread_ids across agent collections..."
docker exec "$MONGO_CONTAINER" mongosh "$MONGO_URI" --quiet --eval '
  var checkpoint_colls = db.getCollectionNames().filter(c => c.startsWith("checkpoints_"));
  var thread_map = {};
  checkpoint_colls.forEach(function(coll) {
    var threads = db.getCollection(coll).distinct("thread_id");
    threads.forEach(function(tid) {
      if (!thread_map[tid]) thread_map[tid] = [];
      thread_map[tid].push(coll);
    });
  });
  var shared = 0;
  Object.keys(thread_map).forEach(function(tid) {
    if (thread_map[tid].length > 1) {
      shared++;
      if (shared <= 3) {
        print("  thread " + tid.substring(0,8) + "... → " + thread_map[tid].join(", "));
      }
    }
  });
  if (shared > 3) print("  ... and " + (shared - 3) + " more shared threads");
  if (shared > 0) {
    print("  ℹ " + shared + " threads shared across collections (expected — supervisor forwards context_id)");
  } else {
    print("  ✓ No shared threads found");
  }
' 2>/dev/null
echo ""

# ── Summary ─────────────────────────────────────────────────────────────────

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL + WARN))
echo -e "  ${GREEN}Pass: ${PASS}${NC}  ${RED}Fail: ${FAIL}${NC}  ${YELLOW}Warn: ${WARN}${NC}  Total: ${TOTAL}"
if [ $FAIL -eq 0 ]; then
  echo -e "  ${GREEN}All checks passed!${NC}"
else
  echo -e "  ${RED}${FAIL} check(s) failed.${NC}"
fi
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"

exit $FAIL

#!/usr/bin/env bash
# Integration test: LLM provider switching with A2A validation and Langfuse trace checks
#
# Verifies that the CAIPE supervisor agent works correctly across all supported
# LLM providers (Anthropic Claude, AWS Bedrock, OpenAI) with OpenAI embeddings.
#
# Tests:
#   1. Switch provider via setup-caipe.sh (or Helm + secret update)
#   2. Wait for supervisor pod rollout
#   3. Validate agent card, sub-agent registration, A2A endpoint
#   4. Send test prompts via A2A message/send
#   5. Check response for duplication and correctness
#   6. Verify Langfuse traces (if tracing is enabled)
#   7. Optionally test RAG queries
#
# Usage:
#   ./test_llm_provider_switching.sh                    # test all providers
#   ./test_llm_provider_switching.sh --provider claude   # test one provider
#   ./test_llm_provider_switching.sh --skip-switch       # test current provider only
#   ./test_llm_provider_switching.sh --with-rag          # include RAG prompts
#
# Prerequisites:
#   - CAIPE deployed on a Kind cluster (caipe namespace)
#   - Port-forward active: supervisor on 8000, langfuse on 3100 (optional)
#   - Credential files: ~/.config/claude.txt, ~/.config/openai.txt,
#     ~/.config/bedrock.txt (for the providers you want to test)
#
# Environment:
#   SUPERVISOR_URL    Supervisor base URL (default: http://localhost:8000)
#   LANGFUSE_URL      Langfuse base URL (default: http://localhost:3100)
#   LANGFUSE_PK       Langfuse public key (auto-detected from k8s secret)
#   LANGFUSE_SK       Langfuse secret key (auto-detected from k8s secret)
#   SETUP_SCRIPT      Path to setup-caipe.sh (default: auto-detect)
#   TIMEOUT           curl timeout in seconds (default: 120)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
SUPERVISOR_URL="${SUPERVISOR_URL:-http://localhost:8000}"
LANGFUSE_URL="${LANGFUSE_URL:-http://localhost:3100}"
LANGFUSE_PK="${LANGFUSE_PK:-}"
LANGFUSE_SK="${LANGFUSE_SK:-}"
TIMEOUT="${TIMEOUT:-120}"
NAMESPACE="caipe"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0
RESULTS_DIR=""
SKIP_SWITCH=false
WITH_RAG=false
SINGLE_PROVIDER=""

# ─── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo -e "  ${DIM}$(date '+%H:%M:%S')${NC} $*"; }
pass() { echo -e "  ${GREEN}✓${NC} $*"; TOTAL_PASS=$((TOTAL_PASS + 1)); }
fail() { echo -e "  ${RED}✗${NC} $*"; TOTAL_FAIL=$((TOTAL_FAIL + 1)); }
skip() { echo -e "  ${YELLOW}⊘${NC} $*"; TOTAL_SKIP=$((TOTAL_SKIP + 1)); }
header() { echo ""; echo -e "  ${CYAN}${BOLD}═══ $* ═══${NC}"; }

usage() {
  cat <<'EOF'
Usage: test_llm_provider_switching.sh [OPTIONS]

Options:
  --provider <name>   Test a single provider: claude, bedrock, openai
  --skip-switch       Test current provider without switching
  --with-rag          Include RAG-specific test prompts
  --timeout <secs>    A2A request timeout (default: 120)
  --help              Show this help
EOF
  exit 0
}

# ─── Argument parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)   SINGLE_PROVIDER="$2"; shift 2 ;;
    --skip-switch) SKIP_SWITCH=true; shift ;;
    --with-rag)   WITH_RAG=true; shift ;;
    --timeout)    TIMEOUT="$2"; shift 2 ;;
    --help|-h)    usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

# ─── Results directory ────────────────────────────────────────────────────────
RESULTS_DIR="integration/reports/provider_test_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RESULTS_DIR"

# ─── Test prompts ─────────────────────────────────────────────────────────────
declare -a TEST_PROMPTS=(
  "What is 2+2? Reply with just the number."
  "What is the weather in San Francisco?"
)

declare -a RAG_PROMPTS=(
  "What is CAIPE and how do I get started?"
  "Search the knowledge base for deployment guides"
)

# ─── Detect Langfuse credentials ─────────────────────────────────────────────
detect_langfuse_keys() {
  if [[ -n "$LANGFUSE_PK" && -n "$LANGFUSE_SK" ]]; then
    return 0
  fi

  LANGFUSE_PK=$(kubectl get secret langfuse-secret -n "$NAMESPACE" \
    -o jsonpath='{.data.LANGFUSE_PUBLIC_KEY}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  LANGFUSE_SK=$(kubectl get secret langfuse-secret -n "$NAMESPACE" \
    -o jsonpath='{.data.LANGFUSE_SECRET_KEY}' 2>/dev/null | base64 -d 2>/dev/null || echo "")

  if [[ -n "$LANGFUSE_PK" ]]; then
    log "Langfuse keys detected from k8s secret"
    return 0
  fi
  return 1
}

# ─── Get current provider from k8s secret ─────────────────────────────────────
get_current_provider() {
  kubectl get secret llm-secret -n "$NAMESPACE" \
    -o jsonpath='{.data.LLM_PROVIDER}' 2>/dev/null | base64 -d 2>/dev/null || echo "unknown"
}

get_current_model() {
  local provider
  provider=$(get_current_provider)
  case "$provider" in
    openai)
      kubectl get secret llm-secret -n "$NAMESPACE" \
        -o jsonpath='{.data.OPENAI_MODEL_NAME}' 2>/dev/null | base64 -d 2>/dev/null || echo "unknown"
      ;;
    anthropic-claude)
      kubectl get secret llm-secret -n "$NAMESPACE" \
        -o jsonpath='{.data.ANTHROPIC_MODEL_NAME}' 2>/dev/null | base64 -d 2>/dev/null || echo "unknown"
      ;;
    aws-bedrock)
      kubectl get secret llm-secret -n "$NAMESPACE" \
        -o jsonpath='{.data.AWS_BEDROCK_MODEL_ID}' 2>/dev/null | base64 -d 2>/dev/null || echo "unknown"
      ;;
    *) echo "unknown" ;;
  esac
}

# ─── Switch provider ──────────────────────────────────────────────────────────
switch_provider() {
  local target="$1"
  local current
  current=$(get_current_provider)

  if [[ "$current" == "$target" ]]; then
    log "Already on ${target} — skipping switch"
    return 0
  fi

  header "Switching provider: ${current} → ${target}"

  # Build the secret data based on provider
  local secret_args=("--from-literal=LLM_PROVIDER=${target}")

  case "$target" in
    anthropic-claude)
      local key=""
      if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        key="$ANTHROPIC_API_KEY"
      elif [[ -f ~/.config/claude.txt ]]; then
        key=$(head -1 ~/.config/claude.txt | tr -d '[:space:]')
      fi
      if [[ -z "$key" ]]; then
        skip "No Anthropic key found — skipping Claude"
        return 1
      fi
      local model="${ANTHROPIC_MODEL_NAME:-claude-haiku-4-5}"
      secret_args+=(
        "--from-literal=ANTHROPIC_API_KEY=${key}"
        "--from-literal=ANTHROPIC_MODEL_NAME=${model}"
      )
      ;;
    openai)
      local key=""
      if [[ -n "${OPENAI_API_KEY:-}" ]]; then
        key="$OPENAI_API_KEY"
      elif [[ -f ~/.config/openai.txt ]]; then
        key=$(head -1 ~/.config/openai.txt | tr -d '[:space:]')
      fi
      if [[ -z "$key" ]]; then
        skip "No OpenAI key found — skipping OpenAI"
        return 1
      fi
      local model="${OPENAI_MODEL_NAME:-gpt-5.2}"
      secret_args+=(
        "--from-literal=OPENAI_API_KEY=${key}"
        "--from-literal=OPENAI_BASE_URL=https://api.openai.com/v1"
        "--from-literal=OPENAI_ENDPOINT=https://api.openai.com/v1"
        "--from-literal=OPENAI_MODEL_NAME=${model}"
      )
      ;;
    aws-bedrock)
      local access_key="" secret_key="" region="" model_id=""
      if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
        access_key="$AWS_ACCESS_KEY_ID"
        secret_key="$AWS_SECRET_ACCESS_KEY"
        region="${AWS_REGION:-us-east-2}"
        model_id="${AWS_BEDROCK_MODEL_ID:-us.anthropic.claude-3-7-sonnet-20250219-v1:0}"
      elif [[ -f ~/.config/bedrock.txt ]]; then
        while IFS='=' read -r k v; do
          v="${v//\"/}"
          case "$k" in
            AWS_ACCESS_KEY_ID)    access_key="$v" ;;
            AWS_SECRET_ACCESS_KEY) secret_key="$v" ;;
            AWS_REGION)           region="$v" ;;
            AWS_BEDROCK_MODEL_ID) model_id="$v" ;;
          esac
        done < ~/.config/bedrock.txt
        region="${region:-us-east-2}"
        model_id="${model_id:-us.anthropic.claude-3-7-sonnet-20250219-v1:0}"
      fi
      if [[ -z "$access_key" || -z "$secret_key" ]]; then
        skip "No AWS credentials found — skipping Bedrock"
        return 1
      fi
      secret_args+=(
        "--from-literal=AWS_ACCESS_KEY_ID=${access_key}"
        "--from-literal=AWS_SECRET_ACCESS_KEY=${secret_key}"
        "--from-literal=AWS_REGION=${region}"
        "--from-literal=AWS_BEDROCK_MODEL_ID=${model_id}"
        "--from-literal=AWS_BEDROCK_PROVIDER=anthropic"
      )
      ;;
  esac

  # If RAG is active and provider is not openai, add the OpenAI key for embeddings
  local rag_active
  rag_active=$(kubectl get deployment caipe-supervisor-agent -n "$NAMESPACE" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="RAG_SERVER_URL")].value}' 2>/dev/null || echo "")
  if [[ -n "$rag_active" && "$target" != "openai" ]]; then
    local oai_key=""
    if [[ -n "${OPENAI_API_KEY:-}" ]]; then
      oai_key="$OPENAI_API_KEY"
    elif [[ -f ~/.config/openai.txt ]]; then
      oai_key=$(head -1 ~/.config/openai.txt | tr -d '[:space:]')
    fi
    if [[ -n "$oai_key" ]]; then
      secret_args+=("--from-literal=OPENAI_API_KEY=${oai_key}")
    fi
  fi

  kubectl create secret generic llm-secret -n "$NAMESPACE" \
    "${secret_args[@]}" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

  log "Secret updated, restarting supervisor..."
  kubectl rollout restart deployment/caipe-supervisor-agent -n "$NAMESPACE" >/dev/null
  kubectl rollout status deployment/caipe-supervisor-agent -n "$NAMESPACE" --timeout=120s >/dev/null 2>&1

  log "Waiting for supervisor to initialize..."
  sleep 10

  local retries=0
  while [[ $retries -lt 12 ]]; do
    if curl -sf "${SUPERVISOR_URL}/.well-known/agent.json" --max-time 5 >/dev/null 2>&1; then
      log "Supervisor is ready"
      return 0
    fi
    retries=$((retries + 1))
    sleep 5
  done

  fail "Supervisor did not become ready after switch to ${target}"
  return 1
}

# ─── Validate agent card ─────────────────────────────────────────────────────
test_agent_card() {
  local provider="$1"
  local card
  card=$(curl -sf "${SUPERVISOR_URL}/.well-known/agent.json" --max-time 10 2>/dev/null || echo "")

  if [[ -z "$card" ]]; then
    fail "[${provider}] Agent card not reachable"
    return 1
  fi

  if ! echo "$card" | jq -e '.name and .url and .skills' >/dev/null 2>&1; then
    fail "[${provider}] Agent card missing required fields (name, url, skills)"
    return 1
  fi

  local name skills
  name=$(echo "$card" | jq -r '.name')
  skills=$(echo "$card" | jq -r '.skills | length')
  pass "[${provider}] Agent card valid (name=${name}, skills=${skills})"

  for agent in weather netutils; do
    if echo "$card" | grep -qi "$agent" 2>/dev/null; then
      pass "[${provider}] Sub-agent '${agent}' registered"
    else
      fail "[${provider}] Sub-agent '${agent}' not found in agent card"
    fi
  done

  echo "$card" > "${RESULTS_DIR}/${provider}_agent_card.json"
  return 0
}

# ─── Send A2A test prompt ─────────────────────────────────────────────────────
send_a2a_prompt() {
  local provider="$1"
  local prompt="$2"
  local test_id="test-${provider}-$(date +%s)-${RANDOM}"

  local response
  response=$(curl -sf -X POST "${SUPERVISOR_URL}/" \
    -H 'Content-Type: application/json' \
    --max-time "$TIMEOUT" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"${test_id}\",
      \"method\": \"message/send\",
      \"params\": {
        \"message\": {
          \"role\": \"user\",
          \"parts\": [{\"kind\": \"text\", \"text\": \"${prompt}\"}],
          \"messageId\": \"msg-${test_id}\"
        }
      }
    }" 2>/dev/null || echo "")

  if [[ -z "$response" ]]; then
    fail "[${provider}] No response for prompt: ${prompt:0:50}..."
    return 1
  fi

  # Save raw response
  local sanitized_prompt="${prompt//[^a-zA-Z0-9]/_}"
  echo "$response" | jq . > "${RESULTS_DIR}/${provider}_${sanitized_prompt:0:30}.json" 2>/dev/null || \
    echo "$response" > "${RESULTS_DIR}/${provider}_${sanitized_prompt:0:30}.json"

  # Check for error
  if echo "$response" | jq -e '.error' >/dev/null 2>&1; then
    local err_msg
    err_msg=$(echo "$response" | jq -r '.error.message // .error' 2>/dev/null)
    fail "[${provider}] A2A error: ${err_msg:0:120}"
    return 1
  fi

  # Check for valid result
  if ! echo "$response" | jq -e '.result' >/dev/null 2>&1; then
    fail "[${provider}] Response has no .result field"
    return 1
  fi

  pass "[${provider}] A2A response received for: ${prompt:0:50}..."

  # ── Duplication check ──
  # Extract final text from artifacts
  local final_text
  final_text=$(echo "$response" | jq -r '
    [.result.artifacts[]? | .parts[]? | select(.kind=="text") | .text] | join("\n")
  ' 2>/dev/null || echo "")

  if [[ -z "$final_text" ]]; then
    final_text=$(echo "$response" | jq -r '.result.status.message.parts[0].text // empty' 2>/dev/null || echo "")
  fi

  if [[ -n "$final_text" ]]; then
    # Check for JSON blob duplication (the OpenAI PlatformEngineerResponse issue)
    local json_blob_count
    json_blob_count=$(echo "$final_text" | grep -c '"summary"' 2>/dev/null || echo "0")
    if [[ "$json_blob_count" -gt 1 ]]; then
      fail "[${provider}] DUPLICATE: Found ${json_blob_count} 'summary' JSON blocks in response"
    else
      pass "[${provider}] No response duplication detected"
    fi

    log "Response preview: ${final_text:0:150}..."
  fi

  echo "$test_id"
  return 0
}

# ─── Check Langfuse traces ───────────────────────────────────────────────────
check_langfuse_traces() {
  local provider="$1"
  local after_ts="$2"

  if [[ -z "$LANGFUSE_PK" || -z "$LANGFUSE_SK" ]]; then
    skip "[${provider}] Langfuse keys not available — skipping trace check"
    return 0
  fi

  # Check Langfuse health
  local health
  health=$(curl -sf "${LANGFUSE_URL}/api/public/health" --max-time 5 2>/dev/null || echo "")
  if [[ -z "$health" ]]; then
    skip "[${provider}] Langfuse not reachable — skipping trace check"
    return 0
  fi

  # Wait a few seconds for traces to flush
  sleep 5

  # Query recent traces
  local traces
  traces=$(curl -sf "${LANGFUSE_URL}/api/public/traces?limit=5" \
    -u "${LANGFUSE_PK}:${LANGFUSE_SK}" \
    --max-time 10 2>/dev/null || echo "")

  if [[ -z "$traces" ]]; then
    fail "[${provider}] Could not fetch Langfuse traces"
    return 1
  fi

  local trace_count
  trace_count=$(echo "$traces" | jq '.data | length' 2>/dev/null || echo "0")

  if [[ "$trace_count" -gt 0 ]]; then
    pass "[${provider}] Langfuse has ${trace_count} recent traces"

    # Check trace metadata
    local latest_trace
    latest_trace=$(echo "$traces" | jq '.data[0]' 2>/dev/null)
    local trace_name trace_id
    trace_name=$(echo "$latest_trace" | jq -r '.name // "unnamed"' 2>/dev/null)
    trace_id=$(echo "$latest_trace" | jq -r '.id // "unknown"' 2>/dev/null)
    log "Latest trace: name=${trace_name}, id=${trace_id:0:20}..."

    # Check for generations (LLM calls) in the trace
    local generations
    generations=$(curl -sf "${LANGFUSE_URL}/api/public/observations?traceId=${trace_id}&type=GENERATION" \
      -u "${LANGFUSE_PK}:${LANGFUSE_SK}" \
      --max-time 10 2>/dev/null || echo "")

    if [[ -n "$generations" ]]; then
      local gen_count
      gen_count=$(echo "$generations" | jq '.data | length' 2>/dev/null || echo "0")
      if [[ "$gen_count" -gt 0 ]]; then
        pass "[${provider}] Langfuse trace has ${gen_count} LLM generation(s)"

        # Check the model used
        local model_used
        model_used=$(echo "$generations" | jq -r '.data[0].model // "unknown"' 2>/dev/null)
        log "Model in trace: ${model_used}"

        # Check token usage
        local input_tokens output_tokens
        input_tokens=$(echo "$generations" | jq -r '.data[0].usage.input // 0' 2>/dev/null)
        output_tokens=$(echo "$generations" | jq -r '.data[0].usage.output // 0' 2>/dev/null)
        if [[ "$input_tokens" -gt 0 || "$output_tokens" -gt 0 ]]; then
          pass "[${provider}] Token usage recorded: in=${input_tokens}, out=${output_tokens}"
        fi
      else
        skip "[${provider}] No LLM generations found in latest trace"
      fi
    fi

    echo "$traces" | jq . > "${RESULTS_DIR}/${provider}_langfuse_traces.json" 2>/dev/null
  else
    fail "[${provider}] No traces found in Langfuse after test"
  fi
}

# ─── Test one provider ────────────────────────────────────────────────────────
test_provider() {
  local provider="$1"
  local display_name=""

  case "$provider" in
    anthropic-claude|claude) provider="anthropic-claude"; display_name="Anthropic Claude" ;;
    aws-bedrock|bedrock)     provider="aws-bedrock";      display_name="AWS Bedrock" ;;
    openai)                  provider="openai";           display_name="OpenAI" ;;
    *) fail "Unknown provider: ${provider}"; return 1 ;;
  esac

  header "Testing: ${display_name}"

  # Switch if needed
  if ! $SKIP_SWITCH; then
    if ! switch_provider "$provider"; then
      return 1
    fi
  fi

  local actual_provider actual_model
  actual_provider=$(get_current_provider)
  actual_model=$(get_current_model)
  log "Active provider: ${actual_provider}, model: ${actual_model}"

  if [[ "$actual_provider" != "$provider" && ! $SKIP_SWITCH ]]; then
    fail "[${display_name}] Provider mismatch: expected=${provider}, actual=${actual_provider}"
    return 1
  fi

  # Record timestamp for Langfuse correlation
  local test_start
  test_start=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%s)

  # Agent card
  test_agent_card "$display_name"

  # A2A prompts
  for prompt in "${TEST_PROMPTS[@]}"; do
    send_a2a_prompt "$display_name" "$prompt" || true
  done

  # RAG prompts
  if $WITH_RAG; then
    for prompt in "${RAG_PROMPTS[@]}"; do
      send_a2a_prompt "$display_name" "$prompt" || true
    done
  fi

  # Langfuse traces
  check_langfuse_traces "$display_name" "$test_start"

  # Check supervisor logs for errors
  local error_count
  error_count=$(kubectl logs deployment/caipe-supervisor-agent -n "$NAMESPACE" --tail=50 2>/dev/null \
    | grep -ci "error\|traceback\|exception" || echo "0")
  if [[ "$error_count" -gt 3 ]]; then
    fail "[${display_name}] Supervisor logs contain ${error_count} error lines (last 50)"
    kubectl logs deployment/caipe-supervisor-agent -n "$NAMESPACE" --tail=50 2>/dev/null \
      > "${RESULTS_DIR}/${provider}_supervisor_logs.txt"
  else
    pass "[${display_name}] Supervisor logs look clean"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}CAIPE LLM Provider Integration Tests${NC}"
  echo -e "${DIM}$(date)${NC}"
  echo -e "${DIM}Results: ${RESULTS_DIR}${NC}"

  # Pre-flight
  header "Pre-flight Checks"

  if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    fail "Namespace '${NAMESPACE}' does not exist"
    echo -e "\n${RED}CAIPE must be deployed before running tests.${NC}"
    exit 1
  fi
  pass "Namespace '${NAMESPACE}' exists"

  local pod_count
  pod_count=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | grep -c Running || echo "0")
  if [[ "$pod_count" -lt 1 ]]; then
    fail "No running pods in ${NAMESPACE}"
    exit 1
  fi
  pass "${pod_count} pods running in ${NAMESPACE}"

  if curl -sf "${SUPERVISOR_URL}/.well-known/agent.json" --max-time 5 >/dev/null 2>&1; then
    pass "Supervisor reachable at ${SUPERVISOR_URL}"
  else
    fail "Supervisor not reachable at ${SUPERVISOR_URL}"
    echo -e "\n${YELLOW}Ensure port-forward is active: kubectl port-forward -n caipe svc/caipe-supervisor-agent 8000:8000${NC}"
    exit 1
  fi

  # Detect Langfuse
  if detect_langfuse_keys; then
    pass "Langfuse credentials available"
  else
    skip "Langfuse credentials not found — trace checks will be skipped"
  fi

  # Detect RAG
  local rag_url
  rag_url=$(kubectl get deployment caipe-supervisor-agent -n "$NAMESPACE" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="RAG_SERVER_URL")].value}' 2>/dev/null || echo "")
  if [[ -n "$rag_url" ]]; then
    log "RAG is configured (${rag_url})"
    if ! $WITH_RAG; then
      log "Pass --with-rag to include RAG test prompts"
    fi
  fi

  # Run tests
  if [[ -n "$SINGLE_PROVIDER" ]]; then
    test_provider "$SINGLE_PROVIDER"
  elif $SKIP_SWITCH; then
    local current
    current=$(get_current_provider)
    log "Testing current provider only: ${current}"
    test_provider "$current"
  else
    # Test in recommended order: Claude (default) → Bedrock → OpenAI
    for p in anthropic-claude aws-bedrock openai; do
      test_provider "$p" || true
    done
  fi

  # ─── Summary ──────────────────────────────────────────────────────────
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════${NC}"
  echo -e "${BOLD}  Test Summary${NC}"
  echo -e "${BOLD}═══════════════════════════════════════${NC}"

  local total=$((TOTAL_PASS + TOTAL_FAIL + TOTAL_SKIP))
  echo -e "  ${GREEN}Passed:  ${TOTAL_PASS}${NC}"
  echo -e "  ${RED}Failed:  ${TOTAL_FAIL}${NC}"
  echo -e "  ${YELLOW}Skipped: ${TOTAL_SKIP}${NC}"
  echo -e "  Total:   ${total}"
  echo ""
  echo -e "  Results saved to: ${RESULTS_DIR}/"
  echo ""

  # Write summary file
  cat > "${RESULTS_DIR}/summary.txt" <<SUMMARY
CAIPE LLM Provider Integration Test Results
Date: $(date)
Pass: ${TOTAL_PASS}
Fail: ${TOTAL_FAIL}
Skip: ${TOTAL_SKIP}
Total: ${total}
SUMMARY

  if [[ $TOTAL_FAIL -gt 0 ]]; then
    exit 1
  fi
}

main "$@"

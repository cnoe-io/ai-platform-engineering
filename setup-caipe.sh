#!/usr/bin/env bash
set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
CAIPE_CHART_VERSION="${CAIPE_CHART_VERSION:-}"
CAIPE_OCI_REPO="oci://ghcr.io/cnoe-io/charts/ai-platform-engineering"
LANGFUSE_PORT=3100
SUPERVISOR_PORT=8000
UI_PORT=3000
RAG_SERVER_PORT=9446

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── State ───────────────────────────────────────────────────────────────────
CLUSTER_NAME=""
ENABLE_RAG=false
ENABLE_TRACING=false
ENABLE_PERSISTENCE=false
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
OPENAI_ENDPOINT="https://api.openai.com/v1"
OPENAI_MODEL_NAME="gpt-5.2"
LITELLM_ENDPOINT="${LITELLM_ENDPOINT:-}"
LITELLM_API_KEY="${LITELLM_API_KEY:-}"
LITELLM_MODEL_NAME="${LITELLM_MODEL_NAME:-gpt-oss-20B}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_MODEL_NAME="claude-haiku-4-5"
AWS_BEDROCK_MODEL_ID="${AWS_BEDROCK_MODEL_ID:-us.anthropic.claude-3-7-sonnet-20250219-v1:0}"
AWS_BEDROCK_PROVIDER="${AWS_BEDROCK_PROVIDER:-anthropic}"
AWS_REGION="${AWS_REGION:-us-east-2}"
AWS_PROFILE="${AWS_PROFILE:-}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
AWS_BEDROCK_ENABLE_PROMPT_CACHE="${AWS_BEDROCK_ENABLE_PROMPT_CACHE:-}"
LLM_PROVIDER="${LLM_PROVIDER:-anthropic-claude}"
EMBEDDINGS_MODEL="${EMBEDDINGS_MODEL:-text-embedding-3-large}"
EMBEDDINGS_PROVIDER="${EMBEDDINGS_PROVIDER:-openai}"
ENABLE_GRAPH_RAG=false
ENABLE_VLLM="${ENABLE_VLLM:-false}"
ENABLE_AGENTGATEWAY="${ENABLE_AGENTGATEWAY:-false}"
VLLM_MODEL="${VLLM_MODEL:-openai/gpt-oss-20b}"
VLLM_GPU_COUNT="${VLLM_GPU_COUNT:-1}"
HF_TOKEN="${HF_TOKEN:-}"
AGENTGATEWAY_VERSION="${AGENTGATEWAY_VERSION:-v2.2.1}"
AGENTGATEWAY_PORT=8080
INJECT_CORPORATE_CA=false
CA_SSL_FIX_PROMPTED=false
SUPERVISOR_RAG_RESTARTED=false
LANGFUSE_PUBLIC_KEY=""
LANGFUSE_SECRET_KEY=""
PF_PIDS=()
AUTO_YES=false
NON_INTERACTIVE=false
CREATE_CLUSTER=false
FORCE_UPGRADE=false
INGEST_URLS=()

# When run via "curl | bash", stdin is the script content — bash reads it
# line-by-line. We CANNOT redirect stdin (exec < /dev/tty) because that
# would stop bash from reading the rest of the script.  Instead, open
# /dev/tty on fd 3 and redirect all interactive `read` calls to <&3.
_tty_fd_opened=false
{ exec 3</dev/tty; _tty_fd_opened=true; } 2>/dev/null || true
if ! $_tty_fd_opened; then
  if [[ -t 0 ]]; then
    exec 3<&0
  else
    echo "ERROR: no terminal available for interactive prompts." >&2
    echo "  Run with --non-interactive or use: bash -c \"\$(curl -fsSL URL)\"" >&2
    exit 1
  fi
fi

cleanup_on_exit() {
  # Kill tracked PIDs
  for pid in "${PF_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  # Fallback: kill any kubectl port-forward processes started for our services
  pkill -f "kubectl port-forward.*caipe-supervisor-agent.*${SUPERVISOR_PORT:-8000}:8000" 2>/dev/null || true
  pkill -f "kubectl port-forward.*caipe-caipe-ui.*${UI_PORT:-3000}:3000" 2>/dev/null || true
  pkill -f "kubectl port-forward.*langfuse-web.*${LANGFUSE_PORT:-3100}:3000" 2>/dev/null || true
  rm -f /tmp/langfuse-cookies /tmp/caipe-validation-*.log
  exec 3<&- 2>/dev/null || true
}
trap cleanup_on_exit EXIT
trap 'cleanup_on_exit; exit 130' INT
trap 'cleanup_on_exit; exit 143' TERM

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()     { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  !${NC} $*"; }
err()     { echo -e "${RED}  ✗${NC} $*" >&2; }
step()    { echo -e "\n${CYAN}${BOLD}━━━ $* ━━━${NC}"; }
header()  { echo -e "\n${BLUE}${BOLD}$*${NC}"; }
prompt()  { echo -en "${BOLD}  ▸ $*${NC}"; }

# Interactive read wrapper — reads from /dev/tty (fd 3) so that
# "curl | bash" keeps reading the script from stdin while prompts
# go to the terminal.  Passes all arguments through to `read`.
tty_read() { read "$@" <&3; }

ask_yn() {
  local question="$1" default="${2:-y}"
  if $AUTO_YES; then return 0; fi
  local yn_hint
  if [[ "$default" == "y" ]]; then yn_hint="${CYAN}[Y/n]${NC}${BOLD}"; else yn_hint="${CYAN}[y/N]${NC}${BOLD}"; fi
  prompt "$question $yn_hint "
  tty_read -r answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy]$ ]]
}

wait_for_pods() {
  local ns="$1" timeout="${2:-300}" exclude_pattern="${3:-}" interval=5 elapsed=0
  local show_interval=10 next_show=10
  local log_check_after=20 log_check_interval=15 next_log_check=0
  local exclude_awk=""
  local prev_lines=0
  [[ -n "$exclude_pattern" ]] && exclude_awk="/$exclude_pattern/ {next} "

  # Helper: clear the in-place table and reset prev_lines
  _wfp_clear_table() {
    if [[ $prev_lines -gt 0 ]]; then
      printf '\033[%dA' "$prev_lines"
      for (( _cl=0; _cl<prev_lines; _cl++ )); do printf '\033[K\n'; done
      printf '\033[%dA' "$prev_lines"
      prev_lines=0
    fi
  }

  while [[ $elapsed -lt $timeout ]]; do
    local total ready
    total=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
      | awk "${exclude_awk}"'$3!="Terminating" {print}' | wc -l | tr -d ' ')
    ready=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
      | awk "${exclude_awk}"'$3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
      | wc -l | tr -d ' ')
    if [[ "$total" -gt 0 && "$total" -eq "$ready" ]]; then
      _wfp_clear_table
      log "All $total pods in ${ns} are running"
      return 0
    fi

    if [[ $elapsed -ge $next_show ]]; then
      # Move cursor up to overwrite previous table
      if [[ $prev_lines -gt 0 ]]; then
        printf '\033[%dA' "$prev_lines"
      fi

      local -a table_lines=()
      table_lines+=("$(printf "${DIM}  Waiting for pods in %-10s  %d/%d ready  (%ds)${NC}" "$ns" "$ready" "$total" "$elapsed")")
      table_lines+=("$(printf "  ${DIM}── Pod status in ${ns} ──${NC}")")
      while IFS= read -r line; do
        table_lines+=("$line")
      done < <(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
        | awk -v g="${GREEN}" -v r="${RED}" -v y="${YELLOW}" -v nc="${NC}" \
          '{
            status=$3; name=$1; ready=$2
            if (status=="Running" && ready~"^[0-9]+/[0-9]+$") {
              split(ready,a,"/"); if(a[1]==a[2]) c=g; else c=y
            } else if (status=="Error" || status=="CrashLoopBackOff" || status=="Terminating") c=r
            else c=y
            printf "    %s%-44s %-6s %s%s\n", c, name, ready, status, nc
          }')
      table_lines+=("")

      for tl in "${table_lines[@]}"; do
        printf '\033[K%s\n' "$tl"
      done

      prev_lines=${#table_lines[@]}
      next_show=$((elapsed + show_interval))
    else
      printf "\r\033[K${DIM}  Waiting for pods in %-10s  %d/%d ready  (%ds)${NC}" "$ns" "$ready" "$total" "$elapsed"
    fi

    # Periodically check unhealthy pod logs for actionable errors
    if [[ $elapsed -ge $log_check_after && $elapsed -ge $next_log_check ]]; then
      next_log_check=$((elapsed + log_check_interval))

      # All non-ready pods (crashed, errored, or running with partial readiness)
      local unhealthy_pods
      unhealthy_pods=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
        | awk '$3=="CrashLoopBackOff" || $3=="Error" {print $1}
               $3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]<a[2]) print $1}')

      for pod in $unhealthy_pods; do
        local pod_logs
        pod_logs=$(kubectl logs "$pod" -n "$ns" --all-containers --tail=200 2>/dev/null || true)
        [[ -z "$pod_logs" ]] && continue

        # SSL certificate errors → offer corporate CA
        if ! $INJECT_CORPORATE_CA && ! $CA_SSL_FIX_PROMPTED \
           && echo "$pod_logs" | grep -q "CERTIFICATE_VERIFY_FAILED\|SSLCertVerificationError"; then
          _wfp_clear_table
          _auto_heal_offer_corporate_ca "$pod (in ${ns})"
          if $INJECT_CORPORATE_CA; then
            log "[auto-heal] Corporate CA patched; pods will restart"
            sleep 5
          fi
          break
        fi

        # Supervisor stuck connecting to RAG → restart if RAG is ready
        if ! $SUPERVISOR_RAG_RESTARTED && $ENABLE_RAG \
           && echo "$pod" | grep -q "supervisor" \
           && echo "$pod_logs" | grep -q "RAG server connection attempt.*failed\|Connection refused"; then
          local rag_ok
          rag_ok=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
            | awk '/rag-server/ && $3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print "yes"}' | head -1)
          if [[ "$rag_ok" == "yes" ]]; then
            _wfp_clear_table
            warn "[auto-heal] Supervisor stuck connecting to RAG; restarting"
            kubectl rollout restart deployment/caipe-supervisor-agent -n "$ns" &>/dev/null || true
            SUPERVISOR_RAG_RESTARTED=true
            log "[auto-heal] Supervisor restarted to reconnect to RAG"
            sleep 5
          fi
        fi
      done
    fi

    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  _wfp_clear_table
  echo ""
  err "Timeout waiting for pods in ${ns} after ${timeout}s"
  kubectl get pods -n "$ns"
  return 1
}

kill_port_on() {
  local port="$1"
  local pid
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
}

# ─── Interactive Setup ───────────────────────────────────────────────────────
check_prerequisites() {
  step "Checking prerequisites"
  local missing=()
  for cmd in kubectl helm openssl curl jq; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    err "Missing required tools: ${missing[*]}"
    err "Install them and re-run this script."
    exit 1
  fi
  if ! command -v kind &>/dev/null; then
    warn "kind not found — Kind cluster options will be unavailable"
  fi
  log "Prerequisites checked (kubectl, helm, openssl, curl, jq)"
}

choose_cluster() {
  step "Kubernetes cluster"

  local current_ctx
  current_ctx=$(kubectl config current-context 2>/dev/null || echo "")

  if $NON_INTERACTIVE; then
    if [[ -z "$current_ctx" ]]; then
      if $CREATE_CLUSTER; then
        if ! command -v kind &>/dev/null; then
          err "kind is required with --create-cluster but not found"
          exit 1
        fi
        CLUSTER_NAME="${KIND_CLUSTER_NAME:-caipe}"
        log "No kubectl context — creating Kind cluster '${CLUSTER_NAME}'..."
        kind create cluster --name "$CLUSTER_NAME"
        kubectl config use-context "kind-${CLUSTER_NAME}" &>/dev/null
        log "Context set to kind-${CLUSTER_NAME}"
      else
        err "No current kubectl context. Pass --create-cluster to auto-create a Kind cluster."
        exit 1
      fi
    else
      CLUSTER_NAME="$current_ctx"
      log "Using current context '${current_ctx}'"
    fi
    if ! kubectl cluster-info &>/dev/null; then
      err "Cannot reach the Kubernetes cluster. Check your configuration."
      exit 1
    fi
    log "Cluster is reachable"
    return
  fi

  # Build the menu options
  local options=()
  local labels=()

  # Option: use current context
  if [[ -n "$current_ctx" ]]; then
    options+=("current")
    labels+=("Use current context: ${current_ctx}")
  fi

  # Options: existing Kind clusters
  local kind_clusters=()
  if command -v kind &>/dev/null; then
    while IFS= read -r c; do
      [[ -n "$c" ]] && kind_clusters+=("$c")
    done < <(kind get clusters 2>/dev/null)

    for c in "${kind_clusters[@]}"; do
      options+=("kind:${c}")
      if [[ "kind-${c}" == "$current_ctx" ]]; then
        labels+=("Kind cluster: ${c}  ${DIM}(current context)${NC}")
      else
        labels+=("Kind cluster: ${c}")
      fi
    done

    options+=("kind:new")
    labels+=("Create a new Kind cluster")
  fi

  # Option: switch to another kubectl context
  options+=("context")
  labels+=("Use a different kubectl context")

  echo ""
  local i=1
  for label in "${labels[@]}"; do
    echo -e "    ${BOLD}${i})${NC} ${label}"
    i=$((i + 1))
  done
  echo ""

  local default_choice=1
  prompt "Select an option ${CYAN}[${default_choice}]${NC}${BOLD}: "
  tty_read -r choice
  choice="${choice:-$default_choice}"

  if [[ "$choice" -lt 1 || "$choice" -gt "${#options[@]}" ]]; then
    err "Invalid choice"
    exit 1
  fi

  local selected="${options[$((choice - 1))]}"

  case "$selected" in
    current)
      CLUSTER_NAME="$current_ctx"
      log "Using current context '${current_ctx}'"
      ;;
    kind:new)
      prompt "Enter a name for the new cluster ${CYAN}[caipe]${NC}${BOLD}: "
      tty_read -r CLUSTER_NAME
      CLUSTER_NAME="${CLUSTER_NAME:-caipe}"
      log "Creating Kind cluster '${CLUSTER_NAME}'..."
      kind create cluster --name "$CLUSTER_NAME"
      kubectl config use-context "kind-${CLUSTER_NAME}" &>/dev/null
      log "Context set to kind-${CLUSTER_NAME}"
      ;;
    kind:*)
      CLUSTER_NAME="${selected#kind:}"
      kubectl config use-context "kind-${CLUSTER_NAME}" &>/dev/null
      log "Context set to kind-${CLUSTER_NAME}"
      ;;
    context)
      echo ""
      echo -e "  ${DIM}Available kubectl contexts:${NC}"
      local ctx_arr=()
      while IFS= read -r ctx; do
        [[ -n "$ctx" ]] && ctx_arr+=("$ctx")
      done < <(kubectl config get-contexts -o name 2>/dev/null)

      local j=1
      for ctx in "${ctx_arr[@]}"; do
        if [[ "$ctx" == "$current_ctx" ]]; then
          echo -e "    ${BOLD}${j})${NC} ${ctx}  ${DIM}(current)${NC}"
        else
          echo -e "    ${BOLD}${j})${NC} ${ctx}"
        fi
        j=$((j + 1))
      done
      echo ""
      prompt "Select a context ${CYAN}[1]${NC}${BOLD}: "
      tty_read -r ctx_choice
      ctx_choice="${ctx_choice:-1}"
      if [[ "$ctx_choice" -ge 1 && "$ctx_choice" -le "${#ctx_arr[@]}" ]]; then
        local target_ctx="${ctx_arr[$((ctx_choice - 1))]}"
        kubectl config use-context "$target_ctx" &>/dev/null
        CLUSTER_NAME="$target_ctx"
        log "Switched to context '${target_ctx}'"
      else
        err "Invalid choice"
        exit 1
      fi
      ;;
  esac

  # Verify cluster is reachable
  if ! kubectl cluster-info &>/dev/null; then
    err "Cannot reach the Kubernetes cluster. Check your configuration."
    exit 1
  fi
  log "Cluster is reachable"
}

choose_chart_version() {
  step "CAIPE Helm chart version"

  if [[ -n "$CAIPE_CHART_VERSION" ]]; then
    log "Using version from environment: ${CAIPE_CHART_VERSION}"
    return
  fi

  if $NON_INTERACTIVE; then
    local latest
    latest=$(helm show chart "$CAIPE_OCI_REPO" 2>/dev/null | grep '^version:' | awk '{print $2}' || true)
    CAIPE_CHART_VERSION="${latest:-0.2.31}"
    log "Using latest version: ${CAIPE_CHART_VERSION}"
    return
  fi

  echo -e "  ${DIM}Fetching available versions from OCI registry...${NC}"
  local versions_raw
  versions_raw=$(helm show chart "$CAIPE_OCI_REPO" 2>/dev/null | grep '^version:' | awk '{print $2}' || true)

  # Try to list tags via skopeo or crane if available, otherwise fall back
  local versions=()
  if command -v crane &>/dev/null; then
    while IFS= read -r v; do
      [[ -n "$v" ]] && versions+=("$v")
    done < <(crane ls ghcr.io/cnoe-io/charts/ai-platform-engineering 2>/dev/null | sort -Vr | head -10)
  fi

  if [[ ${#versions[@]} -eq 0 && -n "$versions_raw" ]]; then
    versions+=("$versions_raw")
  fi

  if [[ ${#versions[@]} -eq 0 ]]; then
    versions+=("0.2.31")
    warn "Could not fetch version list; using known default"
  fi

  if [[ ${#versions[@]} -eq 1 ]]; then
    echo -e "  ${DIM}Latest version: ${versions[0]}${NC}"
    prompt "Chart version ${CYAN}[${versions[0]}]${NC}${BOLD}: "
    tty_read -r input
    CAIPE_CHART_VERSION="${input:-${versions[0]}}"
  else
    echo -e "  ${DIM}Available versions (most recent first):${NC}"
    local i=1
    for v in "${versions[@]}"; do
      if [[ $i -eq 1 ]]; then
        echo -e "    ${BOLD}${i})${NC} $v  ${DIM}(latest)${NC}"
      else
        echo -e "    ${BOLD}${i})${NC} $v"
      fi
      i=$((i + 1))
    done
    echo -e "    ${BOLD}${i})${NC} Enter a custom version"

    prompt "Select a version ${CYAN}[1]${NC}${BOLD}: "
    tty_read -r choice
    choice="${choice:-1}"

    if [[ "$choice" -eq "$i" ]]; then
      prompt "Enter chart version: "
      tty_read -r CAIPE_CHART_VERSION
      if [[ -z "$CAIPE_CHART_VERSION" ]]; then
        err "Version is required"
        exit 1
      fi
    elif [[ "$choice" -ge 1 && "$choice" -lt "$i" ]]; then
      CAIPE_CHART_VERSION="${versions[$((choice - 1))]}"
    else
      err "Invalid choice"
      exit 1
    fi
  fi

  log "Using chart version ${CAIPE_CHART_VERSION}"
}

collect_credentials() {
  step "LLM credentials"

  # ── Provider selection ───────────────────────────────────────────────
  # cnoe-agent-utils LLMFactory supports: openai, anthropic-claude,
  # azure-openai, aws-bedrock, google-gemini, gcp-vertexai, groq
  # LiteLLM proxies present an OpenAI-compatible API, so we use LLM_PROVIDER=openai.
  if ! $NON_INTERACTIVE; then
    echo ""
    echo -e "  ${DIM}Select your LLM provider (powered by cnoe-agent-utils LLMFactory):${NC}"
    echo -e "    ${BOLD}1) Anthropic Claude  (claude-haiku-4-5, claude-sonnet-4, etc.) — recommended${NC}"
    echo -e "    ${BOLD}2)${NC} AWS Bedrock       ${DIM}(Claude on Bedrock, cross-region inference)${NC}"
    echo -e "    ${BOLD}3)${NC} OpenAI            ${DIM}(gpt-5.2, gpt-4.1, etc.)${NC}"
    echo -e "    ${BOLD}4)${NC} LiteLLM Proxy     ${DIM}(gpt-oss-20B or any OpenAI-compatible endpoint)${NC}"
    echo ""
    prompt "Select provider ${CYAN}[1]${NC}${BOLD}: "
    tty_read -r provider_choice
    provider_choice="${provider_choice:-1}"
    case "$provider_choice" in
      1) LLM_PROVIDER="anthropic-claude" ;;
      2) LLM_PROVIDER="aws-bedrock" ;;
      3) LLM_PROVIDER="openai" ;;
      4) ENABLE_VLLM=true; LLM_PROVIDER="openai" ;;
      *) err "Invalid choice"; exit 1 ;;
    esac
  fi

  # If ENABLE_VLLM was set via env or option 4, collect vLLM-specific config
  # then fall through to the openai credentials path (LiteLLM is OpenAI-compat)
  if $ENABLE_VLLM; then
    LLM_PROVIDER="openai"
    _collect_vllm_credentials
  fi

  # ── Collect credentials per provider ─────────────────────────────────
  case "$LLM_PROVIDER" in
    anthropic-claude)
      _collect_anthropic_credentials
      ;;
    aws-bedrock)
      _collect_bedrock_credentials
      ;;
    *)
      _collect_openai_credentials
      ;;
  esac
}

_collect_anthropic_credentials() {
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    log "Using ANTHROPIC_API_KEY from environment"
  elif [[ -f "${HOME}/.config/claude.txt" ]]; then
    ANTHROPIC_API_KEY=$(tr -d '[:space:]' < "${HOME}/.config/claude.txt")
    log "Using ANTHROPIC_API_KEY from ~/.config/claude.txt"
  else
    if $NON_INTERACTIVE; then
      err "Anthropic API key is required (set ANTHROPIC_API_KEY or create ~/.config/claude.txt)"
      exit 1
    fi
    prompt "Enter your Anthropic API key: "
    tty_read -rs ANTHROPIC_API_KEY
    echo ""
    if [[ -z "$ANTHROPIC_API_KEY" ]]; then
      err "API key is required"
      exit 1
    fi
    log "API key received"
  fi

  if ! $NON_INTERACTIVE; then
    echo ""
    echo -e "  ${DIM}Anthropic model:${NC}"
    echo -e "    ${BOLD}1)${NC} claude-haiku-4-5     ${DIM}(fast, low cost — default)${NC}"
    echo -e "    ${BOLD}2)${NC} claude-sonnet-4-20250514    ${DIM}(balanced)${NC}"
    echo -e "    ${BOLD}3)${NC} claude-opus-4-20250514      ${DIM}(most capable)${NC}"
    echo -e "    ${BOLD}4)${NC} Custom"
    echo ""
    prompt "Select model ${CYAN}[1]${NC}${BOLD}: "
    tty_read -r model_choice
    model_choice="${model_choice:-1}"
    case "$model_choice" in
      1) ANTHROPIC_MODEL_NAME="claude-haiku-4-5" ;;
      2) ANTHROPIC_MODEL_NAME="claude-sonnet-4-20250514" ;;
      3) ANTHROPIC_MODEL_NAME="claude-opus-4-20250514" ;;
      4)
        prompt "Enter Anthropic model name: "
        tty_read -r ANTHROPIC_MODEL_NAME
        if [[ -z "$ANTHROPIC_MODEL_NAME" ]]; then
          err "Model name is required"
          exit 1
        fi
        ;;
      *) err "Invalid choice"; exit 1 ;;
    esac
  fi
  log "Provider: ${LLM_PROVIDER}  Model: ${ANTHROPIC_MODEL_NAME}"
}

_resolve_aws_keys_from_profile() {
  # Extract access keys from ~/.aws/credentials for a given profile.
  # In-cluster pods can't use profiles, so we resolve to actual keys.
  local profile="${1:-default}"
  local creds_file="${HOME}/.aws/credentials"

  if [[ ! -f "$creds_file" ]]; then
    return 1
  fi

  local in_profile=false
  while IFS= read -r line; do
    line="${line%%#*}"        # strip comments
    line="${line// /}"        # strip spaces
    [[ -z "$line" ]] && continue

    if [[ "$line" =~ ^\[(.+)\]$ ]]; then
      [[ "${BASH_REMATCH[1]}" == "$profile" ]] && in_profile=true || in_profile=false
      continue
    fi
    if $in_profile; then
      case "$line" in
        aws_access_key_id=*)     AWS_ACCESS_KEY_ID="${line#*=}" ;;
        aws_secret_access_key=*) AWS_SECRET_ACCESS_KEY="${line#*=}" ;;
      esac
    fi
  done < "$creds_file"

  [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]
}

_parse_bedrock_txt() {
  # Parse ~/.config/bedrock.txt which can be in three formats:
  #
  #   Format A — .env style (KEY=VALUE per line):
  #     AWS_ACCESS_KEY_ID=AKIA...
  #     AWS_SECRET_ACCESS_KEY=...
  #     AWS_REGION=us-east-2
  #     AWS_BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
  #
  #   Format B — key:secret pair (single line):
  #     AKIAEXAMPLE:wJalrXUtnFEMI/K7MDENG
  #
  #   Format C — profile name (single line):
  #     my-profile-name

  local file="$1"
  local line_count key_found=false

  line_count=$(grep -cve '^\s*$' "$file" 2>/dev/null || echo 0)

  # Multi-line or contains '=' → .env format
  if [[ "$line_count" -gt 1 ]] || grep -q '=' "$file" 2>/dev/null; then
    log "Parsing ~/.config/bedrock.txt (.env format)"
    while IFS= read -r line; do
      line="${line%%#*}"                     # strip inline comments
      [[ -z "${line// /}" ]] && continue     # skip blank lines
      [[ "$line" != *=* ]] && continue       # skip non-assignment lines

      local k="${line%%=*}"
      local v="${line#*=}"
      v="${v%\"}"; v="${v#\"}"               # strip surrounding quotes

      case "$k" in
        AWS_ACCESS_KEY_ID)       AWS_ACCESS_KEY_ID="$v";       key_found=true ;;
        AWS_SECRET_ACCESS_KEY)   AWS_SECRET_ACCESS_KEY="$v"    ;;
        AWS_REGION)              AWS_REGION="$v"               ;;
        AWS_DEFAULT_REGION)      [[ -z "${AWS_REGION:-}" || "$AWS_REGION" == "us-east-2" ]] && AWS_REGION="$v" ;;
        AWS_BEDROCK_MODEL_ID)    AWS_BEDROCK_MODEL_ID="${v}"   ;;
        AWS_BEDROCK_PROVIDER)    AWS_BEDROCK_PROVIDER="$v"     ;;
        AWS_BEDROCK_ENABLE_PROMPT_CACHE) AWS_BEDROCK_ENABLE_PROMPT_CACHE="$v" ;;
        LLM_PROVIDER)            LLM_PROVIDER="$v"            ;;
      esac
    done < "$file"

    if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
      log "Using AWS access keys from ~/.config/bedrock.txt"
    else
      err "~/.config/bedrock.txt is missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY"
      exit 1
    fi
    return
  fi

  # Single line — key:secret or profile name
  local bedrock_val
  bedrock_val=$(tr -d '[:space:]' < "$file")

  if [[ "$bedrock_val" == *:* ]]; then
    AWS_ACCESS_KEY_ID="${bedrock_val%%:*}"
    AWS_SECRET_ACCESS_KEY="${bedrock_val#*:}"
    log "Using AWS access keys from ~/.config/bedrock.txt"
  else
    log "Resolving AWS profile '${bedrock_val}' from ~/.config/bedrock.txt"
    if _resolve_aws_keys_from_profile "$bedrock_val"; then
      log "Resolved access keys from profile '${bedrock_val}'"
    else
      err "Could not resolve AWS keys from profile '${bedrock_val}' in ~/.aws/credentials"
      exit 1
    fi
  fi
}

_collect_bedrock_credentials() {
  # AWS Bedrock needs access keys in the K8s secret (pods can't use local
  # profiles). We resolve keys from multiple sources in priority order:
  #
  #   1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars
  #   2. ~/.config/bedrock.txt  — .env format, key:secret pair, or profile name
  #   3. AWS_PROFILE env → resolve keys from ~/.aws/credentials
  #   4. Default profile in ~/.aws/credentials
  #   5. Interactive prompt

  if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    log "Using AWS access keys from environment"

  elif [[ -f "${HOME}/.config/bedrock.txt" ]]; then
    _parse_bedrock_txt "${HOME}/.config/bedrock.txt"

  elif [[ -n "${AWS_PROFILE:-}" ]]; then
    log "Resolving AWS_PROFILE=${AWS_PROFILE} from ~/.aws/credentials"
    if _resolve_aws_keys_from_profile "$AWS_PROFILE"; then
      log "Resolved access keys from profile '${AWS_PROFILE}'"
    else
      err "Could not resolve AWS keys from profile '${AWS_PROFILE}'"
      exit 1
    fi

  elif _resolve_aws_keys_from_profile "default"; then
    log "Using default AWS credentials from ~/.aws/credentials"

  else
    if $NON_INTERACTIVE; then
      err "AWS credentials required. Options:"
      err "  - Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars"
      err "  - Create ~/.config/bedrock.txt with ACCESS_KEY:SECRET_KEY"
      err "  - Create ~/.config/bedrock.txt with a profile name"
      err "  - Set AWS_PROFILE env var (requires ~/.aws/credentials)"
      err "  - Ensure a [default] profile exists in ~/.aws/credentials"
      exit 1
    fi

    echo ""
    echo -e "  ${DIM}AWS Bedrock authentication (keys will be stored in the K8s secret):${NC}"
    echo -e "    ${BOLD}1)${NC} Enter access key + secret key directly"
    echo -e "    ${BOLD}2)${NC} Read from an AWS profile ${DIM}(~/.aws/credentials)${NC}"
    echo ""
    prompt "Select auth method ${CYAN}[1]${NC}${BOLD}: "
    tty_read -r auth_choice
    auth_choice="${auth_choice:-1}"
    case "$auth_choice" in
      1)
        prompt "AWS Access Key ID: "
        tty_read -r AWS_ACCESS_KEY_ID
        prompt "AWS Secret Access Key: "
        tty_read -rs AWS_SECRET_ACCESS_KEY
        echo ""
        if [[ -z "$AWS_ACCESS_KEY_ID" || -z "$AWS_SECRET_ACCESS_KEY" ]]; then
          err "Both access key and secret key are required"
          exit 1
        fi
        log "AWS access keys received"
        ;;
      2)
        prompt "AWS profile name ${CYAN}[default]${NC}${BOLD}: "
        tty_read -r input
        local prof="${input:-default}"
        if _resolve_aws_keys_from_profile "$prof"; then
          log "Resolved access keys from profile '${prof}'"
        else
          err "Could not resolve AWS keys from profile '${prof}' in ~/.aws/credentials"
          exit 1
        fi
        ;;
      *) err "Invalid choice"; exit 1 ;;
    esac
  fi

  if ! $NON_INTERACTIVE; then
    prompt "AWS region ${CYAN}[${AWS_REGION}]${NC}${BOLD}: "
    tty_read -r input
    AWS_REGION="${input:-$AWS_REGION}"

    echo ""
    echo -e "  ${DIM}Bedrock model:${NC}"
    echo -e "    ${BOLD}1)${NC} us.anthropic.claude-3-7-sonnet-20250219-v1:0  ${DIM}(default)${NC}"
    echo -e "    ${BOLD}2)${NC} us.anthropic.claude-sonnet-4-20250514-v1:0"
    echo -e "    ${BOLD}3)${NC} us.anthropic.claude-haiku-4-20250414-v1:0     ${DIM}(fast, low cost)${NC}"
    echo -e "    ${BOLD}4)${NC} Custom"
    echo ""
    prompt "Select model ${CYAN}[1]${NC}${BOLD}: "
    tty_read -r model_choice
    model_choice="${model_choice:-1}"
    case "$model_choice" in
      1) AWS_BEDROCK_MODEL_ID="us.anthropic.claude-3-7-sonnet-20250219-v1:0" ;;
      2) AWS_BEDROCK_MODEL_ID="us.anthropic.claude-sonnet-4-20250514-v1:0" ;;
      3) AWS_BEDROCK_MODEL_ID="us.anthropic.claude-haiku-4-20250414-v1:0" ;;
      4)
        prompt "Enter Bedrock model ID: "
        tty_read -r AWS_BEDROCK_MODEL_ID
        if [[ -z "$AWS_BEDROCK_MODEL_ID" ]]; then
          err "Model ID is required"
          exit 1
        fi
        ;;
      *) err "Invalid choice"; exit 1 ;;
    esac

    prompt "Bedrock provider ${CYAN}[${AWS_BEDROCK_PROVIDER}]${NC}${BOLD}: "
    tty_read -r input
    AWS_BEDROCK_PROVIDER="${input:-$AWS_BEDROCK_PROVIDER}"
  fi
  log "Provider: ${LLM_PROVIDER}  Region: ${AWS_REGION}  Model: ${AWS_BEDROCK_MODEL_ID}"
}

_collect_openai_credentials() {
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    log "Using OPENAI_API_KEY from environment"
  elif [[ -f "${HOME}/.config/openai.txt" ]]; then
    OPENAI_API_KEY=$(tr -d '[:space:]' < "${HOME}/.config/openai.txt")
    log "Using OPENAI_API_KEY from ~/.config/openai.txt"
  else
    if $NON_INTERACTIVE; then
      err "API key is required (set OPENAI_API_KEY or create ~/.config/openai.txt)"
      exit 1
    fi
    prompt "Enter your OpenAI API key: "
    tty_read -rs OPENAI_API_KEY
    echo ""
    if [[ -z "$OPENAI_API_KEY" ]]; then
      err "API key is required"
      exit 1
    fi
    log "API key received"
  fi

  if ! $NON_INTERACTIVE; then
    prompt "OpenAI endpoint ${CYAN}[${OPENAI_ENDPOINT}]${NC}${BOLD}: "
    tty_read -r input
    OPENAI_ENDPOINT="${input:-$OPENAI_ENDPOINT}"

    prompt "Model name ${CYAN}[${OPENAI_MODEL_NAME}]${NC}${BOLD}: "
    tty_read -r input
    OPENAI_MODEL_NAME="${input:-$OPENAI_MODEL_NAME}"
  fi
  log "Provider: ${LLM_PROVIDER}  Endpoint: ${OPENAI_ENDPOINT}  Model: ${OPENAI_MODEL_NAME}"
}

_collect_vllm_credentials() {
  # vLLM + LiteLLM: we deploy both in-cluster. vLLM serves the model,
  # LiteLLM proxies it as an OpenAI-compatible endpoint for CAIPE.
  # LLM_PROVIDER is already set to "openai" by the caller.

  # Collect HuggingFace token (needed by vLLM to download model weights)
  if [[ -n "${HF_TOKEN:-}" ]]; then
    log "Using HF_TOKEN from environment"
  elif [[ -f "${HOME}/.config/hf_token.txt" ]]; then
    HF_TOKEN=$(tr -d '[:space:]' < "${HOME}/.config/hf_token.txt")
    log "Using HF_TOKEN from ~/.config/hf_token.txt"
  elif [[ -f "${HOME}/.cache/huggingface/token" ]]; then
    HF_TOKEN=$(tr -d '[:space:]' < "${HOME}/.cache/huggingface/token")
    log "Using HF_TOKEN from ~/.cache/huggingface/token"
  else
    if $NON_INTERACTIVE; then
      warn "HF_TOKEN not set — vLLM may fail to download gated models"
    else
      echo ""
      echo -e "  ${DIM}vLLM needs a HuggingFace token to download model weights.${NC}"
      echo -e "  ${DIM}Get one at https://huggingface.co/settings/tokens${NC}"
      prompt "HuggingFace token ${DIM}(leave blank for public models)${NC}${BOLD}: "
      tty_read -rs HF_TOKEN
      echo ""
    fi
  fi

  if ! $NON_INTERACTIVE; then
    prompt "vLLM model ${CYAN}[${VLLM_MODEL}]${NC}${BOLD}: "
    tty_read -r input
    VLLM_MODEL="${input:-$VLLM_MODEL}"

    prompt "LiteLLM model name ${CYAN}[${LITELLM_MODEL_NAME}]${NC}${BOLD}: "
    tty_read -r input
    LITELLM_MODEL_NAME="${input:-$LITELLM_MODEL_NAME}"
  fi

  # Auto-configure in-cluster endpoints (deployed by deploy_vllm / deploy_litellm)
  LITELLM_ENDPOINT="http://litellm-proxy.caipe.svc.cluster.local:4000/v1"
  LITELLM_API_KEY="not-needed"

  # Pre-set OpenAI env vars so _collect_openai_credentials finds them
  OPENAI_ENDPOINT="${LITELLM_ENDPOINT}"
  OPENAI_API_KEY="${LITELLM_API_KEY}"
  OPENAI_MODEL_NAME="${LITELLM_MODEL_NAME}"

  EMBEDDINGS_PROVIDER="litellm"

  log "Provider: openai (via LiteLLM proxy)  Model: ${LITELLM_MODEL_NAME}"
  log "vLLM will serve ${VLLM_MODEL} in-cluster"
  log "Embeddings will also use LiteLLM proxy"
}

_collect_openai_embeddings_key() {
  # When using a non-OpenAI LLM provider with OpenAI embeddings, the RAG
  # server still needs an OPENAI_API_KEY. Collect it here.
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    log "Using OPENAI_API_KEY for embeddings (from environment)"
    return
  fi
  if [[ -f "${HOME}/.config/openai.txt" ]]; then
    OPENAI_API_KEY=$(tr -d '[:space:]' < "${HOME}/.config/openai.txt")
    log "Using OPENAI_API_KEY for embeddings (from ~/.config/openai.txt)"
    return
  fi
  if $NON_INTERACTIVE; then
    err "RAG with OpenAI embeddings requires OPENAI_API_KEY (set env var or create ~/.config/openai.txt)"
    exit 1
  fi
  echo ""
  echo -e "  ${DIM}RAG embeddings use OpenAI, but your LLM provider is ${BOLD}${LLM_PROVIDER}${NC}${DIM}.${NC}"
  echo -e "  ${DIM}An OpenAI API key is needed for the embeddings model.${NC}"
  prompt "Enter your OpenAI API key (for embeddings): "
  tty_read -rs OPENAI_API_KEY
  echo ""
  if [[ -z "$OPENAI_API_KEY" ]]; then
    err "OpenAI API key is required for embeddings"
    exit 1
  fi
  log "OpenAI API key received (for embeddings)"
}

choose_features() {
  step "Feature selection"

  echo -e "  ${DIM}Base setup always includes: supervisor, weather, and NetUtils agents${NC}"

  if $NON_INTERACTIVE; then
    if $ENABLE_RAG; then
      log "RAG enabled (--rag)"
      $ENABLE_GRAPH_RAG && log "Graph RAG enabled (--graph-rag)" || log "Graph RAG disabled (pass --graph-rag to enable)"
      if [[ "$EMBEDDINGS_PROVIDER" == "openai" && "$LLM_PROVIDER" != "openai" ]]; then
        _collect_openai_embeddings_key
      fi
    else
      log "RAG skipped (pass --rag to enable)"
    fi
    $ENABLE_TRACING && log "Tracing enabled (--tracing)" || log "Tracing skipped (pass --tracing to enable)"
    $ENABLE_AGENTGATEWAY && log "AgentGateway enabled (--agentgateway)" || log "AgentGateway skipped (pass --agentgateway to enable)"
    $ENABLE_PERSISTENCE && log "Redis persistence enabled (--persistence)" || log "Persistence skipped (pass --persistence to enable)"
    return
  fi

  echo ""

  if ask_yn "Enable RAG (knowledge base retrieval)?" "n"; then
    ENABLE_RAG=true
    log "RAG enabled"

    prompt "Embeddings provider ${CYAN}[${EMBEDDINGS_PROVIDER}]${NC}${BOLD}: "
    tty_read -r input
    EMBEDDINGS_PROVIDER="${input:-$EMBEDDINGS_PROVIDER}"

    echo ""
    echo -e "  ${DIM}Embeddings model:${NC}"
    echo -e "    ${BOLD}1)${NC} text-embedding-3-large  ${DIM}(default, higher quality)${NC}"
    echo -e "    ${BOLD}2)${NC} text-embedding-3-small  ${DIM}(faster, lower cost)${NC}"
    echo -e "    ${BOLD}3)${NC} Custom"
    echo ""
    prompt "Select embeddings model ${CYAN}[1]${NC}${BOLD}: "
    tty_read -r emb_choice
    emb_choice="${emb_choice:-1}"
    case "$emb_choice" in
      1) EMBEDDINGS_MODEL="text-embedding-3-large" ;;
      2) EMBEDDINGS_MODEL="text-embedding-3-small" ;;
      3)
        prompt "Enter custom embeddings model name: "
        tty_read -r EMBEDDINGS_MODEL
        if [[ -z "$EMBEDDINGS_MODEL" ]]; then
          err "Model name is required"
          exit 1
        fi
        ;;
      *) err "Invalid choice"; exit 1 ;;
    esac
    log "Embeddings: ${EMBEDDINGS_PROVIDER} / ${EMBEDDINGS_MODEL}"

    if [[ "$EMBEDDINGS_PROVIDER" == "openai" && "$LLM_PROVIDER" != "openai" ]]; then
      _collect_openai_embeddings_key
    fi

    warn "Graph RAG is NOT needed for the basic setup. It requires Neo4j + ontology agent and uses significantly more resources. Most users should skip this."
    if ask_yn "Enable Graph RAG? (requires Neo4j + ontology agent, uses more resources)" "n"; then
      ENABLE_GRAPH_RAG=true
      log "Graph RAG enabled"
    else
      log "Graph RAG disabled (vector-only RAG)"
    fi
  else
    log "RAG skipped"
  fi

  if ask_yn "Enable Langfuse tracing (observability)?" "n"; then
    ENABLE_TRACING=true
    log "Tracing enabled"
  else
    log "Tracing skipped"
  fi

  echo ""
  echo -e "  ${DIM}AgentGateway federates all MCP servers behind a single endpoint,${NC}"
  echo -e "  ${DIM}allowing MCP clients (Cursor, VS Code, Claude Code) to connect once.${NC}"
  if ask_yn "Enable AgentGateway for MCP server access?" "n"; then
    ENABLE_AGENTGATEWAY=true
    log "AgentGateway enabled"
  else
    log "AgentGateway skipped"
  fi

  echo ""
  echo -e "  ${DIM}Redis persistence stores conversation checkpoints and cross-thread memory${NC}"
  echo -e "  ${DIM}in a dedicated Redis Stack pod, surviving pod restarts.${NC}"
  if ask_yn "Enable Redis persistence (checkpoints + cross-thread memory)?" "n"; then
    ENABLE_PERSISTENCE=true
    log "Redis persistence enabled"
  else
    log "Persistence skipped"
  fi
}

create_namespace_and_secrets() {
  step "Namespace and secrets"

  kubectl create namespace caipe --dry-run=client -o yaml | kubectl apply -f - &>/dev/null
  log "Namespace 'caipe' ready"

  local secret_args=(
    --from-literal=LLM_PROVIDER="$LLM_PROVIDER"
  )

  case "$LLM_PROVIDER" in
    anthropic-claude)
      secret_args+=(
        --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
        --from-literal=ANTHROPIC_MODEL_NAME="$ANTHROPIC_MODEL_NAME"
      )
      ;;
    aws-bedrock)
      secret_args+=(
        --from-literal=AWS_BEDROCK_MODEL_ID="$AWS_BEDROCK_MODEL_ID"
        --from-literal=AWS_BEDROCK_PROVIDER="$AWS_BEDROCK_PROVIDER"
        --from-literal=AWS_REGION="$AWS_REGION"
        --from-literal=AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
        --from-literal=AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
      )
      [[ -n "$AWS_BEDROCK_ENABLE_PROMPT_CACHE" ]] && \
        secret_args+=(--from-literal=AWS_BEDROCK_ENABLE_PROMPT_CACHE="$AWS_BEDROCK_ENABLE_PROMPT_CACHE")
      ;;
    *)
      secret_args+=(
        --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY"
        --from-literal=OPENAI_ENDPOINT="$OPENAI_ENDPOINT"
        --from-literal=OPENAI_BASE_URL="$OPENAI_ENDPOINT"
        --from-literal=OPENAI_MODEL_NAME="$OPENAI_MODEL_NAME"
      )
      ;;
  esac

  # When using non-OpenAI LLM with OpenAI embeddings for RAG, the RAG server
  # needs OPENAI_API_KEY in the same secret.
  if $ENABLE_RAG && [[ "$EMBEDDINGS_PROVIDER" == "openai" && "$LLM_PROVIDER" != "openai" && -n "${OPENAI_API_KEY:-}" ]]; then
    secret_args+=(--from-literal=OPENAI_API_KEY="$OPENAI_API_KEY")
    log "Added OPENAI_API_KEY to llm-secret (needed for OpenAI embeddings)"
  fi

  # When using LiteLLM for embeddings, the RAG server needs LITELLM_API_BASE
  # and LITELLM_API_KEY to reach the proxy.
  if $ENABLE_RAG && [[ "$EMBEDDINGS_PROVIDER" == "litellm" && -n "${LITELLM_ENDPOINT:-}" ]]; then
    secret_args+=(
      --from-literal=LITELLM_API_BASE="$LITELLM_ENDPOINT"
      --from-literal=LITELLM_API_KEY="${LITELLM_API_KEY:-not-needed}"
    )
    log "Added LITELLM_API_BASE/LITELLM_API_KEY to llm-secret (needed for LiteLLM embeddings)"
  fi

  kubectl create secret generic llm-secret -n caipe \
    "${secret_args[@]}" \
    --dry-run=client -o yaml | kubectl apply -f - &>/dev/null
  log "llm-secret created (provider: ${LLM_PROVIDER})"
}

_fix_langfuse_minio_credentials() {
  local expected_pw="${1:-}"

  # If no password passed, read what Langfuse-web expects from its env
  if [[ -z "$expected_pw" ]]; then
    expected_pw=$(kubectl get deployment langfuse-web -n langfuse \
      -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY")].value}' 2>/dev/null || true)
  fi
  [[ -z "$expected_pw" ]] && return 0

  # Read what MinIO is actually using
  local actual_pw
  actual_pw=$(kubectl get secret langfuse-s3 -n langfuse \
    -o jsonpath='{.data.root-password}' 2>/dev/null | base64 -d 2>/dev/null || true)

  if [[ "$actual_pw" != "$expected_pw" ]]; then
    log "Syncing MinIO credentials with Langfuse S3 config..."
    kubectl patch secret langfuse-s3 -n langfuse --type='json' \
      -p="[{\"op\":\"replace\",\"path\":\"/data/root-password\",\"value\":\"$(echo -n "$expected_pw" | base64)\"}]" &>/dev/null || true
    kubectl set env deployment/langfuse-s3 -n langfuse \
      MINIO_ROOT_PASSWORD="$expected_pw" &>/dev/null || true
    log "MinIO credentials synced"
  fi
}

deploy_langfuse() {
  step "Deploying Langfuse"

  # If Langfuse is already deployed and healthy, skip re-deploy to avoid
  # password mismatch (new passwords vs existing PostgreSQL PVC data).
  if helm status langfuse -n langfuse &>/dev/null; then
    local ready
    ready=$(kubectl get pods -n langfuse --no-headers 2>/dev/null \
      | awk '$3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
      | wc -l | tr -d ' ')
    if [[ "$ready" -gt 0 ]]; then
      log "Langfuse already deployed (${ready} pods running) — skipping"
      return
    fi
    warn "Langfuse release exists but pods are unhealthy; re-deploying"
    helm uninstall langfuse -n langfuse &>/dev/null || true
    kubectl delete pvc --all -n langfuse &>/dev/null || true
    sleep 5
  fi

  helm repo add langfuse https://langfuse.github.io/langfuse-k8s &>/dev/null 2>&1 || true
  helm repo update langfuse &>/dev/null
  log "Langfuse Helm repo ready"

  kubectl create namespace langfuse --dry-run=client -o yaml | kubectl apply -f - &>/dev/null

  # Use hex for passwords to avoid special chars that break connection-string URLs
  local salt enc_key nextauth_secret pg_pw ch_pw redis_pw minio_pw
  salt=$(openssl rand -hex 24)
  enc_key=$(openssl rand -hex 32)
  nextauth_secret=$(openssl rand -hex 24)
  pg_pw=$(openssl rand -hex 16)
  ch_pw=$(openssl rand -hex 16)
  redis_pw=$(openssl rand -hex 16)
  minio_pw=$(openssl rand -hex 16)
  log "Generated Langfuse secrets"

  helm upgrade --install langfuse langfuse/langfuse -n langfuse \
    --set langfuse.salt.value="$salt" \
    --set langfuse.encryptionKey.value="$enc_key" \
    --set langfuse.nextauth.secret.value="$nextauth_secret" \
    --set postgresql.auth.password="$pg_pw" \
    --set clickhouse.auth.password="$ch_pw" \
    --set redis.auth.password="$redis_pw" \
    --set s3.accessKeyId.value=minio \
    --set s3.secretAccessKey.value="$minio_pw" \
    --set s3.auth.rootUser=minio \
    --set s3.auth.rootPassword="$minio_pw" &>/dev/null
  log "Langfuse Helm release deployed"

  wait_for_pods langfuse 420
}

create_langfuse_api_keys() {
  step "Creating Langfuse account and API keys"

  # Check if keys already exist from a previous run
  local existing_pk existing_sk
  existing_pk=$(kubectl get secret langfuse-secret -n caipe -o jsonpath='{.data.LANGFUSE_PUBLIC_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)
  existing_sk=$(kubectl get secret langfuse-secret -n caipe -o jsonpath='{.data.LANGFUSE_SECRET_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)

  if [[ -n "$existing_pk" && -n "$existing_sk" && "$existing_pk" == pk-* ]]; then
    LANGFUSE_PUBLIC_KEY="$existing_pk"
    LANGFUSE_SECRET_KEY="$existing_sk"
    log "Reusing existing API keys (pk: ${LANGFUSE_PUBLIC_KEY:0:20}...)"
    return 0
  fi

  kill_port_on "$LANGFUSE_PORT"
  kubectl port-forward svc/langfuse-web -n langfuse "${LANGFUSE_PORT}:3000" &>/dev/null &
  disown $! 2>/dev/null || true
  PF_PIDS+=($!)
  sleep 3

  local base="http://localhost:${LANGFUSE_PORT}"
  local _lf_tries=0
  while [[ $_lf_tries -lt 6 ]]; do
    if curl -sf "${base}/api/auth/providers" &>/dev/null; then
      break
    fi
    _lf_tries=$((_lf_tries + 1))
    if [[ $_lf_tries -ge 6 ]]; then
      err "Cannot reach Langfuse at ${base}"
      return 1
    fi
    kill_port_on "$LANGFUSE_PORT"
    kubectl port-forward svc/langfuse-web -n langfuse "${LANGFUSE_PORT}:3000" &>/dev/null &
    disown $! 2>/dev/null || true
    PF_PIDS+=($!)
    sleep 5
  done

  curl -sf -X POST "${base}/api/auth/signup" \
    -H 'Content-Type: application/json' \
    -d '{"name":"lab","email":"lab@lab.com","password":"Lab12345!"}' &>/dev/null || true
  log "User account ready"

  local csrf
  csrf=$(curl -sf -c /tmp/langfuse-cookies "${base}/api/auth/csrf" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")

  curl -sf -c /tmp/langfuse-cookies -b /tmp/langfuse-cookies \
    -X POST "${base}/api/auth/callback/credentials" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d "csrfToken=${csrf}&email=lab@lab.com&password=Lab12345!&callbackUrl=${base}" \
    -o /dev/null

  local org_id
  org_id=$(curl -sf -b /tmp/langfuse-cookies \
    -X POST "${base}/api/trpc/organizations.create" \
    -H 'Content-Type: application/json' \
    -d '{"json":{"name":"lab"}}' \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['data']['json']['id'])")

  local project_id
  project_id=$(curl -sf -b /tmp/langfuse-cookies \
    -X POST "${base}/api/trpc/projects.create" \
    -H 'Content-Type: application/json' \
    -d "{\"json\":{\"name\":\"lab-tracing\",\"orgId\":\"${org_id}\"}}" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['data']['json']['id'])")

  local keys_json
  keys_json=$(curl -sf -b /tmp/langfuse-cookies \
    -X POST "${base}/api/trpc/projectApiKeys.create" \
    -H 'Content-Type: application/json' \
    -d "{\"json\":{\"projectId\":\"${project_id}\",\"note\":\"lab-tracing\"}}")

  LANGFUSE_PUBLIC_KEY=$(echo "$keys_json" | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['data']['json']['publicKey'])")
  LANGFUSE_SECRET_KEY=$(echo "$keys_json" | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['data']['json']['secretKey'])")
  log "API keys created (pk: ${LANGFUSE_PUBLIC_KEY:0:20}...)"

  local langfuse_baseurl="http://langfuse-web.langfuse.svc.cluster.local:3000"

  kubectl create secret generic langfuse-secret -n caipe \
    --from-literal=LANGFUSE_SECRET_KEY="$LANGFUSE_SECRET_KEY" \
    --from-literal=LANGFUSE_PUBLIC_KEY="$LANGFUSE_PUBLIC_KEY" \
    --dry-run=client -o yaml | kubectl apply -f - &>/dev/null
  log "langfuse-secret created in caipe namespace"

  kubectl create namespace langfuse &>/dev/null 2>&1 || true
  kubectl create secret generic langfuse-credentials -n langfuse \
    --from-literal=LANGFUSE_PUBLIC_KEY="$LANGFUSE_PUBLIC_KEY" \
    --from-literal=LANGFUSE_SECRET_KEY="$LANGFUSE_SECRET_KEY" \
    --from-literal=LANGFUSE_BASEURL="$langfuse_baseurl" \
    --from-literal=LANGFUSE_EMAIL="lab@lab.com" \
    --from-literal=LANGFUSE_PASSWORD="Lab12345!" \
    --dry-run=client -o yaml | kubectl apply -f - &>/dev/null
  log "langfuse-credentials stored in langfuse namespace"

  kill "${PF_PIDS[-1]}" 2>/dev/null || true
  unset 'PF_PIDS[-1]'
  rm -f /tmp/langfuse-cookies
}

prepare_corporate_ca() {
  local ns="caipe"
  local cm_name="corporate-ca-bundle"

  if kubectl get configmap "$cm_name" -n "$ns" &>/dev/null; then
    log "ConfigMap '${cm_name}' already exists — skipping CA extraction"
    return 0
  fi

  step "Corporate CA patch"

  local test_host="api.openai.com"
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" RETURN

  log "Extracting CA chain from ${test_host} via current network..."
  local proxy_chain="${tmp_dir}/proxy-chain.pem"
  if ! openssl s_client -connect "${test_host}:443" -showcerts </dev/null 2>/dev/null \
       | awk '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/' > "$proxy_chain"; then
    err "Could not connect to ${test_host}; skipping CA patch"
    return 1
  fi

  local cert_count
  cert_count=$(grep -c 'BEGIN CERTIFICATE' "$proxy_chain" 2>/dev/null || echo 0)
  if [[ "$cert_count" -lt 2 ]]; then
    log "No proxy CA chain detected (${cert_count} cert); CA patch not needed"
    INJECT_CORPORATE_CA=false
    return 0
  fi
  log "Detected ${cert_count} certificates in proxy chain"

  local issuer
  issuer=$(openssl x509 -in "$proxy_chain" -noout -issuer 2>/dev/null || true)
  log "Leaf cert issuer: ${issuer#issuer=}"

  local system_bundle="${tmp_dir}/system-ca.pem"
  local combined="${tmp_dir}/combined.pem"

  log "Fetching system CA bundle from container image..."
  kubectl delete pod ca-extract -n "$ns" --force --grace-period=0 &>/dev/null 2>&1 || true
  kubectl run ca-extract -n "$ns" --image=python:3.13-slim --restart=Never \
    --command -- sleep 300 &>/dev/null 2>&1 || true
  local retries=0
  while [[ $retries -lt 24 ]]; do
    if kubectl get pod ca-extract -n "$ns" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
      break
    fi
    sleep 5
    retries=$((retries + 1))
  done

  if kubectl exec ca-extract -n "$ns" -- cat /etc/ssl/certs/ca-certificates.crt > "$system_bundle" 2>/dev/null; then
    cat "$system_bundle" "$proxy_chain" > "$combined"
  else
    warn "Could not extract system CAs; using proxy chain only"
    cp "$proxy_chain" "$combined"
  fi
  kubectl delete pod ca-extract -n "$ns" --force --grace-period=0 &>/dev/null 2>&1 || true

  python3 -c "
import re, sys
with open('${combined}') as f:
    data = f.read()
certs = re.findall(r'(-----BEGIN CERTIFICATE-----\n.*?\n-----END CERTIFICATE-----)', data, re.DOTALL)
seen = set()
unique = []
for cert in certs:
    if cert not in seen:
        seen.add(cert)
        unique.append(cert)
with open('${combined}', 'w') as f:
    for cert in unique:
        f.write(cert + '\n\n')
print(f'{len(unique)} unique certs in clean bundle')
" 2>&1

  kubectl delete configmap "$cm_name" -n "$ns" &>/dev/null 2>&1 || true
  kubectl create configmap "$cm_name" -n "$ns" \
    --from-file=ca-certificates.crt="$combined" &>/dev/null
  log "ConfigMap '${cm_name}' created in namespace '${ns}' ($(wc -c < "$combined" | tr -d ' ') bytes)"
}

patch_deployment_with_ca() {
  local deploy="$1" ns="$2" container="${3:-}"
  local cm_name="corporate-ca-bundle"

  if [[ -z "$container" ]]; then
    container=$(kubectl get deployment "$deploy" -n "$ns" \
      -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null)
  fi

  kubectl patch deployment "$deploy" -n "$ns" --type='strategic' -p="{
    \"spec\": {
      \"template\": {
        \"spec\": {
          \"volumes\": [{
            \"name\": \"corporate-ca\",
            \"configMap\": {\"name\": \"${cm_name}\"}
          }],
          \"containers\": [{
            \"name\": \"${container}\",
            \"volumeMounts\": [{
              \"name\": \"corporate-ca\",
              \"mountPath\": \"/etc/ssl/certs/ca-certificates.crt\",
              \"subPath\": \"ca-certificates.crt\",
              \"readOnly\": true
            }],
            \"env\": [
              {\"name\": \"SSL_CERT_FILE\", \"value\": \"/etc/ssl/certs/ca-certificates.crt\"},
              {\"name\": \"REQUESTS_CA_BUNDLE\", \"value\": \"/etc/ssl/certs/ca-certificates.crt\"}
            ]
          }]
        }
      }
    }
  }" &>/dev/null
  log "Patched deployment '${deploy}' with corporate CA bundle"
}

# ─── Post-deploy patches ─────────────────────────────────────────────────────
# Consolidated workarounds for upstream chart issues (v0.2.x).
# Called once after helm install and idempotently by auto-heal.
#
# 1 & 2. Schema fix + httpx redirect (sitecustomize.py, single ConfigMap)
#    - PlatformEngineerResponse schema needs additionalProperties:false and
#      all properties in required for OpenAI gpt-5.x strict mode.
#    - httpx follow_redirects=True for MCP trailing-slash 307 redirects.
# 2b.   OpenAI response dedup fix (agent-fix ConfigMap, supervisor only)
#    - Mounts a patched agent.py that sets from_response_format_tool=True
#      when handle_structured_response parses a PlatformEngineerResponse
#      in PRIORITY 2/3 paths. Prevents duplicated output with OpenAI models.
# 3.    Corporate CA mount — optional; mounts pre-created CA ConfigMap into pods.
#       The ConfigMap is created by prepare_corporate_ca() before Helm deploy.
# 4.    Langfuse secret injection — tracing secret patched into supervisor.
# 5.    RAG startup sequencing — waits for Milvus, then restarts RAG server
#       with SKIP_INIT_TESTS=false so it can run its full initialization checks.

AGENT_DEPLOYMENTS="caipe-supervisor-agent caipe-agent-netutils caipe-agent-weather"

_create_agent_patches_configmap() {
  if kubectl get configmap agent-patches -n caipe &>/dev/null; then
    return
  fi

  kubectl create configmap agent-patches -n caipe \
    --from-literal=sitecustomize.py='
import importlib, json

# ── Fix 1: OpenAI Responses API strict schema ──
# PlatformEngineerResponse and nested models need additionalProperties:false
# and all properties listed in required for gpt-5.x strict mode.
def _fix_strict_schema(schema):
    if isinstance(schema, dict):
        if schema.get("type") == "object":
            if "additionalProperties" not in schema:
                schema["additionalProperties"] = False
            props = schema.get("properties", {})
            if props:
                schema["required"] = sorted(props.keys())
        for v in schema.values():
            _fix_strict_schema(v)
    elif isinstance(schema, list):
        for v in schema:
            _fix_strict_schema(v)

try:
    mod = importlib.import_module(
        "ai_platform_engineering.multi_agents.platform_engineer.response_format"
    )
    for cls_name in ("PlatformEngineerResponse", "Metadata", "InputField"):
        cls = getattr(mod, cls_name, None)
        if cls is None:
            continue
        _orig = cls.model_json_schema.__func__
        @classmethod
        def _patched(klass, *a, _orig_fn=_orig, **kw):
            s = _orig_fn(klass, *a, **kw)
            _fix_strict_schema(s)
            return s
        cls.model_json_schema = _patched
except Exception:
    pass

# ── Fix 2: httpx redirect for MCP trailing-slash 307 ──
try:
    import httpx
    _httpx_orig = httpx.AsyncClient.__init__
    def _httpx_patched(self, *a, **kw):
        kw.setdefault("follow_redirects", True)
        _httpx_orig(self, *a, **kw)
    httpx.AsyncClient.__init__ = _httpx_patched
except Exception:
    pass

# ── Note: OpenAI response dedup is handled separately by the agent-fix ──
# ── ConfigMap (see _create_agent_fix_configmap / _apply_agent_fix_volume). ──
' &>/dev/null
  log "Created agent-patches ConfigMap (schema fix + httpx redirect)"
}

_apply_agent_patches_volume() {
  local deploy="$1"
  if ! kubectl get deployment "$deploy" -n caipe &>/dev/null; then
    return
  fi

  local volumes
  volumes=$(kubectl get deployment "$deploy" -n caipe \
    -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null)
  if echo "$volumes" | grep -q "agent-patches"; then
    return
  fi

  local current_pypath
  current_pypath=$(kubectl get deployment "$deploy" -n caipe \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="PYTHONPATH")].value}' 2>/dev/null)
  current_pypath="${current_pypath:-/app}"
  [[ "$current_pypath" != *"/opt/agent-patches"* ]] && current_pypath="${current_pypath}:/opt/agent-patches"

  local container
  container=$(kubectl get deployment "$deploy" -n caipe \
    -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null)

  kubectl patch deployment "$deploy" -n caipe --type='strategic' -p="{
    \"spec\": {
      \"template\": {
        \"spec\": {
          \"volumes\": [{
            \"name\": \"agent-patches\",
            \"configMap\": {\"name\": \"agent-patches\"}
          }],
          \"containers\": [{
            \"name\": \"${container}\",
            \"volumeMounts\": [{
              \"name\": \"agent-patches\",
              \"mountPath\": \"/opt/agent-patches\",
              \"readOnly\": true
            }],
            \"env\": [
              {\"name\": \"PYTHONPATH\", \"value\": \"${current_pypath}\"}
            ]
          }]
        }
      }
    }
  }" &>/dev/null
  log "Applied agent patches to ${deploy}"
}

# ── Agent fix: mount fixed agent.py via ConfigMap ──
# Replaces the in-container agent.py to fix OpenAI response deduplication.
# Root cause: OpenAI streams PlatformEngineerResponse as plain text, not tool
# calls. The fix sets from_response_format_tool=True when handle_structured_response
# successfully parses the response in PRIORITY 2/3 paths.
# When piped (curl | bash), $0 is "bash" so dirname is meaningless.
# Fall back to $PWD; the agent_fix function already handles missing files.
if [[ -f "$0" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
else
  SCRIPT_DIR="$PWD"
fi

_create_agent_fix_configmap() {
  local fix_file="${SCRIPT_DIR}/agent_fix.py"
  if [[ ! -f "$fix_file" ]]; then
    log "WARNING: ${fix_file} not found — skipping agent fix"
    return 1
  fi
  kubectl create configmap agent-fix -n caipe \
    --from-file=agent.py="$fix_file" \
    --dry-run=client -o yaml | kubectl apply -f - &>/dev/null
  log "Created/updated agent-fix ConfigMap"
}

_apply_agent_fix_volume() {
  local deploy="caipe-supervisor-agent"
  if ! kubectl get deployment "$deploy" -n caipe &>/dev/null; then
    return
  fi

  local volumes
  volumes=$(kubectl get deployment "$deploy" -n caipe \
    -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null)
  if echo "$volumes" | grep -q "agent-fix"; then
    return
  fi

  local container
  container=$(kubectl get deployment "$deploy" -n caipe \
    -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null)

  kubectl patch deployment "$deploy" -n caipe --type='strategic' -p="{
    \"spec\": {
      \"template\": {
        \"spec\": {
          \"volumes\": [{
            \"name\": \"agent-fix\",
            \"configMap\": {\"name\": \"agent-fix\"}
          }],
          \"containers\": [{
            \"name\": \"${container}\",
            \"volumeMounts\": [{
              \"name\": \"agent-fix\",
              \"mountPath\": \"/app/ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py\",
              \"subPath\": \"agent.py\",
              \"readOnly\": true
            }]
          }]
        }
      }
    }
  }" &>/dev/null
  log "Applied agent fix volume mount to ${deploy}"
}

post_deploy_patches() {
  step "Applying post-deploy patches"
  local needs_rollout=false

  # ── 1 & 2. Schema fix + httpx redirect (single ConfigMap) ──
  _create_agent_patches_configmap
  for deploy in $AGENT_DEPLOYMENTS; do
    local before after
    before=$(kubectl get deployment "$deploy" -n caipe \
      -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null || true)
    _apply_agent_patches_volume "$deploy"
    after=$(kubectl get deployment "$deploy" -n caipe \
      -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null || true)
    [[ "$before" != "$after" ]] && needs_rollout=true
  done

  # ── 2b. Agent fix (OpenAI response dedup — supervisor only) ──
  if _create_agent_fix_configmap; then
    local before_exec after_exec
    before_exec=$(kubectl get deployment caipe-supervisor-agent -n caipe \
      -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null || true)
    _apply_agent_fix_volume
    after_exec=$(kubectl get deployment caipe-supervisor-agent -n caipe \
      -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null || true)
    [[ "$before_exec" != "$after_exec" ]] && needs_rollout=true
  fi

  # ── 3. Corporate CA patch (optional) ──
  # The CA ConfigMap was already created by prepare_corporate_ca() before Helm deploy.
  # Here we just mount it into the deployments that need outbound TLS.
  if $INJECT_CORPORATE_CA && kubectl get configmap corporate-ca-bundle -n caipe &>/dev/null; then
    for deploy in $AGENT_DEPLOYMENTS; do
      if kubectl get deployment "$deploy" -n caipe &>/dev/null; then
        local container
        container=$(kubectl get deployment "$deploy" -n caipe \
          -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null)
        local vol_names
        vol_names=$(kubectl get deployment "$deploy" -n caipe \
          -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null)
        if ! echo "$vol_names" | grep -q "corporate-ca"; then
          patch_deployment_with_ca "$deploy" caipe "$container"
          needs_rollout=true
        fi
      fi
    done
    if $ENABLE_RAG; then
      local vol_names
      vol_names=$(kubectl get deployment rag-server -n caipe \
        -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null || true)
      if ! echo "$vol_names" | grep -q "corporate-ca"; then
        patch_deployment_with_ca rag-server caipe rag-server
        needs_rollout=true
      fi
    fi
  fi

  # ── 4. Langfuse secret injection ──
  if $ENABLE_TRACING; then
    local envfrom
    envfrom=$(kubectl get deployment caipe-supervisor-agent -n caipe \
      -o jsonpath='{.spec.template.spec.containers[0].envFrom}' 2>/dev/null || true)
    if ! echo "$envfrom" | grep -q "langfuse-secret"; then
      kubectl patch deployment caipe-supervisor-agent -n caipe --type='json' \
        -p='[{"op":"add","path":"/spec/template/spec/containers/0/envFrom/-","value":{"secretRef":{"name":"langfuse-secret"}}}]' &>/dev/null
      log "Langfuse secret patched into supervisor"
      needs_rollout=true
    fi
  fi

  if $needs_rollout; then
    log "Waiting for patched deployments to roll out..."
    if $ENABLE_RAG; then
      wait_for_pods caipe 300 "rag-server"
    else
      wait_for_pods caipe 300
    fi
  else
    log "All patches already applied — nothing to do"
  fi

  # ── 5. RAG startup sequencing ──
  # RAG server was deployed with SKIP_INIT_TESTS=true so it wouldn't fail before
  # Milvus/Redis were ready and before the CA bundle was mounted. Now that infra
  # is healthy we disable the skip and restart RAG to run its full init checks.
  if $ENABLE_RAG; then
    _finalize_rag_startup
  fi
}

_wait_for_milvus() {
  local ns="caipe" timeout=120 interval=5 elapsed=0
  log "Waiting for Milvus to become ready..."
  while [[ $elapsed -lt $timeout ]]; do
    local milvus_ready
    milvus_ready=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
      | awk '/milvus-standalone/ && $3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
      | wc -l | tr -d ' ')
    if [[ "$milvus_ready" -gt 0 ]]; then
      log "Milvus standalone is ready"
      return 0
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  warn "Milvus did not become ready within ${timeout}s; RAG init may retry"
  return 1
}

_finalize_rag_startup() {
  step "Finalizing RAG server startup"

  _wait_for_milvus || true

  # Re-enable init tests and restart RAG server
  kubectl set env deployment/rag-server -n caipe -c rag-server \
    SKIP_INIT_TESTS=false &>/dev/null 2>&1
  log "RAG server restarted with init tests enabled"

  local rag_timeout=120 elapsed=0 ssl_checked_here=false
  while [[ $elapsed -lt $rag_timeout ]]; do
    local rag_status
    rag_status=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
      | awk '/rag-server/ && $3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
      | wc -l | tr -d ' ')
    if [[ "$rag_status" -gt 0 ]]; then
      log "RAG server is healthy"
      log "Restarting supervisor to reconnect to RAG server..."
      kubectl rollout restart deployment/caipe-supervisor-agent -n caipe &>/dev/null || true
      SUPERVISOR_RAG_RESTARTED=true
      local sup_wait=0
      while [[ $sup_wait -lt 60 ]]; do
        local sup_ready
        sup_ready=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
          | awk '/caipe-supervisor-agent/ && $3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
          | wc -l | tr -d ' ')
        if [[ "$sup_ready" -gt 0 ]]; then
          log "Supervisor is ready with RAG connection"
          break
        fi
        sleep 5
        sup_wait=$((sup_wait + 5))
      done
      return 0
    fi

    # Check for SSL errors while waiting (after 15s to let pods attempt startup)
    if ! $ssl_checked_here && ! $INJECT_CORPORATE_CA && ! $CA_SSL_FIX_PROMPTED \
       && [[ $elapsed -ge 15 ]]; then
      local rag_pod
      rag_pod=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
        | awk '/rag-server/ && $3!="Terminating" {print $1; exit}')
      if [[ -n "$rag_pod" ]]; then
        local rag_logs
        rag_logs=$(kubectl logs "$rag_pod" -n caipe -c rag-server --tail=200 2>/dev/null || true)
        if echo "$rag_logs" | grep -q "CERTIFICATE_VERIFY_FAILED\|SSL.*certificate\|SSLCertVerificationError"; then
          echo ""
          _auto_heal_offer_corporate_ca "RAG server"
          ssl_checked_here=true
          if $INJECT_CORPORATE_CA; then
            log "Corporate CA patched; waiting for RAG server to restart..."
            elapsed=0
            sleep 10
            continue
          fi
        fi
      fi
      ssl_checked_here=true
    fi

    printf "\r${DIM}  Waiting for RAG server  (%ds)${NC}  " "$elapsed"
    sleep 5
    elapsed=$((elapsed + 5))
  done
  echo ""
  warn "RAG server did not become healthy within ${rag_timeout}s"
}

# ─── Knowledge base ingestion ────────────────────────────────────────────────
# Calls the RAG server's webloader ingestion API to crawl and index URLs.
# The web-ingestor sidecar picks up the job from a Redis queue, crawls the
# site (using sitemap discovery), chunks the content, and stores embeddings
# in Milvus.  CAIPE docs site uses Docusaurus, which the ingestor auto-detects.
_rag_api() {
  # Call the RAG server API from inside its own pod using python3 (no curl
  # available in the distroless image).  $1=method $2=path $3=json_body (optional)
  local method="$1" path="$2" body="${3:-}"
  local py_script
  read -r -d '' py_script <<'PYEOF' || true
import sys, json, urllib.request, urllib.error
method, path = sys.argv[1], sys.argv[2]
body = sys.argv[3] if len(sys.argv) > 3 else None
url = f"http://localhost:9446{path}"
data = body.encode() if body else None
req = urllib.request.Request(url, data=data, method=method)
if data:
    req.add_header("Content-Type", "application/json")
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(resp.read().decode())
except urllib.error.HTTPError as e:
    err_body = e.read().decode() if e.fp else ""
    print(err_body)
    sys.exit(1)
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
PYEOF
  if [[ -n "$body" ]]; then
    kubectl exec -n caipe "$RAG_POD" -c rag-server -- \
      python3 -c "$py_script" "$method" "$path" "$body" 2>&1
  else
    kubectl exec -n caipe "$RAG_POD" -c rag-server -- \
      python3 -c "$py_script" "$method" "$path" 2>&1
  fi
}

_wait_for_rag_api() {
  local timeout=90 elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    RAG_POD=$(kubectl get pods -n caipe -l app.kubernetes.io/name=rag-server \
      -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\t"}{.metadata.deletionTimestamp}{"\n"}{end}' 2>/dev/null \
      | awk -F'\t' '$2=="Running" && $3=="" {print $1; exit}')

    if [[ -n "$RAG_POD" ]]; then
      local health
      health=$(_rag_api GET /healthz 2>&1) || true
      if echo "$health" | grep -q '"healthy"'; then
        return 0
      fi
    fi
    printf "\r${DIM}  Waiting for RAG server API  (%ds)${NC}  " "$elapsed"
    sleep 5
    elapsed=$((elapsed + 5))
  done
  echo ""
  return 1
}

ingest_knowledge_base() {
  [[ ${#INGEST_URLS[@]} -eq 0 ]] && return 0

  step "Ingesting knowledge base URLs"

  RAG_POD=""
  if ! _wait_for_rag_api; then
    warn "RAG server API not reachable after 90s; skipping ingestion"
    return 1
  fi
  log "RAG server is healthy (pod: ${RAG_POD})"

  local success=0 fail=0
  for url in "${INGEST_URLS[@]}"; do
    log "Submitting: ${url}"

    local body resp
    body="{\"url\":\"${url}\",\"description\":\"Auto-ingested by setup-caipe.sh\",\"settings\":{\"crawl_mode\":\"sitemap\",\"max_pages\":2000,\"chunk_size\":10000,\"chunk_overlap\":2000,\"concurrent_requests\":10,\"download_delay\":0.1}}"
    resp=$(_rag_api POST /v1/ingest/webloader/url "$body") || true

    if echo "$resp" | grep -q '"datasource_id"'; then
      local ds_id job_id
      ds_id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('datasource_id',''))" 2>/dev/null || true)
      job_id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null || true)
      log "Queued — datasource=${ds_id}  job=${job_id}"
      success=$((success + 1))
    elif echo "$resp" | grep -q "already ingested"; then
      warn "Already ingested: ${url} (delete datasource first to re-ingest)"
      success=$((success + 1))
    else
      err "Failed to queue: ${url}"
      err "  Response: ${resp}"
      fail=$((fail + 1))
    fi
  done

  if [[ $success -gt 0 ]]; then
    log "Ingestion jobs queued: ${success} succeeded, ${fail} failed"
    log "The web-ingestor will crawl the site(s) in the background"
    log "Monitor progress in the CAIPE UI Knowledge Base tab"
  fi
}

deploy_vllm() {
  step "Deploying vLLM (model: ${VLLM_MODEL})"

  # GPU node detection
  local gpu_nodes
  gpu_nodes=$(kubectl get nodes -o json \
    | jq '[.items[] | select(.status.capacity."nvidia.com/gpu" != null)] | length' 2>/dev/null || echo "0")
  if [[ "$gpu_nodes" -eq 0 ]]; then
    warn "No GPU nodes detected in the cluster"
    warn "vLLM serving ${VLLM_MODEL} typically requires GPU (A100/H100)"
    warn "The deployment will proceed but pods may stay Pending without GPU resources"
    if ! $NON_INTERACTIVE; then
      if ! ask_yn "Continue vLLM deployment without GPU nodes?" "y"; then
        log "Skipping vLLM deployment"
        return 0
      fi
    fi
  else
    log "Found ${gpu_nodes} GPU node(s)"
  fi

  helm repo add vllm https://vllm-project.github.io/production-stack 2>/dev/null || true
  helm repo update vllm 2>/dev/null || true

  local vllm_args=(
    --namespace caipe
    --create-namespace
    --set "servingEngineSpec.modelSpec[0].modelURL=${VLLM_MODEL}"
    --set "servingEngineSpec.modelSpec[0].replicaCount=1"
  )

  if [[ "$gpu_nodes" -gt 0 ]]; then
    vllm_args+=(--set "servingEngineSpec.modelSpec[0].requestGPU=${VLLM_GPU_COUNT}")
  fi

  if [[ -n "${HF_TOKEN:-}" ]]; then
    vllm_args+=(--set "servingEngineSpec.modelSpec[0].hf_token=${HF_TOKEN}")
  fi

  if ! helm upgrade --install vllm vllm/vllm-stack "${vllm_args[@]}" 2>&1; then
    err "vLLM Helm install failed"
    return 1
  fi
  log "vLLM Helm release deployed (model: ${VLLM_MODEL})"
  log "vLLM API will be available at http://vllm-router.caipe.svc.cluster.local:80/v1"
}

deploy_litellm() {
  step "Deploying LiteLLM Proxy"

  local vllm_api_base="http://vllm-router.caipe.svc.cluster.local:80/v1"

  kubectl apply -n caipe -f - <<LITELLM_EOF
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: litellm-config
  namespace: caipe
  labels:
    app: litellm-proxy
    app.kubernetes.io/managed-by: setup-caipe
data:
  config.yaml: |
    model_list:
      - model_name: "${LITELLM_MODEL_NAME}"
        litellm_params:
          model: "openai/${VLLM_MODEL}"
          api_base: "${vllm_api_base}"
          api_key: "not-needed"
      - model_name: "text-embedding-3-small"
        litellm_params:
          model: "openai/text-embedding-3-small"
          api_base: "${vllm_api_base}"
          api_key: "not-needed"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: litellm-proxy
  namespace: caipe
  labels:
    app: litellm-proxy
    app.kubernetes.io/managed-by: setup-caipe
spec:
  replicas: 1
  selector:
    matchLabels:
      app: litellm-proxy
  template:
    metadata:
      labels:
        app: litellm-proxy
    spec:
      containers:
      - name: litellm
        image: ghcr.io/berriai/litellm:main-stable
        args: ["--config", "/app/config.yaml", "--port", "4000"]
        ports:
        - containerPort: 4000
          name: http
          protocol: TCP
        livenessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 15
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 10
          periodSeconds: 5
        volumeMounts:
        - name: config
          mountPath: /app/config.yaml
          subPath: config.yaml
          readOnly: true
        resources:
          requests:
            cpu: 250m
            memory: 256Mi
          limits:
            cpu: "1"
            memory: 512Mi
      volumes:
      - name: config
        configMap:
          name: litellm-config
---
apiVersion: v1
kind: Service
metadata:
  name: litellm-proxy
  namespace: caipe
  labels:
    app: litellm-proxy
    app.kubernetes.io/managed-by: setup-caipe
spec:
  type: ClusterIP
  ports:
  - port: 4000
    targetPort: 4000
    protocol: TCP
    name: http
  selector:
    app: litellm-proxy
LITELLM_EOF

  log "LiteLLM proxy deployed (endpoint: http://litellm-proxy.caipe.svc.cluster.local:4000)"
}

deploy_agentgateway() {
  step "Deploying AgentGateway (${AGENTGATEWAY_VERSION})"

  # 1. Install Gateway API CRDs
  log "Installing Gateway API CRDs..."
  kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.0/standard-install.yaml 2>&1 \
    | tail -1 || true

  # 2. Install AgentGateway CRDs via Helm
  log "Installing AgentGateway CRDs..."
  helm upgrade -i agentgateway-crds oci://ghcr.io/kgateway-dev/charts/agentgateway-crds \
    --create-namespace --namespace agentgateway-system \
    --version "$AGENTGATEWAY_VERSION" 2>&1 | tail -1 || true

  # 3. Install AgentGateway control plane
  log "Installing AgentGateway control plane..."
  if ! helm upgrade -i agentgateway oci://ghcr.io/kgateway-dev/charts/agentgateway \
    --namespace agentgateway-system \
    --version "$AGENTGATEWAY_VERSION" 2>&1; then
    err "AgentGateway Helm install failed"
    return 1
  fi

  # 4. Wait for control plane to be ready
  log "Waiting for AgentGateway control plane..."
  kubectl rollout status deployment/agentgateway -n agentgateway-system --timeout=120s 2>/dev/null || true

  # 5. Create the Gateway resource (data plane proxy)
  kubectl apply -f - <<GATEWAY_EOF
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: agentgateway-proxy
  namespace: agentgateway-system
spec:
  gatewayClassName: agentgateway
  listeners:
  - protocol: HTTP
    port: 80
    name: http
    allowedRoutes:
      namespaces:
        from: All
GATEWAY_EOF
  log "AgentGateway proxy Gateway created"

  # 6. Wait for proxy deployment
  log "Waiting for AgentGateway proxy..."
  local retries=0
  while [[ $retries -lt 30 ]]; do
    if kubectl get deployment agentgateway-proxy -n agentgateway-system &>/dev/null; then
      kubectl rollout status deployment/agentgateway-proxy -n agentgateway-system --timeout=60s 2>/dev/null && break
    fi
    sleep 2
    retries=$((retries + 1))
  done

  # 7. Auto-discover CAIPE MCP services and create backends + routes
  _create_agentgateway_mcp_routes

  log "AgentGateway deployed successfully"
}

_create_agentgateway_mcp_routes() {
  log "Discovering MCP services in caipe namespace..."

  local mcp_svcs
  mcp_svcs=$(kubectl get svc -n caipe -o json 2>/dev/null \
    | jq -r '.items[] | select(.metadata.name | endswith("-mcp")) | .metadata.name' 2>/dev/null || true)

  if [[ -z "$mcp_svcs" ]]; then
    warn "No MCP services found in caipe namespace (services ending in -mcp)"
    warn "AgentGateway is deployed but has no MCP backends configured"
    warn "MCP backends will be auto-configured on next run after CAIPE deploys"
    return 0
  fi

  local count=0
  while IFS= read -r svc_name; do
    [[ -z "$svc_name" ]] && continue

    # Derive a short agent name (e.g. "caipe-agent-argocd-mcp" -> "argocd")
    local agent_name
    agent_name=$(echo "$svc_name" | sed 's/^caipe-//' | sed 's/^agent-//' | sed 's/-mcp$//')

    local svc_port
    svc_port=$(kubectl get svc "$svc_name" -n caipe -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || echo "8000")

    kubectl apply -f - <<MCP_ROUTE_EOF
---
apiVersion: agentgateway.dev/v1alpha1
kind: AgentgatewayBackend
metadata:
  name: mcp-${agent_name}-backend
  namespace: caipe
  labels:
    app.kubernetes.io/managed-by: setup-caipe
    app.kubernetes.io/component: agentgateway-mcp
spec:
  mcp:
    targets:
    - name: ${agent_name}
      static:
        host: ${svc_name}.caipe.svc.cluster.local
        port: ${svc_port}
        protocol: SSE
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: mcp-${agent_name}
  namespace: caipe
  labels:
    app.kubernetes.io/managed-by: setup-caipe
    app.kubernetes.io/component: agentgateway-mcp
spec:
  parentRefs:
  - name: agentgateway-proxy
    namespace: agentgateway-system
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /mcp/${agent_name}
    backendRefs:
    - name: mcp-${agent_name}-backend
      group: agentgateway.dev
      kind: AgentgatewayBackend
MCP_ROUTE_EOF

    log "  MCP backend: ${agent_name} -> ${svc_name}:${svc_port} at /mcp/${agent_name}"
    count=$((count + 1))
  done <<< "$mcp_svcs"

  log "Created ${count} AgentGateway MCP backend(s)"
}

deploy_caipe() {
  step "Deploying CAIPE (v${CAIPE_CHART_VERSION})"

  local helm_args=(
    --namespace caipe
    --version "$CAIPE_CHART_VERSION"
    --set tags.caipe-ui=true
    --set tags.agent-weather=true
    --set tags.agent-netutils=true
    --set caipe-ui.config.SSO_ENABLED=false
    --set caipe-ui.env.A2A_BASE_URL=http://localhost:8000
  )

  if $ENABLE_RAG; then
    helm_args+=(
      --set tags.rag-stack=true
      --set 'rag-stack.rag-webui.enabled=false'
      --set caipe-ui.env.RAG_URL=/api/rag
      --set caipe-ui.env.RAG_SERVER_URL=http://rag-server:${RAG_SERVER_PORT}
      --set caipe-ui.env.RAG_ENABLED=true
      --set "rag-stack.rag-server.env.EMBEDDINGS_MODEL=${EMBEDDINGS_MODEL}"
      --set "rag-stack.rag-server.env.EMBEDDINGS_PROVIDER=${EMBEDDINGS_PROVIDER}"
      --set 'rag-stack.rag-server.env.ALLOW_TRUSTED_NETWORK=true'
      --set 'rag-stack.rag-server.env.TRUSTED_NETWORK_CIDRS=127.0.0.0/8\,10.0.0.0/8'
      --set 'rag-stack.milvus.cluster.enabled=false'
      --set 'rag-stack.milvus.standalone.disk.enabled=true'
      --set 'rag-stack.milvus.etcd.replicaCount=1'
      --set 'rag-stack.milvus.minio.mode=standalone'
      --set 'rag-stack.milvus.minio.replicas=1'
      --set 'rag-stack.milvus.minio.persistence.size=10Gi'
      --set 'rag-stack.milvus.minio.resources.requests.memory=256Mi'
      --set 'supervisor-agent.env.RAG_SERVER_URL=http://rag-server:9446'
      --set 'rag-stack.rag-server.env.SKIP_INIT_TESTS=true'
    )

    if [[ "$EMBEDDINGS_PROVIDER" == "litellm" && -n "${LITELLM_ENDPOINT:-}" ]]; then
      helm_args+=(
        --set "rag-stack.rag-server.env.LITELLM_API_BASE=${LITELLM_ENDPOINT}"
        --set "rag-stack.rag-server.env.LITELLM_API_KEY=${LITELLM_API_KEY:-not-needed}"
      )
      log "LiteLLM embeddings configured (endpoint: ${LITELLM_ENDPOINT})"
    fi

    if $ENABLE_GRAPH_RAG; then
      helm_args+=(
        --set 'global.rag.enableGraphRag=true'
        --set 'rag-stack.rag-server.enableGraphRag=true'
        --set 'rag-stack.neo4j.neo4j.resources.requests.memory=2Gi'
        --set 'rag-stack.neo4j.neo4j.resources.requests.cpu=500m'
        --set 'rag-stack.neo4j.volumes.data.mode=defaultStorageClass'
        --set 'rag-stack.neo4j.volumes.data.defaultStorageClass.requests.storage=10Gi'
      )
      log "RAG stack enabled with Graph RAG (embeddings: ${EMBEDDINGS_PROVIDER}/${EMBEDDINGS_MODEL})"
    else
      helm_args+=(
        --set 'global.rag.enableGraphRag=false'
        --set 'rag-stack.rag-server.enableGraphRag=false'
        --set 'rag-stack.agent-ontology.enabled=false'
        --set 'rag-stack.neo4j.enabled=false'
      )
      log "RAG stack enabled, vector-only (embeddings: ${EMBEDDINGS_PROVIDER}/${EMBEDDINGS_MODEL})"
    fi
  fi

  if $ENABLE_TRACING; then
    helm_args+=(
      --set supervisor-agent.env.ENABLE_TRACING=true
      --set supervisor-agent.env.LANGFUSE_TRACING_ENABLED=true
      --set supervisor-agent.env.LANGFUSE_HOST=http://langfuse-web.langfuse.svc.cluster.local:3000
      --set supervisor-agent.env.OTEL_EXPORTER_OTLP_ENDPOINT=http://langfuse-web.langfuse.svc.cluster.local:3000/api/public/otel
    )
    log "Tracing configuration added"
  fi

  if $ENABLE_PERSISTENCE; then
    helm_args+=(
      --set 'global.langgraphRedis.enabled=true'
      --set 'supervisor-agent.checkpointPersistence.type=redis'
      --set 'supervisor-agent.checkpointPersistence.redis.autoDiscoverService=langgraph-redis'
      --set 'supervisor-agent.memoryPersistence.type=redis'
      --set 'supervisor-agent.memoryPersistence.redis.autoDiscoverService=langgraph-redis'
      --set 'supervisor-agent.memoryPersistence.enableFactExtraction=true'
    )
    log "Redis persistence configured (langgraph-redis subchart, fact extraction enabled)"
  fi

  if ! helm upgrade --install caipe "$CAIPE_OCI_REPO" "${helm_args[@]}" 2>&1; then
    err "Helm install failed (see output above)"
    exit 1
  fi
  log "CAIPE Helm release deployed"
  if $ENABLE_RAG; then
    wait_for_pods caipe 600 "rag-server"
  else
    wait_for_pods caipe 600
  fi
}

# ─── Validation ──────────────────────────────────────────────────────────────
print_result() {
  local line="$1"
  if echo "$line" | grep -q '✓'; then
    echo -e "  ${GREEN}${line}${NC}"
  elif echo "$line" | grep -q '✗'; then
    echo -e "  ${RED}${line}${NC}"
  elif echo "$line" | grep -q '⚠'; then
    echo -e "  ${YELLOW}${line}${NC}"
  else
    echo -e "  ${DIM}${line}${NC}"
  fi
}

check_http() {
  local url="$1" label="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" --max-time 5 2>/dev/null || echo "000")
  if [[ "$code" =~ ^(200|301|302|405)$ ]]; then
    print_result "$(date '+%H:%M:%S') ✓ ${label} reachable (HTTP ${code})"
    return 0
  else
    print_result "$(date '+%H:%M:%S') ✗ ${label} unreachable (HTTP ${code})"
    return 1
  fi
}

run_validation() {
  echo ""
  header "Validation Results"

  local pass=0 fail=0 warn_count=0

  # ── Kubernetes health ──
  local total ready
  total=$(kubectl get pods -n caipe --no-headers 2>/dev/null | wc -l | tr -d ' ')
  ready=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
    | awk '$3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
    | wc -l | tr -d ' ')
  if [[ "$total" -gt 0 && "$total" -eq "$ready" ]]; then
    print_result "$(date '+%H:%M:%S') ✓ All ${total} pods in caipe namespace are running"
    pass=$((pass + 1))
  else
    print_result "$(date '+%H:%M:%S') ✗ Pods: ${ready}/${total} ready in caipe namespace"
    fail=$((fail + 1))
    kubectl get pods -n caipe --no-headers 2>/dev/null \
      | awk '$3!="Running" || ($2~"^[0-9]+/[0-9]+$" && split($2,a,"/") && a[1]!=a[2])' \
      | while IFS= read -r pod_line; do
          print_result "$(date '+%H:%M:%S')   ⚠ ${pod_line}"
        done
  fi

  # ── Supervisor agent card ──
  local agent_card
  agent_card=$(curl -sf "http://localhost:${SUPERVISOR_PORT}/.well-known/agent.json" --max-time 5 2>/dev/null || echo "")
  if [[ -n "$agent_card" ]] && echo "$agent_card" | jq -e '.name' &>/dev/null; then
    local agent_name skills_count
    agent_name=$(echo "$agent_card" | jq -r '.name')
    skills_count=$(echo "$agent_card" | jq -r '.skills | length' 2>/dev/null || echo "0")
    print_result "$(date '+%H:%M:%S') ✓ Agent card OK (name: ${agent_name}, skills: ${skills_count})"
    pass=$((pass + 1))
  else
    print_result "$(date '+%H:%M:%S') ✗ Supervisor agent card not reachable"
    fail=$((fail + 1))
  fi

  # ── Sub-agent registration ──
  for agent in weather netutils; do
    if echo "$agent_card" | grep -qi "$agent" 2>/dev/null; then
      print_result "$(date '+%H:%M:%S') ✓ ${agent} agent registered"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ⚠ ${agent} agent not visible in agent card"
      warn_count=$((warn_count + 1))
    fi
  done

  # ── HTTP endpoints ──
  if check_http "http://localhost:${UI_PORT}" "CAIPE UI"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
  if check_http "http://localhost:${SUPERVISOR_PORT}" "Supervisor A2A"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi

  # ── Tracing ──
  if $ENABLE_TRACING; then
    if check_http "http://localhost:${LANGFUSE_PORT}" "Langfuse UI"; then
      pass=$((pass + 1))
    else
      fail=$((fail + 1))
    fi

    local has_lf_key
    has_lf_key=$(kubectl get deployment caipe-supervisor-agent -n caipe \
      -o jsonpath='{.spec.template.spec.containers[0].envFrom[*].secretRef.name}' 2>/dev/null || true)
    if echo "$has_lf_key" | grep -q "langfuse-secret"; then
      print_result "$(date '+%H:%M:%S') ✓ Supervisor has langfuse-secret mounted"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ Supervisor missing langfuse-secret envFrom"
      fail=$((fail + 1))
    fi
  fi

  # ── RAG ──
  if $ENABLE_RAG; then
    local rag_ready
    rag_ready=$(kubectl get pods -n caipe -l app.kubernetes.io/name=rag-server \
      --no-headers 2>/dev/null \
      | awk '$3=="Running" {split($2,a,"/"); if(a[1]==a[2]) print "ready"}' | head -1)
    if [[ "$rag_ready" == "ready" ]]; then
      print_result "$(date '+%H:%M:%S') ✓ RAG server pod is running and ready"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ RAG server pod is not ready"
      fail=$((fail + 1))
    fi

    local rag_url
    rag_url=$(kubectl get deployment caipe-supervisor-agent -n caipe \
      -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="RAG_SERVER_URL")].value}' 2>/dev/null || true)
    if [[ "$rag_url" == "http://rag-server:9446" ]]; then
      print_result "$(date '+%H:%M:%S') ✓ Supervisor RAG_SERVER_URL is correct"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ Supervisor RAG_SERVER_URL is '${rag_url:-unset}' (expected http://rag-server:9446)"
      fail=$((fail + 1))
    fi
  fi

  # ── vLLM + LiteLLM ──
  if $ENABLE_VLLM; then
    local vllm_ready
    vllm_ready=$(kubectl get pods -n caipe -l app=vllm \
      --no-headers 2>/dev/null \
      | awk '$3=="Running" {split($2,a,"/"); if(a[1]==a[2]) print "ready"}' | head -1)
    if [[ "$vllm_ready" == "ready" ]]; then
      print_result "$(date '+%H:%M:%S') ✓ vLLM pod is running and ready"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ vLLM pod is not ready"
      fail=$((fail + 1))
    fi

    local litellm_ready
    litellm_ready=$(kubectl get pods -n caipe -l app=litellm-proxy \
      --no-headers 2>/dev/null \
      | awk '$3=="Running" {split($2,a,"/"); if(a[1]==a[2]) print "ready"}' | head -1)
    if [[ "$litellm_ready" == "ready" ]]; then
      print_result "$(date '+%H:%M:%S') ✓ LiteLLM proxy pod is running and ready"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ LiteLLM proxy pod is not ready"
      fail=$((fail + 1))
    fi
  fi

  # ── AgentGateway ──
  if $ENABLE_AGENTGATEWAY; then
    local ag_ready
    ag_ready=$(kubectl get pods -n agentgateway-system -l app.kubernetes.io/name=agentgateway \
      --no-headers 2>/dev/null \
      | awk '$3=="Running" {split($2,a,"/"); if(a[1]==a[2]) print "ready"}' | head -1)
    if [[ "$ag_ready" == "ready" ]]; then
      print_result "$(date '+%H:%M:%S') ✓ AgentGateway control plane is running"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ AgentGateway control plane is not ready"
      fail=$((fail + 1))
    fi

    local ag_proxy_ready
    ag_proxy_ready=$(kubectl get deployment agentgateway-proxy -n agentgateway-system \
      -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    if [[ "${ag_proxy_ready:-0}" -ge 1 ]]; then
      print_result "$(date '+%H:%M:%S') ✓ AgentGateway proxy is running"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ AgentGateway proxy is not ready"
      fail=$((fail + 1))
    fi

    local mcp_backend_count
    mcp_backend_count=$(kubectl get agentgatewaybackend -n caipe \
      -l app.kubernetes.io/managed-by=setup-caipe --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$mcp_backend_count" -gt 0 ]]; then
      print_result "$(date '+%H:%M:%S') ✓ ${mcp_backend_count} MCP backend(s) configured in AgentGateway"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ⚠ No MCP backends configured in AgentGateway"
      warn_count=$((warn_count + 1))
    fi
  fi

  # ── Summary ──
  echo ""
  local total_checks=$((pass + fail + warn_count))
  if [[ $fail -eq 0 ]]; then
    echo -e "  ${GREEN}${BOLD}All checks passed (${pass}/${total_checks})${NC}"
  else
    echo -e "  ${RED}${BOLD}${fail} failed${NC}, ${GREEN}${pass} passed${NC}, ${YELLOW}${warn_count} warnings${NC} (${total_checks} total)"
  fi
  echo ""
}

# ─── Sanity Tests ────────────────────────────────────────────────────────────
run_sanity_tests() {
  echo ""
  header "Sanity Tests"

  local pass=0 fail=0

  # ── Test 1: Agent card is valid JSON with required fields ──
  local agent_card
  agent_card=$(curl -sf "http://localhost:${SUPERVISOR_PORT}/.well-known/agent.json" --max-time 5 2>/dev/null || echo "")
  if [[ -n "$agent_card" ]] && echo "$agent_card" | jq -e '.name and .skills' &>/dev/null; then
    print_result "$(date '+%H:%M:%S') ✓ [T1] Agent card schema valid (name, skills present)"
    pass=$((pass + 1))
  else
    print_result "$(date '+%H:%M:%S') ✗ [T1] Agent card missing required fields"
    fail=$((fail + 1))
  fi

  # ── Test 2: Send a simple A2A message/stream and check first SSE event ──
  print_result "$(date '+%H:%M:%S')   … [T2] Sending A2A message (this may take up to 90s)..."
  local msg_id
  msg_id="sanity-$(date +%s)"
  local a2a_response
  a2a_response=$(curl -s -N -X POST "http://localhost:${SUPERVISOR_PORT}/" \
    -H 'Content-Type: application/json' \
    --max-time 90 \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"sanity-test-1\",
      \"method\": \"message/stream\",
      \"params\": {
        \"message\": {
          \"role\": \"user\",
          \"parts\": [{\"kind\": \"text\", \"text\": \"What is 2+2? Reply with just the number.\"}],
          \"messageId\": \"${msg_id}\"
        }
      }
    }" 2>/dev/null | head -1 || echo "")

  # Strip "data: " prefix from SSE event
  a2a_response="${a2a_response#data: }"

  if [[ -n "$a2a_response" ]] && echo "$a2a_response" | jq -e '.result' &>/dev/null; then
    print_result "$(date '+%H:%M:%S') ✓ [T2] A2A message/stream returned valid response"
    pass=$((pass + 1))
  elif [[ -n "$a2a_response" ]] && echo "$a2a_response" | jq -e '.error' &>/dev/null; then
    local err_msg
    err_msg=$(echo "$a2a_response" | jq -r '.error.message // .error' 2>/dev/null || true)
    print_result "$(date '+%H:%M:%S') ✗ [T2] A2A message/stream error: ${err_msg:0:120}"
    fail=$((fail + 1))
  else
    print_result "$(date '+%H:%M:%S') ✗ [T2] A2A message/stream no response (timeout or refused)"
    fail=$((fail + 1))
  fi

  # ── Test 3: CAIPE UI serves HTML ──
  local ui_content_type
  ui_content_type=$(curl -sf -o /dev/null -w "%{content_type}" "http://localhost:${UI_PORT}/" --max-time 5 2>/dev/null || echo "")
  if echo "$ui_content_type" | grep -qi "text/html"; then
    print_result "$(date '+%H:%M:%S') ✓ [T3] CAIPE UI serves HTML content"
    pass=$((pass + 1))
  else
    print_result "$(date '+%H:%M:%S') ✗ [T3] CAIPE UI content-type: ${ui_content_type:-none}"
    fail=$((fail + 1))
  fi

  # ── Test 4: Sub-agent direct health (in-cluster) ──
  for agent_svc in caipe-agent-weather caipe-agent-netutils; do
    local agent_label="${agent_svc#caipe-agent-}"
    local agent_card_resp
    agent_card_resp=$(kubectl exec deployment/caipe-supervisor-agent -n caipe -- \
      curl -sf "http://${agent_svc}:8000/.well-known/agent.json" --max-time 5 2>/dev/null || echo "")
    if [[ -n "$agent_card_resp" ]] && echo "$agent_card_resp" | jq -e '.name' &>/dev/null; then
      print_result "$(date '+%H:%M:%S') ✓ [T4] ${agent_label} agent card reachable in-cluster"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ [T4] ${agent_label} agent card not reachable in-cluster"
      fail=$((fail + 1))
    fi
  done

  # ── Test 5: RAG server health (if RAG enabled) ──
  if $ENABLE_RAG; then
    local rag_health
    rag_health=$(kubectl exec deployment/caipe-supervisor-agent -n caipe -- \
      curl -sf "http://rag-server:9446/healthz" --max-time 5 2>/dev/null || echo "")
    if [[ -n "$rag_health" ]] && echo "$rag_health" | jq -e '.status // .config' &>/dev/null; then
      print_result "$(date '+%H:%M:%S') ✓ [T5] RAG server /healthz OK"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ [T5] RAG server /healthz failed"
      fail=$((fail + 1))
    fi
  fi

  # ── Test 6: Langfuse API health (if tracing enabled) ──
  if $ENABLE_TRACING; then
    local lf_api
    lf_api=$(curl -sf "http://localhost:${LANGFUSE_PORT}/api/public/health" --max-time 5 2>/dev/null || echo "")
    if [[ -n "$lf_api" ]] && echo "$lf_api" | jq -e '.status' &>/dev/null; then
      local lf_status
      lf_status=$(echo "$lf_api" | jq -r '.status')
      print_result "$(date '+%H:%M:%S') ✓ [T6] Langfuse API health: ${lf_status}"
      pass=$((pass + 1))
    else
      print_result "$(date '+%H:%M:%S') ✗ [T6] Langfuse API health check failed"
      fail=$((fail + 1))
    fi
  fi

  # ── Summary ──
  echo ""
  local total=$((pass + fail))
  if [[ $fail -eq 0 ]]; then
    echo -e "  ${GREEN}${BOLD}All ${total} sanity tests passed${NC}"
  else
    echo -e "  ${RED}${BOLD}${fail}/${total} sanity tests failed${NC}"
  fi
  echo ""
}

# ─── Auto-Heal ───────────────────────────────────────────────────────────────
AUTOHEAL_ENABLED=true
AUTOHEAL_LAST_RUN=0
AUTOHEAL_INTERVAL=30    # seconds between heal cycles

auto_heal_pods() {
  local ns="$1"
  local healed=0

  # CrashLoopBackOff / Error — rollout restart the owning deployment
  # Skip Terminating pods (old replicas being replaced) to avoid restart storms
  local bad_pods
  bad_pods=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
    | awk '$3=="CrashLoopBackOff" || $3=="Error" || $3=="CreateContainerConfigError" {print $1}')

  for pod in $bad_pods; do
    # Skip pods that are already being terminated
    local pod_phase
    pod_phase=$(kubectl get pod "$pod" -n "$ns" -o jsonpath='{.metadata.deletionTimestamp}' 2>/dev/null || true)
    [[ -n "$pod_phase" ]] && continue

    local owner
    owner=$(kubectl get pod "$pod" -n "$ns" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || true)
    if [[ -z "$owner" ]]; then continue; fi

    # ReplicaSet -> Deployment
    local deploy
    deploy=$(kubectl get rs "$owner" -n "$ns" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || true)
    if [[ -n "$deploy" ]]; then
      # Skip supervisor if we already restarted it for RAG reconnection
      if [[ "$deploy" == "caipe-supervisor-agent" ]] && $SUPERVISOR_RAG_RESTARTED; then
        continue
      fi
      warn "[auto-heal] Pod ${pod} in ${3:-CrashLoop}; restarting deployment/${deploy}"
      kubectl rollout restart "deployment/${deploy}" -n "$ns" &>/dev/null || true
      ((healed++))
    fi
  done

  # ErrImagePull / ImagePullBackOff — log only (requires manual image fix)
  local pull_errors
  pull_errors=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
    | awk '$3=="ErrImagePull" || $3=="ImagePullBackOff" {print $1}')
  for pod in $pull_errors; do
    warn "[auto-heal] Pod ${pod} has image pull error (manual fix needed)"
  done

  return $healed
}

auto_heal_pvcs() {
  local ns="$1"
  local healed=0

  local pending_pvcs
  pending_pvcs=$(kubectl get pvc -n "$ns" --no-headers 2>/dev/null \
    | awk '$2=="Pending" {print $1}')

  for pvc in $pending_pvcs; do
    local sc
    sc=$(kubectl get pvc "$pvc" -n "$ns" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)

    # Check if the requested storageClass exists
    if [[ -n "$sc" ]] && ! kubectl get storageclass "$sc" &>/dev/null 2>&1; then
      local default_sc
      default_sc=$(kubectl get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null || true)

      if [[ -n "$default_sc" && "$default_sc" != "$sc" ]]; then
        warn "[auto-heal] PVC ${pvc} requests non-existent storageClass '${sc}'; recreating with '${default_sc}'"
        local pvc_size
        pvc_size=$(kubectl get pvc "$pvc" -n "$ns" -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || echo "10Gi")
        local access_mode
        access_mode=$(kubectl get pvc "$pvc" -n "$ns" -o jsonpath='{.spec.accessModes[0]}' 2>/dev/null || echo "ReadWriteOnce")

        kubectl delete pvc "$pvc" -n "$ns" --wait=false &>/dev/null || true
        kubectl apply -f - &>/dev/null <<EOFPVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${pvc}
  namespace: ${ns}
spec:
  accessModes: ["${access_mode}"]
  storageClassName: "${default_sc}"
  resources:
    requests:
      storage: "${pvc_size}"
EOFPVC
        log "[auto-heal] PVC ${pvc} recreated with storageClass '${default_sc}'"
        ((healed++))
      fi
    fi
  done

  return $healed
}

auto_heal_langfuse_secret() {
  if ! $ENABLE_TRACING; then return 0; fi

  # Verify langfuse-secret exists
  if ! kubectl get secret langfuse-secret -n caipe &>/dev/null; then
    return 0
  fi

  # Check if supervisor deployment has langfuse-secret in envFrom
  local envfrom
  envfrom=$(kubectl get deployment caipe-supervisor-agent -n caipe \
    -o jsonpath='{.spec.template.spec.containers[0].envFrom[*].secretRef.name}' 2>/dev/null || true)

  if ! echo "$envfrom" | grep -q "langfuse-secret"; then
    warn "[auto-heal] Supervisor missing langfuse-secret; re-patching"
    kubectl patch deployment caipe-supervisor-agent -n caipe --type='json' \
      -p='[{"op":"add","path":"/spec/template/spec/containers/0/envFrom/-","value":{"secretRef":{"name":"langfuse-secret"}}}]' &>/dev/null || true
    log "[auto-heal] langfuse-secret patched into supervisor"
    return 1
  fi

  # Verify the secret actually has the expected keys
  local has_keys
  has_keys=$(kubectl get secret langfuse-secret -n caipe \
    -o jsonpath='{.data.LANGFUSE_SECRET_KEY}' 2>/dev/null || true)
  if [[ -z "$has_keys" ]]; then
    warn "[auto-heal] langfuse-secret exists but LANGFUSE_SECRET_KEY is empty"
  fi

  # Check MinIO credential mismatch (Langfuse chart bug: s3.secretAccessKey
  # only configures the app side, MinIO sub-chart generates its own password)
  local minio_expected minio_actual
  minio_expected=$(kubectl get deployment langfuse-web -n langfuse \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY")].value}' 2>/dev/null || true)
  minio_actual=$(kubectl get secret langfuse-s3 -n langfuse \
    -o jsonpath='{.data.root-password}' 2>/dev/null | base64 -d 2>/dev/null || true)

  if [[ -n "$minio_expected" && -n "$minio_actual" && "$minio_expected" != "$minio_actual" ]]; then
    warn "[auto-heal] Langfuse MinIO credential mismatch; syncing"
    _fix_langfuse_minio_credentials "$minio_expected"
    return 1
  fi

  return 0
}

_auto_heal_offer_corporate_ca() {
  local source="${1:-a pod}"
  CA_SSL_FIX_PROMPTED=true

  echo ""
  warn "[auto-heal] SSL/TLS certificate errors detected in ${source}."
  echo -e "  ${YELLOW}This usually means a corporate proxy or firewall is intercepting TLS traffic.${NC}"
  echo -e "  ${DIM}The script can auto-detect your corporate CA chain and patch it into the pods.${NC}"
  echo ""

  if ! $NON_INTERACTIVE && ask_yn "Attempt to auto-detect and apply corporate CA patch to fix SSL errors?" "y"; then
    echo ""
    prepare_corporate_ca
    if kubectl get configmap corporate-ca-bundle -n caipe &>/dev/null; then
      INJECT_CORPORATE_CA=true
      log "[auto-heal] Corporate CA bundle created; patching all deployments..."
      for deploy in $AGENT_DEPLOYMENTS; do
        if kubectl get deployment "$deploy" -n caipe &>/dev/null; then
          local container
          container=$(kubectl get deployment "$deploy" -n caipe \
            -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null)
          local vol_names
          vol_names=$(kubectl get deployment "$deploy" -n caipe \
            -o jsonpath='{.spec.template.spec.volumes[*].name}' 2>/dev/null)
          if ! echo "$vol_names" | grep -q "corporate-ca"; then
            patch_deployment_with_ca "$deploy" caipe "$container"
          fi
        fi
      done
      if $ENABLE_RAG; then
        patch_deployment_with_ca rag-server caipe rag-server
      fi
      log "[auto-heal] Corporate CA patched into all deployments; pods will restart"
    else
      warn "[auto-heal] Could not detect a corporate CA chain; no changes made"
    fi
  else
    warn "[auto-heal] Skipped corporate CA patch. Re-run with --corporate-ca if needed."
  fi
  echo ""
}

auto_heal_rag_server() {
  if ! $ENABLE_RAG; then return 0; fi

  # Get the most recent rag-server pod (skip Terminating)
  local rag_pod rag_status rag_ready_str
  rag_pod=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
    | awk '/rag-server/ && $3!="Terminating" {print $1; exit}')

  if [[ -z "$rag_pod" ]]; then
    return 0
  fi

  rag_status=$(kubectl get pod "$rag_pod" -n caipe --no-headers 2>/dev/null | awk '{print $3}')
  rag_ready_str=$(kubectl get pod "$rag_pod" -n caipe --no-headers 2>/dev/null | awk '{print $2}')

  # Check logs for fixable errors when pod is not fully ready
  # (Running but not all containers ready, CrashLoopBackOff, or Error)
  local is_fully_ready=false
  if [[ "$rag_status" == "Running" ]] && echo "$rag_ready_str" | grep -qE '^[0-9]+/[0-9]+$'; then
    local r_num r_den
    r_num=$(echo "$rag_ready_str" | cut -d/ -f1)
    r_den=$(echo "$rag_ready_str" | cut -d/ -f2)
    [[ "$r_num" -eq "$r_den" ]] && is_fully_ready=true
  fi

  if ! $is_fully_ready; then
    local recent_logs
    recent_logs=$(kubectl logs "$rag_pod" -n caipe -c rag-server \
      --tail=200 2>/dev/null || true)

    # EMBEDDINGS_PROVIDER defaulting to azure-openai
    if echo "$recent_logs" | grep -q "AZURE_OPENAI_ENDPOINT\|azure_endpoint"; then
      warn "[auto-heal] RAG server has wrong embeddings provider; patching to openai"
      kubectl set env deployment/rag-server -n caipe \
        EMBEDDINGS_PROVIDER=openai \
        EMBEDDINGS_MODEL="${EMBEDDINGS_MODEL}" &>/dev/null || true
      log "[auto-heal] RAG server embeddings provider corrected"
      return 1
    fi

    # SSL certificate errors (corporate proxy)
    if echo "$recent_logs" | grep -q "CERTIFICATE_VERIFY_FAILED\|SSL.*certificate\|SSLCertVerificationError"; then
      if $INJECT_CORPORATE_CA; then
        warn "[auto-heal] RAG server SSL error; re-applying corporate CA"
        patch_deployment_with_ca rag-server caipe rag-server
        return 1
      elif ! $CA_SSL_FIX_PROMPTED; then
        _auto_heal_offer_corporate_ca "RAG server"
        if $INJECT_CORPORATE_CA; then return 1; fi
      fi
    fi
  fi

  # Check supervisor RAG_SERVER_URL
  local rag_url
  rag_url=$(kubectl get deployment caipe-supervisor-agent -n caipe \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="RAG_SERVER_URL")].value}' 2>/dev/null || true)

  if [[ -z "$rag_url" || "$rag_url" == "http://localhost:9446" ]]; then
    warn "[auto-heal] Supervisor has wrong RAG_SERVER_URL (${rag_url:-unset}); fixing"
    kubectl set env deployment/caipe-supervisor-agent -n caipe \
      RAG_SERVER_URL=http://rag-server:9446 &>/dev/null || true
    log "[auto-heal] Supervisor RAG_SERVER_URL corrected to http://rag-server:9446"
    return 1
  fi

  return 0
}

auto_heal_supervisor_rag() {
  if ! $ENABLE_RAG; then return 0; fi
  if $SUPERVISOR_RAG_RESTARTED; then return 0; fi

  # Only proceed if RAG server is fully healthy
  local rag_healthy
  rag_healthy=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
    | awk '/rag-server/ && $3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
    | wc -l | tr -d ' ')
  if [[ "${rag_healthy:-0}" -eq 0 ]]; then
    return 0
  fi

  # Only check the running+ready supervisor pod (not Terminating/starting ones)
  local sup_pod
  sup_pod=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
    | awk '/caipe-supervisor-agent/ && $3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print $1}' \
    | head -1)
  if [[ -z "$sup_pod" ]]; then
    return 0
  fi

  local sup_logs
  sup_logs=$(kubectl logs "$sup_pod" -n caipe --tail=200 2>/dev/null || true)

  if echo "$sup_logs" | grep -q "RAG is DISABLED\|RAG disabled\|Failed to connect to RAG server"; then
    warn "[auto-heal] Supervisor has RAG disabled but RAG server is healthy; restarting supervisor"
    kubectl rollout restart deployment/caipe-supervisor-agent -n caipe &>/dev/null || true
    SUPERVISOR_RAG_RESTARTED=true
    log "[auto-heal] Supervisor restarted to reconnect to RAG"
    return 1
  fi

  return 0
}

# Scan running pod logs for known error patterns and remediate.
# Unlike pod-status checks, this catches issues where the pod is "Running"
# but the application inside has errors (SSL, misconfigured providers, etc.)
auto_heal_pod_logs() {
  local ns="$1"
  local healed=0

  # Get all running (non-Terminating) pods in namespace, excluding infra pods
  local pods
  pods=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
    | awk '$3!="Terminating" && $1!~/etcd|milvus|minio|redis/ {print $1}')

  for pod in $pods; do
    local logs
    logs=$(kubectl logs "$pod" -n "$ns" --tail=200 --all-containers 2>/dev/null || true)
    [[ -z "$logs" ]] && continue

    # SSL / certificate errors → offer corporate CA patch (once)
    if ! $INJECT_CORPORATE_CA && ! $CA_SSL_FIX_PROMPTED; then
      if echo "$logs" | grep -q "CERTIFICATE_VERIFY_FAILED\|SSLCertVerificationError"; then
        _auto_heal_offer_corporate_ca "$pod"
        $INJECT_CORPORATE_CA && healed=$((healed + 1))
        break
      fi
    fi

    # Supervisor: RAG disabled while RAG server is healthy (handled by auto_heal_supervisor_rag)
    # Skip here to avoid duplicate detection

    # UI: ECONNREFUSED to rag-server → rag-server not ready yet, will self-resolve
    # No action needed, just informational
  done

  return $healed
}

auto_heal_services() {
  local ns="$1"
  local healed=0

  local svcs
  svcs=$(kubectl get svc -n "$ns" --no-headers 2>/dev/null \
    | awk '$2=="ClusterIP" {print $1}')

  for svc in $svcs; do
    local ep_count
    ep_count=$(kubectl get endpoints "$svc" -n "$ns" \
      -o jsonpath='{.subsets[*].addresses}' 2>/dev/null | wc -c | tr -d ' ')

    if [[ "$ep_count" -lt 3 ]]; then
      # Service has no ready endpoints — find its deployment and restart
      local selector
      selector=$(kubectl get svc "$svc" -n "$ns" \
        -o jsonpath='{.spec.selector}' 2>/dev/null || true)
      if [[ -z "$selector" ]]; then continue; fi

      local deploy_name
      deploy_name=$(kubectl get deployments -n "$ns" \
        -o jsonpath="{.items[?(@.metadata.name=='${svc}')].metadata.name}" 2>/dev/null || true)

      if [[ -n "$deploy_name" ]]; then
        # Skip if this deployment was recently restarted (e.g. supervisor RAG reconnect)
        if [[ "$deploy_name" == "caipe-supervisor-agent" ]] && $SUPERVISOR_RAG_RESTARTED; then
          continue
        fi
        local pod_count
        pod_count=$(kubectl get deployment "$deploy_name" -n "$ns" \
          -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        if [[ "${pod_count:-0}" -eq 0 ]]; then
          warn "[auto-heal] Service ${svc} has no endpoints; restarting deployment/${deploy_name}"
          kubectl rollout restart "deployment/${deploy_name}" -n "$ns" &>/dev/null || true
          ((healed++))
        fi
      fi
    fi
  done

  return $healed
}

run_auto_heal() {
  local now
  now=$(date +%s)

  if (( now - AUTOHEAL_LAST_RUN < AUTOHEAL_INTERVAL )); then
    return
  fi
  AUTOHEAL_LAST_RUN=$now

  local total_healed=0

  # 1. Fix Pending PVCs with wrong storageClass
  auto_heal_pvcs caipe || total_healed=$((total_healed + $?))

  # 2. Fix crashing/errored pods
  auto_heal_pods caipe || total_healed=$((total_healed + $?))

  # 3. Fix RAG server configuration issues
  auto_heal_rag_server || total_healed=$((total_healed + $?))

  # 4. Restart supervisor if RAG is healthy but supervisor has RAG disabled
  auto_heal_supervisor_rag || total_healed=$((total_healed + $?))

  # 5. Fix services with no endpoints
  auto_heal_services caipe || total_healed=$((total_healed + $?))

  # 6. Scan running pod logs for errors (SSL, misconfig, etc.)
  auto_heal_pod_logs caipe || total_healed=$((total_healed + $?))

  # 7. Fix Langfuse secret missing from supervisor
  if $ENABLE_TRACING; then
    auto_heal_langfuse_secret || total_healed=$((total_healed + $?))
  fi

  if $ENABLE_TRACING; then
    auto_heal_pvcs langfuse || total_healed=$((total_healed + $?))
    auto_heal_pods langfuse || total_healed=$((total_healed + $?))
    auto_heal_services langfuse || total_healed=$((total_healed + $?))
  fi

  if [[ $total_healed -gt 0 ]]; then
    log "[auto-heal] Applied ${total_healed} remediation(s) this cycle"
  fi
}

# ─── Port Forward Monitor ───────────────────────────────────────────────────
PF_SVCS=()          # parallel array: "svc ns local_port remote_port label"
PF_FAIL_COUNT=()    # consecutive failure count per forward (for backoff)
PF_LAST_RESTART=()  # epoch of last restart per forward

start_pf() {
  local svc="$1" ns="$2" local_port="$3" remote_port="$4" label="$5"
  kill_port_on "$local_port"
  kubectl port-forward "svc/${svc}" -n "$ns" "${local_port}:${remote_port}" &>/dev/null &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  PF_PIDS+=($pid)
  PF_SVCS+=("${svc} ${ns} ${local_port} ${remote_port} ${label}")
  PF_FAIL_COUNT+=(0)
  PF_LAST_RESTART+=($(date +%s))
  log "${label}: http://localhost:${local_port}"
}

_pf_svc_ready() {
  local svc="$1" ns="$2"
  local ready
  ready=$(kubectl get endpoints "$svc" -n "$ns" -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || true)
  [[ -n "$ready" ]]
}

restart_pf() {
  local idx="$1"
  local entry="${PF_SVCS[$idx]}"
  # shellcheck disable=SC2086
  set -- $entry
  local svc="$1" ns="$2" local_port="$3" remote_port="$4"
  shift 4
  local label="$*"

  if ! _pf_svc_ready "$svc" "$ns"; then
    local fails=$(( ${PF_FAIL_COUNT[$idx]} + 1 ))
    PF_FAIL_COUNT[$idx]=$fails
    if [[ $fails -eq 1 ]]; then
      warn "Port-forward dropped for ${label}; waiting for service endpoint..."
    fi
    return 1
  fi

  kill_port_on "$local_port"
  sleep 1
  kubectl port-forward "svc/${svc}" -n "$ns" "${local_port}:${remote_port}" &>/dev/null &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  PF_PIDS[$idx]=$pid
  PF_LAST_RESTART[$idx]=$(date +%s)

  local prev_fails=${PF_FAIL_COUNT[$idx]}
  PF_FAIL_COUNT[$idx]=0

  if [[ $prev_fails -gt 0 ]]; then
    log "Reconnected ${label}: http://localhost:${local_port} (after ${prev_fails} retries)"
  else
    warn "Port-forward dropped for ${label}; restarted on http://localhost:${local_port}"
  fi
}

monitor_port_forwards() {
  step "Port-forwarding services"

  # Reset arrays so only start_pf entries are tracked (discard stale entries
  # from create_langfuse_api_keys or other earlier port-forwards)
  PF_PIDS=()
  PF_SVCS=()
  PF_FAIL_COUNT=()
  PF_LAST_RESTART=()

  start_pf caipe-supervisor-agent caipe "$SUPERVISOR_PORT" 8000 "Supervisor A2A"
  start_pf caipe-caipe-ui          caipe "$UI_PORT"         3000 "CAIPE UI"

  if $ENABLE_TRACING; then
    start_pf langfuse-web langfuse "$LANGFUSE_PORT" 3000 "Langfuse UI"
  fi

  if $ENABLE_AGENTGATEWAY; then
    start_pf agentgateway-proxy agentgateway-system "$AGENTGATEWAY_PORT" 80 "AgentGateway MCP"
  fi

  # Wait for port-forwards to become responsive before running tests
  local pf_wait=0
  while [[ $pf_wait -lt 15 ]]; do
    local all_up=true
    curl -sf -o /dev/null --max-time 2 "http://localhost:${SUPERVISOR_PORT}/.well-known/agent.json" 2>/dev/null || all_up=false
    curl -sf -o /dev/null --max-time 2 "http://localhost:${UI_PORT}/" 2>/dev/null || all_up=false
    if $ENABLE_TRACING; then
      curl -sf -o /dev/null --max-time 2 "http://localhost:${LANGFUSE_PORT}/api/public/health" 2>/dev/null || all_up=false
    fi
    $all_up && break
    sleep 2
    pf_wait=$((pf_wait + 2))
  done

  run_validation
  run_sanity_tests

  echo ""
  header "Services Ready"
  echo ""
  echo -e "  ${BOLD}Endpoints:${NC}"
  echo -e "    CAIPE UI        ${CYAN}http://localhost:${UI_PORT}${NC}"
  echo -e "    Supervisor A2A  ${CYAN}http://localhost:${SUPERVISOR_PORT}${NC}"
  if $ENABLE_RAG; then
    echo -e "    RAG Server      ${CYAN}http://localhost:${UI_PORT}/api/rag${NC}  (proxied by UI)"
  fi
  if $ENABLE_TRACING; then
    echo -e "    Langfuse UI     ${CYAN}http://localhost:${LANGFUSE_PORT}${NC}"
    echo -e "      Login: ${DIM}lab@lab.com / Lab12345!${NC}"
  fi
  if $ENABLE_AGENTGATEWAY; then
    echo -e "    AgentGateway    ${CYAN}http://localhost:${AGENTGATEWAY_PORT}${NC}"
    echo ""
    echo -e "  ${BOLD}MCP Client URLs (via AgentGateway):${NC}"
    local ag_svcs
    ag_svcs=$(kubectl get agentgatewaybackend -n caipe \
      -l app.kubernetes.io/managed-by=setup-caipe \
      -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
    if [[ -n "$ag_svcs" ]]; then
      while IFS= read -r backend_name; do
        [[ -z "$backend_name" ]] && continue
        local agent_short
        agent_short=$(echo "$backend_name" | sed 's/^mcp-//' | sed 's/-backend$//')
        echo -e "    ${DIM}http://localhost:${AGENTGATEWAY_PORT}/mcp/${agent_short}${NC}"
      done <<< "$ag_svcs"
    fi
  fi
  echo ""
  echo -e "  ${BOLD}Chart:${NC}   v${CAIPE_CHART_VERSION}"
  local agent_list="weather, netutils"
  $ENABLE_RAG && agent_list+=", rag"
  echo -e "  ${BOLD}Agents:${NC}  ${agent_list}"
  $AUTOHEAL_ENABLED && echo -e "  ${BOLD}Auto-heal:${NC} ${GREEN}enabled${NC} (every ${AUTOHEAL_INTERVAL}s)"
  echo ""
  if $ENABLE_TRACING; then
    echo -e "  ${BOLD}Retrieve Langfuse credentials:${NC}"
    echo -e "    ${DIM}kubectl get secret langfuse-credentials -n langfuse -o jsonpath='{.data}' | python3 -c \"import sys,json,base64; d=json.load(sys.stdin); print('\n'.join(f'{k}: {base64.b64decode(v).decode()}' for k,v in sorted(d.items())))\"${NC}"
    echo ""
  fi
  echo -e "  ${BOLD}CLI chat:${NC}"
  echo -e "    ${DIM}uvx https://github.com/cnoe-io/agent-chat-cli.git a2a${NC}"
  echo ""
  echo -e "  ${YELLOW}${BOLD}Keep this script running to maintain port-forwarding.${NC}"
  echo -e "  ${DIM}Press Ctrl+C to stop all services.${NC}"
  echo ""

  local sanity_last_run
  sanity_last_run=$(date +%s)

  while true; do
    local now
    now=$(date +%s)

    for i in "${!PF_PIDS[@]}"; do
      local _pf_port
      # shellcheck disable=SC2086
      _pf_port=$(echo ${PF_SVCS[$i]} | awk '{print $3}')

      if ! kill -0 "${PF_PIDS[$i]}" 2>/dev/null; then
        # PID is gone — but check if another process already owns the port
        # (e.g., a previous restart_pf spawned a new PID we lost track of)
        local _actual_pid
        _actual_pid=$(lsof -ti :"$_pf_port" 2>/dev/null | head -1 || true)
        if [[ -n "$_actual_pid" ]]; then
          # Port is still served; adopt the existing PID
          PF_PIDS[$i]=$_actual_pid
          continue
        fi

        local fails=${PF_FAIL_COUNT[$i]}
        local last=${PF_LAST_RESTART[$i]}

        # Exponential backoff: 5s, 10s, 20s, 40s ... capped at 60s
        local backoff=$(( 5 * (1 << (fails > 5 ? 5 : fails)) ))
        [[ $backoff -gt 60 ]] && backoff=60

        if (( now - last < backoff )); then
          continue
        fi

        restart_pf "$i" || true
      fi
    done

    # Run auto-heal if enabled
    if $AUTOHEAL_ENABLED; then
      run_auto_heal
    fi

    # Periodic sanity check every 5 minutes
    if (( now - sanity_last_run >= 300 )); then
      echo ""
      echo -e "  ${DIM}── Periodic health check ($(date '+%H:%M:%S')) ──${NC}"
      run_validation || true
      sanity_last_run=$now
    fi

    sleep 10
  done
}

# ─── Cleanup ─────────────────────────────────────────────────────────────────
cmd_cleanup() {
  echo ""
  echo -e "${BLUE}${BOLD}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}${BOLD}║       CAIPE Lab Environment Cleanup          ║${NC}"
  echo -e "${BLUE}${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  if $AUTO_YES; then
    echo -e "  ${RED}${BOLD}WARNING:${NC} This will delete ALL CAIPE and Langfuse resources"
    echo -e "  ${RED}including Helm releases, secrets, PVCs, and namespaces.${NC}"
    echo ""
    prompt "Type 'yes' to confirm: "
    tty_read -r confirm
    if [[ "$confirm" != "yes" ]]; then
      log "Aborted"
      exit 0
    fi
    echo ""
  fi

  check_prerequisites

  # Kill any port-forwards on known ports
  for port in "$LANGFUSE_PORT" "$SUPERVISOR_PORT" "$UI_PORT" "$AGENTGATEWAY_PORT"; do
    kill_port_on "$port"
  done

  step "Helm releases"

  if helm status caipe -n caipe &>/dev/null; then
    if ask_yn "Uninstall CAIPE Helm release?" "y"; then
      helm uninstall caipe -n caipe
      log "CAIPE uninstalled"
    fi
  else
    log "No CAIPE release found"
  fi

  if helm status langfuse -n langfuse &>/dev/null; then
    if ask_yn "Uninstall Langfuse Helm release?" "y"; then
      helm uninstall langfuse -n langfuse
      log "Langfuse uninstalled"
    fi
  else
    log "No Langfuse release found"
  fi

  if helm status vllm -n caipe &>/dev/null; then
    if ask_yn "Uninstall vLLM Helm release?" "y"; then
      helm uninstall vllm -n caipe
      log "vLLM uninstalled"
    fi
  else
    log "No vLLM release found"
  fi

  # LiteLLM proxy (deployed via kubectl, not Helm)
  if kubectl get deployment litellm-proxy -n caipe &>/dev/null; then
    if ask_yn "Delete LiteLLM proxy resources?" "y"; then
      kubectl delete deployment,svc,configmap -l app=litellm-proxy -n caipe 2>/dev/null || true
      log "LiteLLM proxy deleted"
    fi
  fi

  # AgentGateway
  if helm status agentgateway -n agentgateway-system &>/dev/null; then
    if ask_yn "Uninstall AgentGateway?" "y"; then
      # Remove MCP backends and routes first
      kubectl delete agentgatewaybackend,httproute -l app.kubernetes.io/managed-by=setup-caipe -n caipe 2>/dev/null || true
      kubectl delete gateway agentgateway-proxy -n agentgateway-system 2>/dev/null || true
      helm uninstall agentgateway -n agentgateway-system 2>/dev/null || true
      helm uninstall agentgateway-crds -n agentgateway-system 2>/dev/null || true
      kubectl delete namespace agentgateway-system 2>/dev/null || true
      log "AgentGateway uninstalled"
    fi
  fi

  step "Kubernetes resources"

  if kubectl get secret llm-secret -n caipe &>/dev/null || kubectl get secret langfuse-secret -n caipe &>/dev/null; then
    if ask_yn "Delete all secrets in caipe namespace?" "y"; then
      kubectl delete secret --all -n caipe 2>/dev/null || true
      log "Secrets in caipe namespace deleted"
    fi
  fi

  local caipe_pvc_count langfuse_pvc_count
  caipe_pvc_count=$(kubectl get pvc -n caipe --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$caipe_pvc_count" -gt 0 ]]; then
    if ask_yn "Delete CAIPE persistent volume claims ($caipe_pvc_count PVCs)?" "y"; then
      kubectl delete pvc --all -n caipe 2>/dev/null || true
      log "CAIPE PVCs deleted"
    fi
  fi

  langfuse_pvc_count=$(kubectl get pvc -n langfuse --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$langfuse_pvc_count" -gt 0 ]]; then
    if ask_yn "Delete Langfuse persistent volume claims ($langfuse_pvc_count PVCs)?" "y"; then
      kubectl delete pvc --all -n langfuse 2>/dev/null || true
      log "Langfuse PVCs deleted"
    fi
  fi

  step "Namespaces"

  local caipe_resources langfuse_resources
  caipe_resources=$(kubectl get all -n caipe --no-headers 2>/dev/null | wc -l | tr -d ' ')
  langfuse_resources=$(kubectl get all -n langfuse --no-headers 2>/dev/null | wc -l | tr -d ' ')

  if [[ "$caipe_resources" -eq 0 ]]; then
    if ask_yn "Delete empty caipe namespace?" "n"; then
      kubectl delete namespace caipe 2>/dev/null || true
      log "caipe namespace deleted"
    fi
  elif [[ "$caipe_resources" -gt 0 ]]; then
    warn "caipe namespace still has $caipe_resources resources, skipping deletion"
  fi

  if [[ "$langfuse_resources" -eq 0 ]]; then
    if ask_yn "Delete empty langfuse namespace?" "n"; then
      kubectl delete namespace langfuse 2>/dev/null || true
      log "langfuse namespace deleted"
    fi
  elif [[ "$langfuse_resources" -gt 0 ]]; then
    warn "langfuse namespace still has $langfuse_resources resources, skipping deletion"
  fi

  if command -v kind &>/dev/null; then
    step "Kind cluster"

    local clusters
    clusters=$(kind get clusters 2>/dev/null || true)
    if [[ -n "$clusters" ]]; then
      if $AUTO_YES; then
        warn "Skipping Kind cluster deletion in --yes mode (use interactive cleanup)"
      else
        echo -e "  ${DIM}Running Kind clusters:${NC}"
        while IFS= read -r c; do
          echo -e "    - $c"
        done <<< "$clusters"
        echo ""
        if ask_yn "Delete a Kind cluster?" "n"; then
          prompt "Enter the cluster name to delete: "
          tty_read -r del_cluster
          if [[ -n "$del_cluster" ]] && echo "$clusters" | grep -q "^${del_cluster}$"; then
            kind delete cluster --name "$del_cluster"
            log "Cluster '${del_cluster}' deleted"
          else
            err "Cluster '${del_cluster}' not found"
          fi
        fi
      fi
    else
      log "No Kind clusters found"
    fi
  fi

  echo ""
  log "Cleanup complete"
}

# ─── Status ──────────────────────────────────────────────────────────────────
cmd_status() {
  echo ""
  header "Cluster status"
  echo ""
  echo -e "  ${BOLD}CAIPE pods:${NC}"
  kubectl get pods -n caipe 2>/dev/null || warn "No pods in caipe namespace"
  echo ""
  echo -e "  ${BOLD}Langfuse pods:${NC}"
  kubectl get pods -n langfuse 2>/dev/null || warn "No pods in langfuse namespace"
  if kubectl get namespace agentgateway-system &>/dev/null 2>&1; then
    echo ""
    echo -e "  ${BOLD}AgentGateway pods:${NC}"
    kubectl get pods -n agentgateway-system 2>/dev/null || warn "No pods in agentgateway-system namespace"
  fi
  echo ""
  echo -e "  ${BOLD}Helm releases:${NC}"
  helm list -A 2>/dev/null
}

# ─── Auto-Detect Features ────────────────────────────────────────────────────
detect_deployed_features() {
  if helm status langfuse -n langfuse &>/dev/null; then
    ENABLE_TRACING=true
  fi
  if kubectl get svc rag-server -n caipe &>/dev/null 2>&1; then
    ENABLE_RAG=true
  fi
  if kubectl get pods -n caipe -l app.kubernetes.io/name=agent-ontology \
       --no-headers 2>/dev/null | grep -q Running; then
    ENABLE_GRAPH_RAG=true
  fi
  if helm status vllm -n caipe &>/dev/null; then
    ENABLE_VLLM=true
  fi
  if helm status agentgateway -n agentgateway-system &>/dev/null; then
    ENABLE_AGENTGATEWAY=true
  fi
  # Detect chart version from Helm
  if [[ -z "$CAIPE_CHART_VERSION" ]]; then
    CAIPE_CHART_VERSION=$(helm get metadata caipe -n caipe -o json 2>/dev/null \
      | jq -r '.version // empty' 2>/dev/null || echo "unknown")
  fi
}

# ─── Port-Forward (standalone) ────────────────────────────────────────────────
cmd_port_forward() {
  check_prerequisites

  if ! helm status caipe -n caipe &>/dev/null; then
    err "CAIPE is not deployed. Run setup first."
    exit 1
  fi

  detect_deployed_features
  monitor_port_forwards
}

# ─── Validate (standalone) ───────────────────────────────────────────────────
cmd_validate() {
  check_prerequisites

  if ! helm status caipe -n caipe &>/dev/null; then
    err "CAIPE is not deployed. Run setup first."
    exit 1
  fi

  detect_deployed_features

  step "Port-forwarding for validation"
  start_pf caipe-supervisor-agent caipe "$SUPERVISOR_PORT" 8000 "Supervisor A2A"
  start_pf caipe-caipe-ui          caipe "$UI_PORT"         3000 "CAIPE UI"
  if $ENABLE_TRACING; then
    start_pf langfuse-web langfuse "$LANGFUSE_PORT" 3000 "Langfuse UI"
  fi
  sleep 3

  run_validation
  run_sanity_tests
}

# ─── Ensure Healthy ──────────────────────────────────────────────────────────
# Convergence loop that runs auto-heal cycles until all pods are healthy
# or a timeout is reached. Runs BEFORE "Services Ready" so the user gets
# a functioning system.
ensure_healthy() {
  step "Ensuring all services are healthy"
  local timeout=180 interval=10 elapsed=0

  while [[ $elapsed -lt $timeout ]]; do
    # Exclude Terminating pods from counts to avoid inflated totals during rollouts
    local total ready
    total=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
      | awk '$3!="Terminating"' | wc -l | tr -d ' ')
    ready=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
      | awk '$3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
      | wc -l | tr -d ' ')

    local lf_ok=true
    if $ENABLE_TRACING; then
      local lf_total lf_ready
      lf_total=$(kubectl get pods -n langfuse --no-headers 2>/dev/null \
        | awk '$3!="Terminating"' | wc -l | tr -d ' ')
      lf_ready=$(kubectl get pods -n langfuse --no-headers 2>/dev/null \
        | awk '$3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
        | wc -l | tr -d ' ')
      [[ "$lf_total" -eq 0 || "$lf_total" -ne "$lf_ready" ]] && lf_ok=false
    fi

    if [[ "$total" -gt 0 && "$total" -eq "$ready" ]] && $lf_ok; then
      log "All pods healthy (caipe: ${ready}/${total})"
      return 0
    fi

    printf "\r${DIM}  Converging: caipe %d/%d ready  (%ds/${timeout}s)${NC}  " "$ready" "$total" "$elapsed"

    run_auto_heal

    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  echo ""
  warn "Not all pods converged within ${timeout}s; continuing anyway"
  run_auto_heal
}

# ─── Main ────────────────────────────────────────────────────────────────────
cmd_setup() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  cat <<'BANNER'
   ██████╗ █████╗ ██╗██████╗ ███████╗
  ██╔════╝██╔══██╗██║██╔══██╗██╔════╝
  ██║     ███████║██║██████╔╝█████╗
  ██║     ██╔══██║██║██╔═══╝ ██╔══╝
  ╚██████╗██║  ██║██║██║     ███████╗
   ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚══════╝
BANNER
  echo -e "${NC}"
  echo -e "${BLUE}${BOLD}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}${BOLD}║${NC}  ${BOLD}Welcome to CAIPE Setup${NC}                       ${BLUE}${BOLD}║${NC}"
  echo -e "${BLUE}${BOLD}║${NC}  Your 🤖 Agentic AI automation super hero 🦸  ${BLUE}${BOLD}║${NC}"
  echo -e "${BLUE}${BOLD}║${NC}                                               ${BLUE}${BOLD}║${NC}"
  echo -e "${BLUE}${BOLD}║${NC}  ${DIM}Multi-Agent System on Kubernetes${NC}             ${BLUE}${BOLD}║${NC}"
  echo -e "${BLUE}${BOLD}╚═══════════════════════════════════════════════╝${NC}"
  echo ""

  check_prerequisites
  choose_cluster

  # ── Fast re-run detection ──
  # If CAIPE is already deployed, offer the user a shortcut instead of
  # running the full setup flow again.
  if helm status caipe -n caipe &>/dev/null; then
    local deployed_version
    deployed_version=$(helm get metadata caipe -n caipe -o json 2>/dev/null \
      | jq -r '.version // empty' 2>/dev/null || echo "unknown")
    local running_pods
    running_pods=$(kubectl get pods -n caipe --no-headers 2>/dev/null \
      | awk '$3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) c++} END{print c+0}')

    echo ""
    echo -e "  ${GREEN}${BOLD}CAIPE is already deployed${NC} (v${deployed_version}, ${running_pods} pods running)"
    echo ""

    local rerun_choice=""
    if $FORCE_UPGRADE; then
      rerun_choice=2
    elif $NON_INTERACTIVE; then
      # Non-interactive: monitor only unless flags imply an upgrade
      if [[ -n "${CAIPE_CHART_VERSION:-}" ]] || $ENABLE_RAG || $ENABLE_GRAPH_RAG \
           || $ENABLE_TRACING || $ENABLE_AGENTGATEWAY || $INJECT_CORPORATE_CA || [[ ${#INGEST_URLS[@]} -gt 0 ]]; then
        rerun_choice=2
      else
        rerun_choice=1
      fi
    else
      echo -e "    ${BOLD}1)${NC} Monitor only — port-forwarding + auto-heal (fastest)"
      echo -e "    ${BOLD}2)${NC} Upgrade — re-collect credentials, re-deploy charts"
      echo -e "    ${BOLD}3)${NC} Full re-install — run full setup from scratch"
      echo ""
      prompt "Select an option ${CYAN}[1]${NC}${BOLD}: "
      tty_read -r rerun_choice
      rerun_choice="${rerun_choice:-1}"
    fi

    case "$rerun_choice" in
      1)
        log "Skipping to monitor mode"
        detect_deployed_features
        ensure_healthy
        monitor_port_forwards
        return
        ;;
      2)
        log "Upgrading existing deployment"
        detect_deployed_features
        ;;
      3)
        log "Running full setup from scratch"
        ;;
      *)
        err "Invalid choice"; exit 1
        ;;
    esac
  fi

  choose_chart_version
  collect_credentials
  choose_features
  create_namespace_and_secrets

  if $ENABLE_TRACING; then
    deploy_langfuse
    create_langfuse_api_keys
  fi

  if $INJECT_CORPORATE_CA; then
    prepare_corporate_ca
  fi

  # Deploy vLLM + LiteLLM before CAIPE so the endpoints are available
  if $ENABLE_VLLM; then
    deploy_vllm
    deploy_litellm
  fi

  deploy_caipe
  post_deploy_patches

  # AgentGateway runs after CAIPE so MCP services exist for auto-discovery
  if $ENABLE_AGENTGATEWAY; then
    deploy_agentgateway
  fi

  if [[ ${#INGEST_URLS[@]} -gt 0 ]]; then
    ingest_knowledge_base
  fi

  ensure_healthy
  monitor_port_forwards
}

usage() {
  cat <<EOF

Usage: $(basename "$0") [COMMAND] [OPTIONS]

Commands:
  setup         Interactive setup: cluster, chart version, credentials,
                features (RAG, tracing), deploy, port-forward (default)
  port-forward  Start port-forwarding, run validation + sanity tests,
                monitor with auto-restart and periodic health checks (5m)
  validate      Run validation and sanity tests (A2A, agents, RAG, tracing)
  cleanup       Interactive teardown: uninstall releases, delete secrets,
                PVCs, namespaces, and optionally the Kind cluster
  nuke          Non-interactive cleanup (same as: cleanup --yes)
  status        Show pod status and Helm releases

Options:
  --non-interactive  Skip all prompts (use current context, latest chart,
                     defaults for endpoint/model, no RAG/tracing unless flagged)
  --create-cluster   Create a Kind cluster if no kubectl context exists
                     (default name: caipe, override with KIND_CLUSTER_NAME)
  --rag              Enable RAG stack (vector-only by default)
  --graph-rag        Enable Graph RAG (Neo4j + ontology agent; implies --rag)
  --corporate-ca     Apply corporate TLS proxy CA patch to pods (for networks
                     with TLS inspection, e.g. Cisco Secure Access, Zscaler)
  --tracing          Enable Langfuse tracing (with --non-interactive, or pre-selects in interactive)
  --agentgateway     Deploy AgentGateway to federate MCP servers behind a single endpoint
  --persistence      Enable Redis persistence for checkpoints and cross-thread memory
                     (deploys langgraph-redis subchart; enables fact extraction)
                     (allows Cursor/VS Code/Claude Code to connect to all MCP servers at once)
  --ingest-url=URL   Ingest a URL into the RAG knowledge base after deploy
                     (implies --rag; repeatable for multiple URLs; uses sitemap crawl)
  --auto-heal        Enable auto-heal loop (default: on). Detects and fixes crashing pods,
                     broken PVCs, missing secrets, RAG misconfig (every 30s)
  --upgrade          Skip to upgrade path when CAIPE is already deployed
                     (re-collect credentials + re-deploy; skips interactive menu)
  --no-auto-heal     Disable the auto-heal loop
  --yes, -y          Auto-confirm cleanup prompts (requires typing 'yes')
  -h, --help         Show this help message

Re-run behavior:
  When CAIPE is already deployed, setup detects it and offers:
    1) Monitor only — port-forwarding + auto-heal (fastest, default)
    2) Upgrade — re-collect credentials, re-deploy charts
    3) Full re-install — run full setup from scratch
  Use --upgrade to auto-select option 2 without the interactive menu.

Environment variables (all optional):
  LLM_PROVIDER            LLM provider: anthropic-claude (default) | aws-bedrock | openai
  OPENAI_API_KEY          Pre-set OpenAI API key (skips prompt)
  OPENAI_MODEL_NAME       OpenAI model (default: gpt-5.2; used by LLMFactory)
  ANTHROPIC_API_KEY       Pre-set Anthropic API key (skips prompt)
  ANTHROPIC_MODEL_NAME    Anthropic model (default: claude-haiku-4-5)
  AWS_ACCESS_KEY_ID       AWS access key for Bedrock
  AWS_SECRET_ACCESS_KEY   AWS secret key for Bedrock
  AWS_PROFILE             AWS profile name (keys resolved from ~/.aws/credentials)
  AWS_REGION              AWS region (default: us-east-2)
  AWS_BEDROCK_MODEL_ID    Bedrock model (default: us.anthropic.claude-3-7-sonnet-20250219-v1:0)
  CAIPE_CHART_VERSION     Pre-set chart version (skips version picker)
  EMBEDDINGS_MODEL        Embedding model (default: text-embedding-3-large)
  EMBEDDINGS_PROVIDER     Embedding provider (default: openai)
  ENABLE_VLLM             Deploy vLLM + LiteLLM in-cluster (default: false, or select option 4)
  HF_TOKEN                HuggingFace token (for vLLM model download)
  VLLM_MODEL              vLLM model (default: openai/gpt-oss-20b)
  VLLM_GPU_COUNT          GPUs per vLLM replica (default: 1)
  ENABLE_AGENTGATEWAY     Enable AgentGateway (default: false)
  AGENTGATEWAY_VERSION    AgentGateway Helm chart version (default: v2.2.1)

LLM provider credentials are read from (in order):
  OpenAI:    1) OPENAI_API_KEY env       2) ~/.config/openai.txt    3) prompt
  Anthropic: 1) ANTHROPIC_API_KEY env    2) ~/.config/claude.txt    3) prompt
  Bedrock:   1) AWS_ACCESS_KEY_ID env    2) ~/.config/bedrock.txt
             3) AWS_PROFILE env          4) ~/.aws/credentials [default]
             5) prompt

  ~/.config/bedrock.txt formats:
    .env style (KEY=VALUE per line, recommended):
      AWS_ACCESS_KEY_ID=AKIA...
      AWS_SECRET_ACCESS_KEY=...
      AWS_REGION=us-east-2
      AWS_BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
    key-pair (single line):   ACCESS_KEY_ID:SECRET_ACCESS_KEY
    profile name (single line): my-profile-name

Supported providers (via cnoe-agent-utils LLMFactory):
  openai, anthropic-claude, azure-openai, aws-bedrock,
  google-gemini, gcp-vertexai, groq

Examples:
  $(basename "$0")                                        # interactive setup (default)
  $(basename "$0") --non-interactive --create-cluster     # create Kind cluster + deploy Claude (default)
  $(basename "$0") --non-interactive --rag --tracing      # Claude + vector RAG + tracing
  $(basename "$0") --non-interactive --graph-rag --tracing # Claude + Graph RAG + tracing
  $(basename "$0") --corporate-ca --rag                   # RAG behind corporate TLS proxy
  $(basename "$0") --rag --tracing                        # full stack (auto-heal on by default)
  $(basename "$0") --non-interactive --rag --ingest-url=https://cnoe-io.github.io/ai-platform-engineering/  # RAG + ingest CAIPE docs
  $(basename "$0") --upgrade                              # re-run: upgrade existing deployment
  $(basename "$0") --upgrade --non-interactive             # unattended upgrade (no prompts)
  $(basename "$0")                                        # re-run: offers monitor/upgrade/full menu
  $(basename "$0") cleanup                                # interactive teardown
  $(basename "$0") nuke                                   # teardown (confirm once with 'yes')
  LLM_PROVIDER=openai $(basename "$0") --non-interactive  # OpenAI instead of Claude
  LLM_PROVIDER=aws-bedrock $(basename "$0") --non-interactive       # AWS Bedrock (uses profile)
  ENABLE_VLLM=true $(basename "$0") --non-interactive                    # vLLM + LiteLLM (gpt-oss-20B in-cluster)
  $(basename "$0") --non-interactive --agentgateway                     # deploy with AgentGateway for MCP access
  $(basename "$0") --non-interactive --agentgateway --rag               # full stack with AgentGateway + RAG
  $(basename "$0") --non-interactive --persistence                      # deploy with Redis persistence
  $(basename "$0") --non-interactive --rag --persistence                # RAG + Redis persistence (recommended)

EOF
  exit 0
}

# Parse flags from any position
args=()
for arg in "$@"; do
  case "$arg" in
    --yes|-y)          AUTO_YES=true ;;
    --non-interactive) NON_INTERACTIVE=true ;;
    --create-cluster)  CREATE_CLUSTER=true ;;
    --rag)             ENABLE_RAG=true ;;
    --graph-rag)       ENABLE_GRAPH_RAG=true ;;
    --corporate-ca)    INJECT_CORPORATE_CA=true ;;
    --tracing)         ENABLE_TRACING=true ;;
    --agentgateway)    ENABLE_AGENTGATEWAY=true ;;
    --persistence)     ENABLE_PERSISTENCE=true ;;
    --upgrade)         FORCE_UPGRADE=true ;;
    --auto-heal)       AUTOHEAL_ENABLED=true ;;
    --no-auto-heal)    AUTOHEAL_ENABLED=false ;;
    --ingest-url=*)    INGEST_URLS+=("${arg#--ingest-url=}") ;;
    *)                 args+=("$arg") ;;
  esac
done

$ENABLE_GRAPH_RAG && ENABLE_RAG=true
[[ ${#INGEST_URLS[@]} -gt 0 ]] && ENABLE_RAG=true

case "${args[0]:-setup}" in
  setup)        cmd_setup ;;
  port-forward) cmd_port_forward ;;
  validate)     cmd_validate ;;
  cleanup)      cmd_cleanup ;;
  nuke)         AUTO_YES=true; cmd_cleanup ;;
  status)       cmd_status ;;
  -h|--help)    usage ;;
  *)            err "Unknown command: ${args[0]}"; usage ;;
esac

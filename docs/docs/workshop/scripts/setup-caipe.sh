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
OPENAI_API_KEY=""
OPENAI_ENDPOINT="https://api.openai.com/v1"
OPENAI_MODEL_NAME="gpt-5.2"
ANTHROPIC_API_KEY=""
ANTHROPIC_MODEL_NAME="claude-haiku-4-5"
AWS_BEDROCK_MODEL_ID="${AWS_BEDROCK_MODEL_ID:-us.anthropic.claude-3-7-sonnet-20250219-v1:0}"
AWS_BEDROCK_PROVIDER="${AWS_BEDROCK_PROVIDER:-anthropic}"
AWS_REGION="${AWS_REGION:-us-east-2}"
AWS_PROFILE="${AWS_PROFILE:-}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
AWS_BEDROCK_ENABLE_PROMPT_CACHE="${AWS_BEDROCK_ENABLE_PROMPT_CACHE:-}"
LLM_PROVIDER="${LLM_PROVIDER:-openai}"
EMBEDDINGS_MODEL="${EMBEDDINGS_MODEL:-text-embedding-3-large}"
EMBEDDINGS_PROVIDER="${EMBEDDINGS_PROVIDER:-openai}"
ENABLE_GRAPH_RAG=false
INJECT_CORPORATE_CA=false
LANGFUSE_PUBLIC_KEY=""
LANGFUSE_SECRET_KEY=""
PF_PIDS=()
AUTO_YES=false
NON_INTERACTIVE=false

cleanup_on_exit() {
  for pid in "${PF_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  rm -f /tmp/langfuse-cookies /tmp/caipe-validation-*.log
}
trap cleanup_on_exit EXIT

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()     { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  !${NC} $*"; }
err()     { echo -e "${RED}  ✗${NC} $*" >&2; }
step()    { echo -e "\n${CYAN}${BOLD}━━━ $* ━━━${NC}"; }
header()  { echo -e "\n${BLUE}${BOLD}$*${NC}"; }
prompt()  { echo -en "${BOLD}  ▸ $*${NC}"; }

ask_yn() {
  local question="$1" default="${2:-y}"
  if $AUTO_YES; then return 0; fi
  local yn_hint
  if [[ "$default" == "y" ]]; then yn_hint="[Y/n]"; else yn_hint="[y/N]"; fi
  prompt "$question $yn_hint "
  read -r answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy]$ ]]
}

wait_for_pods() {
  local ns="$1" timeout="${2:-300}" interval=5 elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local total ready
    total=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    ready=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
      | awk '$3=="Running" && $2~"^[0-9]+/[0-9]+$" {split($2,a,"/"); if(a[1]==a[2]) print}' \
      | wc -l | tr -d ' ')
    if [[ "$total" -gt 0 && "$total" -eq "$ready" ]]; then
      log "All $total pods in ${ns} are running"
      return 0
    fi
    printf "\r${DIM}  Waiting for pods in %-10s  %d/%d ready  (%ds)${NC}  " "$ns" "$ready" "$total" "$elapsed"
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
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
      err "No current kubectl context; cannot use non-interactive mode"
      exit 1
    fi
    CLUSTER_NAME="$current_ctx"
    log "Using current context '${current_ctx}'"
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
  prompt "Select an option [${default_choice}]: "
  read -r choice
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
      prompt "Enter a name for the new cluster [caipe]: "
      read -r CLUSTER_NAME
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
      prompt "Select a context [1]: "
      read -r ctx_choice
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
    prompt "Chart version [${versions[0]}]: "
    read -r input
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

    prompt "Select a version [1]: "
    read -r choice
    choice="${choice:-1}"

    if [[ "$choice" -eq "$i" ]]; then
      prompt "Enter chart version: "
      read -r CAIPE_CHART_VERSION
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
  if ! $NON_INTERACTIVE; then
    echo ""
    echo -e "  ${DIM}Select your LLM provider (powered by cnoe-agent-utils LLMFactory):${NC}"
    echo -e "    ${BOLD}1)${NC} OpenAI           ${DIM}(gpt-5.2, gpt-4.1, etc.)${NC}"
    echo -e "    ${BOLD}2)${NC} Anthropic Claude  ${DIM}(claude-haiku-4-5, claude-sonnet-4, etc.)${NC}"
    echo -e "    ${BOLD}3)${NC} AWS Bedrock       ${DIM}(Claude on Bedrock, cross-region inference)${NC}"
    echo ""
    prompt "Select provider [1]: "
    read -r provider_choice
    provider_choice="${provider_choice:-1}"
    case "$provider_choice" in
      1) LLM_PROVIDER="openai" ;;
      2) LLM_PROVIDER="anthropic-claude" ;;
      3) LLM_PROVIDER="aws-bedrock" ;;
      *) err "Invalid choice"; exit 1 ;;
    esac
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
    read -rs ANTHROPIC_API_KEY
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
    prompt "Select model [1]: "
    read -r model_choice
    model_choice="${model_choice:-1}"
    case "$model_choice" in
      1) ANTHROPIC_MODEL_NAME="claude-haiku-4-5" ;;
      2) ANTHROPIC_MODEL_NAME="claude-sonnet-4-20250514" ;;
      3) ANTHROPIC_MODEL_NAME="claude-opus-4-20250514" ;;
      4)
        prompt "Enter Anthropic model name: "
        read -r ANTHROPIC_MODEL_NAME
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
    prompt "Select auth method [1]: "
    read -r auth_choice
    auth_choice="${auth_choice:-1}"
    case "$auth_choice" in
      1)
        prompt "AWS Access Key ID: "
        read -r AWS_ACCESS_KEY_ID
        prompt "AWS Secret Access Key: "
        read -rs AWS_SECRET_ACCESS_KEY
        echo ""
        if [[ -z "$AWS_ACCESS_KEY_ID" || -z "$AWS_SECRET_ACCESS_KEY" ]]; then
          err "Both access key and secret key are required"
          exit 1
        fi
        log "AWS access keys received"
        ;;
      2)
        prompt "AWS profile name [default]: "
        read -r input
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
    prompt "AWS region [${AWS_REGION}]: "
    read -r input
    AWS_REGION="${input:-$AWS_REGION}"

    echo ""
    echo -e "  ${DIM}Bedrock model:${NC}"
    echo -e "    ${BOLD}1)${NC} us.anthropic.claude-3-7-sonnet-20250219-v1:0  ${DIM}(default)${NC}"
    echo -e "    ${BOLD}2)${NC} us.anthropic.claude-sonnet-4-20250514-v1:0"
    echo -e "    ${BOLD}3)${NC} us.anthropic.claude-haiku-4-20250414-v1:0     ${DIM}(fast, low cost)${NC}"
    echo -e "    ${BOLD}4)${NC} Custom"
    echo ""
    prompt "Select model [1]: "
    read -r model_choice
    model_choice="${model_choice:-1}"
    case "$model_choice" in
      1) AWS_BEDROCK_MODEL_ID="us.anthropic.claude-3-7-sonnet-20250219-v1:0" ;;
      2) AWS_BEDROCK_MODEL_ID="us.anthropic.claude-sonnet-4-20250514-v1:0" ;;
      3) AWS_BEDROCK_MODEL_ID="us.anthropic.claude-haiku-4-20250414-v1:0" ;;
      4)
        prompt "Enter Bedrock model ID: "
        read -r AWS_BEDROCK_MODEL_ID
        if [[ -z "$AWS_BEDROCK_MODEL_ID" ]]; then
          err "Model ID is required"
          exit 1
        fi
        ;;
      *) err "Invalid choice"; exit 1 ;;
    esac

    prompt "Bedrock provider [${AWS_BEDROCK_PROVIDER}]: "
    read -r input
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
    read -rs OPENAI_API_KEY
    echo ""
    if [[ -z "$OPENAI_API_KEY" ]]; then
      err "API key is required"
      exit 1
    fi
    log "API key received"
  fi

  if ! $NON_INTERACTIVE; then
    prompt "OpenAI endpoint [${OPENAI_ENDPOINT}]: "
    read -r input
    OPENAI_ENDPOINT="${input:-$OPENAI_ENDPOINT}"

    prompt "Model name [${OPENAI_MODEL_NAME}]: "
    read -r input
    OPENAI_MODEL_NAME="${input:-$OPENAI_MODEL_NAME}"
  fi
  log "Provider: ${LLM_PROVIDER}  Endpoint: ${OPENAI_ENDPOINT}  Model: ${OPENAI_MODEL_NAME}"
}

choose_features() {
  step "Feature selection"

  echo -e "  ${DIM}Base setup always includes: supervisor, weather, and NetUtils agents${NC}"

  if $NON_INTERACTIVE; then
    if $ENABLE_RAG; then
      log "RAG enabled (--rag)"
      $ENABLE_GRAPH_RAG && log "Graph RAG enabled (--graph-rag)" || log "Graph RAG disabled (pass --graph-rag to enable)"
    else
      log "RAG skipped (pass --rag to enable)"
    fi
    $ENABLE_TRACING && log "Tracing enabled (--tracing)" || log "Tracing skipped (pass --tracing to enable)"
    return
  fi

  echo ""

  if ask_yn "Enable RAG (knowledge base retrieval)?" "n"; then
    ENABLE_RAG=true
    log "RAG enabled"

    prompt "Embeddings provider [${EMBEDDINGS_PROVIDER}]: "
    read -r input
    EMBEDDINGS_PROVIDER="${input:-$EMBEDDINGS_PROVIDER}"

    echo ""
    echo -e "  ${DIM}Embeddings model:${NC}"
    echo -e "    ${BOLD}1)${NC} text-embedding-3-large  ${DIM}(default, higher quality)${NC}"
    echo -e "    ${BOLD}2)${NC} text-embedding-3-small  ${DIM}(faster, lower cost)${NC}"
    echo -e "    ${BOLD}3)${NC} Custom"
    echo ""
    prompt "Select embeddings model [1]: "
    read -r emb_choice
    emb_choice="${emb_choice:-1}"
    case "$emb_choice" in
      1) EMBEDDINGS_MODEL="text-embedding-3-large" ;;
      2) EMBEDDINGS_MODEL="text-embedding-3-small" ;;
      3)
        prompt "Enter custom embeddings model name: "
        read -r EMBEDDINGS_MODEL
        if [[ -z "$EMBEDDINGS_MODEL" ]]; then
          err "Model name is required"
          exit 1
        fi
        ;;
      *) err "Invalid choice"; exit 1 ;;
    esac
    log "Embeddings: ${EMBEDDINGS_PROVIDER} / ${EMBEDDINGS_MODEL}"

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

  kubectl create secret generic llm-secret -n caipe \
    "${secret_args[@]}" \
    --dry-run=client -o yaml | kubectl apply -f - &>/dev/null
  log "llm-secret created (provider: ${LLM_PROVIDER})"
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
    --set s3.secretAccessKey.value="$minio_pw" &>/dev/null
  log "Langfuse Helm release deployed"

  wait_for_pods langfuse 420
}

create_langfuse_api_keys() {
  step "Creating Langfuse account and API keys"

  kill_port_on "$LANGFUSE_PORT"
  kubectl port-forward svc/langfuse-web -n langfuse "${LANGFUSE_PORT}:3000" &>/dev/null &
  PF_PIDS+=($!)
  sleep 4

  local base="http://localhost:${LANGFUSE_PORT}"
  if ! curl -sf "${base}/api/auth/providers" &>/dev/null; then
    err "Cannot reach Langfuse at ${base}"
    return 1
  fi

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

  kubectl create secret generic langfuse-secret -n caipe \
    --from-literal=LANGFUSE_SECRET_KEY="$LANGFUSE_SECRET_KEY" \
    --from-literal=LANGFUSE_PUBLIC_KEY="$LANGFUSE_PUBLIC_KEY" \
    --dry-run=client -o yaml | kubectl apply -f - &>/dev/null
  log "langfuse-secret created in caipe namespace"

  kill "${PF_PIDS[-1]}" 2>/dev/null || true
  unset 'PF_PIDS[-1]'
  rm -f /tmp/langfuse-cookies
}

inject_corporate_ca() {
  step "Corporate CA injection"

  local test_host="api.openai.com"
  local ns="caipe"
  local cm_name="corporate-ca-bundle"
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" RETURN

  log "Extracting CA chain from ${test_host} via current network..."
  local proxy_chain="${tmp_dir}/proxy-chain.pem"
  if ! openssl s_client -connect "${test_host}:443" -showcerts </dev/null 2>/dev/null \
       | awk '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/' > "$proxy_chain"; then
    err "Could not connect to ${test_host}; skipping CA injection"
    return
  fi

  local cert_count
  cert_count=$(grep -c 'BEGIN CERTIFICATE' "$proxy_chain" 2>/dev/null || echo 0)
  if [[ "$cert_count" -lt 2 ]]; then
    log "No proxy CA chain detected (${cert_count} cert); skipping"
    return
  fi
  log "Detected ${cert_count} certificates in proxy chain"

  local issuer
  issuer=$(openssl x509 -in "$proxy_chain" -noout -issuer 2>/dev/null || true)
  log "Leaf cert issuer: ${issuer#issuer=}"

  local system_bundle="${tmp_dir}/system-ca.pem"
  local combined="${tmp_dir}/combined.pem"

  log "Fetching system CA bundle from container image..."
  kubectl run ca-extract -n "$ns" --image=python:3.13-slim --restart=Never \
    --command -- sleep 60 &>/dev/null 2>&1 || true
  local retries=0
  while [[ $retries -lt 12 ]]; do
    if kubectl get pod ca-extract -n "$ns" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
      break
    fi
    sleep 5
    ((retries++))
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
with open('${combined}', 'w') as f:
    for cert in certs:
        f.write(cert + '\n\n')
print(f'{len(certs)} certs in clean bundle')
" 2>&1

  kubectl create configmap "$cm_name" -n "$ns" \
    --from-file=ca-certificates.crt="$combined" \
    --dry-run=client -o yaml | kubectl apply -f - &>/dev/null
  log "ConfigMap '${cm_name}' created in namespace '${ns}'"
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
# 3.    Corporate CA injection — optional; mounts CA bundle into pods.
# 4.    Langfuse secret injection — tracing secret patched into supervisor.

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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

  # ── 3. Corporate CA injection (optional) ──
  if $INJECT_CORPORATE_CA; then
    inject_corporate_ca
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
    wait_for_pods caipe 300
  else
    log "All patches already applied — nothing to do"
  fi
}

deploy_caipe() {
  step "Deploying CAIPE (v${CAIPE_CHART_VERSION})"

  local helm_args=(
    --namespace caipe
    --version "$CAIPE_CHART_VERSION"
    --set global.caipeUi.enabled=true
    --set tags.agent-weather=true
    --set tags.agent-netutils=true
    --set caipe-ui.config.SSO_ENABLED=false
    --set caipe-ui.env.A2A_BASE_URL=http://localhost:8000
  )

  if $ENABLE_RAG; then
    helm_args+=(
      --set tags.rag-stack=true
      --set caipe-ui.env.RAG_URL=/api/rag
      --set caipe-ui.env.RAG_SERVER_URL=http://rag-server:${RAG_SERVER_PORT}
      --set caipe-ui.env.RAG_ENABLED=true
      --set 'rag-stack.rag-webui.enabled=false'
      --set "rag-stack.rag-server.env.EMBEDDINGS_MODEL=${EMBEDDINGS_MODEL}"
      --set "rag-stack.rag-server.env.EMBEDDINGS_PROVIDER=${EMBEDDINGS_PROVIDER}"
      --set 'rag-stack.rag-server.env.ALLOW_TRUSTED_NETWORK=true'
      --set 'rag-stack.rag-server.env.TRUSTED_NETWORK_CIDRS=127.0.0.0/8\,10.0.0.0/8'
      --set 'rag-stack.milvus.minio.mode=standalone'
      --set 'rag-stack.milvus.minio.replicas=1'
      --set 'rag-stack.milvus.minio.persistence.size=10Gi'
      --set 'supervisor-agent.env.RAG_SERVER_URL=http://rag-server:9446'
    )

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

  if ! helm upgrade --install caipe "$CAIPE_OCI_REPO" "${helm_args[@]}" 2>&1; then
    err "Helm install failed (see output above)"
    exit 1
  fi
  log "CAIPE Helm release deployed"
  wait_for_pods caipe 600
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
  if [[ -n "$agent_card" ]] && echo "$agent_card" | jq -e '.name and .url and .skills' &>/dev/null; then
    print_result "$(date '+%H:%M:%S') ✓ [T1] Agent card schema valid (name, url, skills present)"
    pass=$((pass + 1))
  else
    print_result "$(date '+%H:%M:%S') ✗ [T1] Agent card missing required fields"
    fail=$((fail + 1))
  fi

  # ── Test 2: Send a simple A2A message and check we get a task response ──
  print_result "$(date '+%H:%M:%S')   … [T2] Sending A2A message (this may take up to 90s)..."
  local a2a_response
  a2a_response=$(curl -sf -X POST "http://localhost:${SUPERVISOR_PORT}/" \
    -H 'Content-Type: application/json' \
    --max-time 90 \
    -d '{
      "jsonrpc": "2.0",
      "id": "sanity-test-1",
      "method": "message/send",
      "params": {
        "message": {
          "role": "user",
          "parts": [{"kind": "text", "text": "What is 2+2? Reply with just the number."}],
          "messageId": "sanity-msg-1"
        }
      }
    }' 2>/dev/null || echo "")

  if [[ -n "$a2a_response" ]] && echo "$a2a_response" | jq -e '.result' &>/dev/null; then
    print_result "$(date '+%H:%M:%S') ✓ [T2] A2A message/send returned valid response"
    pass=$((pass + 1))
  elif [[ -n "$a2a_response" ]] && echo "$a2a_response" | jq -e '.error' &>/dev/null; then
    local err_msg
    err_msg=$(echo "$a2a_response" | jq -r '.error.message // .error' 2>/dev/null || true)
    print_result "$(date '+%H:%M:%S') ✗ [T2] A2A message/send error: ${err_msg:0:120}"
    fail=$((fail + 1))
  else
    print_result "$(date '+%H:%M:%S') ✗ [T2] A2A message/send no response (timeout or refused)"
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
AUTOHEAL_ENABLED=false
AUTOHEAL_LAST_RUN=0
AUTOHEAL_INTERVAL=30    # seconds between heal cycles

auto_heal_pods() {
  local ns="$1"
  local healed=0

  # CrashLoopBackOff / Error — rollout restart the owning deployment
  local bad_pods
  bad_pods=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null \
    | awk '$3=="CrashLoopBackOff" || $3=="Error" || $3=="CreateContainerConfigError" {print $1}')

  for pod in $bad_pods; do
    local owner
    owner=$(kubectl get pod "$pod" -n "$ns" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || true)
    if [[ -z "$owner" ]]; then continue; fi

    # ReplicaSet -> Deployment
    local deploy
    deploy=$(kubectl get rs "$owner" -n "$ns" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || true)
    if [[ -n "$deploy" ]]; then
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

  return 0
}

auto_heal_rag_server() {
  if ! $ENABLE_RAG; then return 0; fi

  # Check if rag-server pod is running
  local rag_status
  rag_status=$(kubectl get pods -n caipe -l app.kubernetes.io/name=rag-server \
    --no-headers 2>/dev/null | awk '{print $3}' | head -1)

  if [[ "$rag_status" != "Running" ]]; then
    return 0
  fi

  # Check rag-server readiness via its service
  local rag_ready
  rag_ready=$(kubectl get pods -n caipe -l app.kubernetes.io/name=rag-server \
    --no-headers 2>/dev/null | awk '{split($2,a,"/"); if(a[1]==a[2]) print "ready"}' | head -1)

  if [[ "$rag_ready" != "ready" ]]; then
    # Check recent logs for common fixable errors
    local recent_logs
    recent_logs=$(kubectl logs -l app.kubernetes.io/name=rag-server -n caipe \
      --tail=30 -c rag-server 2>/dev/null || true)

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
    if echo "$recent_logs" | grep -q "CERTIFICATE_VERIFY_FAILED\|SSL.*certificate"; then
      if $INJECT_CORPORATE_CA; then
        warn "[auto-heal] RAG server SSL error; re-applying corporate CA"
        patch_deployment_with_ca rag-server caipe rag-server
        return 1
      else
        warn "[auto-heal] RAG server SSL error detected; consider --corporate-ca flag"
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

  # 4. Fix services with no endpoints
  auto_heal_services caipe || total_healed=$((total_healed + $?))

  # 5. Re-apply post-deploy patches (Responses API, httpx redirect, CA, Langfuse secret)
  post_deploy_patches &>/dev/null || true

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
PF_SVCS=()    # parallel array: "svc ns local_port remote_port label"

start_pf() {
  local svc="$1" ns="$2" local_port="$3" remote_port="$4" label="$5"
  kill_port_on "$local_port"
  kubectl port-forward "svc/${svc}" -n "$ns" "${local_port}:${remote_port}" &>/dev/null &
  PF_PIDS+=($!)
  PF_SVCS+=("${svc} ${ns} ${local_port} ${remote_port} ${label}")
  log "${label}: http://localhost:${local_port}"
}

restart_pf() {
  local idx="$1"
  local entry="${PF_SVCS[$idx]}"
  # shellcheck disable=SC2086
  set -- $entry
  local svc="$1" ns="$2" local_port="$3" remote_port="$4"
  shift 4
  local label="$*"
  kill_port_on "$local_port"
  kubectl port-forward "svc/${svc}" -n "$ns" "${local_port}:${remote_port}" &>/dev/null &
  PF_PIDS[$idx]=$!
  log "Restarted ${label}: http://localhost:${local_port}"
}

monitor_port_forwards() {
  step "Port-forwarding services"

  start_pf caipe-supervisor-agent caipe "$SUPERVISOR_PORT" 8000 "Supervisor A2A"
  start_pf caipe-caipe-ui          caipe "$UI_PORT"         3000 "CAIPE UI"

  if $ENABLE_TRACING; then
    start_pf langfuse-web langfuse "$LANGFUSE_PORT" 3000 "Langfuse UI"
  fi

  sleep 3
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
  echo ""
  echo -e "  ${BOLD}Chart:${NC}   v${CAIPE_CHART_VERSION}"
  local agent_list="weather, netutils"
  $ENABLE_RAG && agent_list+=", rag"
  echo -e "  ${BOLD}Agents:${NC}  ${agent_list}"
  $AUTOHEAL_ENABLED && echo -e "  ${BOLD}Auto-heal:${NC} ${GREEN}enabled${NC} (every ${AUTOHEAL_INTERVAL}s)"
  echo ""
  echo -e "  ${BOLD}CLI chat:${NC}"
  echo -e "    ${DIM}uvx https://github.com/cnoe-io/agent-chat-cli.git a2a${NC}"
  echo ""
  echo -e "  ${YELLOW}${BOLD}Keep this script running to maintain port-forwarding.${NC}"
  echo -e "  ${DIM}Press Ctrl+C to stop all services.${NC}"
  echo ""

  local sanity_last_run loop_count=0
  sanity_last_run=$(date +%s)

  while true; do
    # Restart dead port-forwards
    for i in "${!PF_PIDS[@]}"; do
      if ! kill -0 "${PF_PIDS[$i]}" 2>/dev/null; then
        warn "Port-forward (PID ${PF_PIDS[$i]}) died, restarting..."
        restart_pf "$i"
      fi
    done

    # Run auto-heal if enabled
    if $AUTOHEAL_ENABLED; then
      run_auto_heal
    fi

    # Periodic sanity check every 5 minutes
    local now
    now=$(date +%s)
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
    read -r confirm
    if [[ "$confirm" != "yes" ]]; then
      log "Aborted"
      exit 0
    fi
    echo ""
  fi

  check_prerequisites

  # Kill any port-forwards on known ports
  for port in "$LANGFUSE_PORT" "$SUPERVISOR_PORT" "$UI_PORT"; do
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
          read -r del_cluster
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

# ─── Main ────────────────────────────────────────────────────────────────────
cmd_setup() {
  echo ""
  echo -e "${BLUE}${BOLD}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}${BOLD}║       CAIPE Lab Environment Setup            ║${NC}"
  echo -e "${BLUE}${BOLD}║    Multi-Agent System on Kubernetes          ║${NC}"
  echo -e "${BLUE}${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  check_prerequisites
  choose_cluster
  choose_chart_version
  collect_credentials
  choose_features
  create_namespace_and_secrets

  if $ENABLE_TRACING; then
    deploy_langfuse
    create_langfuse_api_keys
  fi

  deploy_caipe
  post_deploy_patches

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
  --rag              Enable RAG stack (vector-only by default)
  --graph-rag        Enable Graph RAG (Neo4j + ontology agent; implies --rag)
  --corporate-ca     Inject corporate TLS proxy CA certs into pods (for networks
                     with TLS inspection, e.g. Cisco Secure Access, Zscaler)
  --tracing          Enable Langfuse tracing (with --non-interactive, or pre-selects in interactive)
  --auto-heal        Enable auto-heal loop: detects and fixes crashing pods,
                     broken PVCs, missing secrets, RAG misconfig (every 30s)
  --yes, -y          Auto-confirm cleanup prompts (requires typing 'yes')
  -h, --help         Show this help message

Environment variables (all optional):
  LLM_PROVIDER            LLM provider: openai | anthropic-claude | aws-bedrock
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
  $(basename "$0") --non-interactive                      # defaults (OpenAI), base agents only
  $(basename "$0") --non-interactive --rag --tracing      # defaults with vector RAG + tracing
  $(basename "$0") --non-interactive --graph-rag --tracing # defaults with Graph RAG + tracing
  $(basename "$0") --corporate-ca --rag                   # RAG behind corporate TLS proxy
  $(basename "$0") --auto-heal --rag --tracing            # full stack with auto-healing
  $(basename "$0") cleanup                                # interactive teardown
  $(basename "$0") nuke                                   # teardown (confirm once with 'yes')
  OPENAI_API_KEY=sk-xxx $(basename "$0") setup            # setup with pre-set OpenAI key
  LLM_PROVIDER=anthropic-claude $(basename "$0") --non-interactive  # Anthropic Claude Haiku
  LLM_PROVIDER=aws-bedrock $(basename "$0") --non-interactive       # AWS Bedrock (uses profile)

EOF
  exit 0
}

# Parse flags from any position
args=()
for arg in "$@"; do
  case "$arg" in
    --yes|-y)          AUTO_YES=true ;;
    --non-interactive) NON_INTERACTIVE=true ;;
    --rag)             ENABLE_RAG=true ;;
    --graph-rag)       ENABLE_GRAPH_RAG=true ;;
    --corporate-ca)    INJECT_CORPORATE_CA=true ;;
    --tracing)         ENABLE_TRACING=true ;;
    --auto-heal)       AUTOHEAL_ENABLED=true ;;
    *)                 args+=("$arg") ;;
  esac
done

$ENABLE_GRAPH_RAG && ENABLE_RAG=true

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

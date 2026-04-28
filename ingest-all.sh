#!/bin/bash

################################################################################
# RAG Ingestion Orchestrator
# 
# Automates ingestion from multiple sources:
# - AWS (multi-account via AWS_ACCOUNT_LIST)
# - ArgoCD instances
# - Backstage
# - GitHub (multi-org)
# - Webex
################################################################################

set -eo pipefail

# Configuration
RAG_SERVER_URL="${RAG_SERVER_URL:-https://rag-webui.dev.outshift.io}"
EXIT_AFTER_FIRST_SYNC="${EXIT_AFTER_FIRST_SYNC:-1}"
DRY_RUN="${DRY_RUN:-false}"

# TOKENS NEEDED
# ArgoCD
#ARGOCD_COMMON_TOKEN
#ARGOCD_INTERNAL_TOKEN

# Backstage
# BACKSTAGE_API_TOKEN

# GitHub 
# GITHUB_TOKEN

# Webex
# WEBEX_ACCESS_TOKEN
# WEBEX_BOT_NAME
# WEBEX_SPACES



# ArgoCD Server URLs
ARGOCD_COMMON_URL="${ARGOCD_COMMON_URL:-https://argocd-common.eticloud.io}"
ARGOCD_INTERNAL_URL="${ARGOCD_INTERNAL_URL:-https://argocd-internal.eticloud.io}"

# Backstage URL
BACKSTAGE_URL="${BACKSTAGE_URL:-https://developer.outshift.io}"

# GitHub Organizations (multi-org)
GITHUB_ORGS="${GITHUB_ORGS:?GITHUB_ORGS must be set (comma-separated org logins)}"

# AWS multi-account configuration
CROSS_ACCOUNT_ROLE_NAME="${CROSS_ACCOUNT_ROLE_NAME:-caipe-read-only}"

# Colors and formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Emojis for better visual feedback
CHECK="✓"
CROSS="✗"
ARROW="→"
WARN="⚠"
INFO="ℹ"
ROCKET="🚀"
CLOCK="⏱"

# Stats tracking
STATS_AWS=0
STATS_ARGOCD=0
STATS_BACKSTAGE=0
STATS_GITHUB=0
STATS_WEBEX=0
STATS_FAILURES=0
START_TIME=$(date +%s)

################################################################################
# Logging Functions
################################################################################

log() {
    echo -e "$@"
}

log_header() {
    echo ""
    log "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
    log "${CYAN}║${NC} ${WHITE}${BOLD}$1${NC}"
    log "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
}

log_section() {
    echo ""
    log "${BLUE}▶ ${BOLD}$1${NC}"
}

log_success() {
    log "${GREEN}  ${CHECK} $1${NC}"
}

log_error() {
    log "${RED}  ${CROSS} $1${NC}"
    ((STATS_FAILURES++))
}

log_warning() {
    log "${YELLOW}  ${WARN} $1${NC}"
}

log_info() {
    log "${DIM}  ${ARROW} $1${NC}"
}

log_task() {
    log "${MAGENTA}  ${ROCKET} $1${NC}"
}

run_with_spinner() {
    local cmd="$1"
    local msg="$2"
    
    if [ "$DRY_RUN" = "true" ]; then
        log_info "DRY RUN: $msg"
        return 0
    fi
    
    log_info "$msg..."
    if eval "$cmd" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

################################################################################
# AWS Ingestion (multi-account)
################################################################################

ingest_aws() {
    log_header "AWS Ingestion"
    
    # Build AWS_ACCOUNT_LIST from discovered profiles if not already set
    local account_list="${AWS_ACCOUNT_LIST:-}"
    
    if [ -z "$account_list" ]; then
        log_section "Discovering AWS accounts from profiles"
        
        # Discover AWS profiles
        local aws_profiles=""
        if [ -f ~/.aws/credentials ]; then
            aws_profiles=$(grep '^\[' ~/.aws/credentials | sed 's/\[//g' | sed 's/\]//g' | grep -v '^#' || true)
        fi
        if [ -f ~/.aws/config ]; then
            local config_profiles=$(grep '^\[profile' ~/.aws/config | sed 's/\[profile //g' | sed 's/\]//g' | grep -v '^#' || true)
            aws_profiles="$aws_profiles $config_profiles"
        fi
        
        if [ -z "$aws_profiles" ]; then
            log_warning "No AWS profiles found and AWS_ACCOUNT_LIST not set. Skipping AWS ingestion."
            return 0
        fi
        
        # Convert to array and deduplicate
        local profiles_array=($(echo "$aws_profiles" | tr ' ' '\n' | sort -u))
        log_info "Discovered ${BOLD}${#profiles_array[@]}${NC}${DIM} AWS profile(s)${NC}"
        
        # Build AWS_ACCOUNT_LIST by resolving each profile to name:account_id
        local entries=()
        for aws_profile in "${profiles_array[@]}"; do
            export AWS_PROFILE="$aws_profile"
            
            if ! aws sts get-caller-identity > /dev/null 2>&1; then
                log_warning "Authentication failed for profile ${aws_profile}, skipping"
                continue
            fi
            
            local acct_id=$(aws sts get-caller-identity --output text --query 'Account' 2>/dev/null || echo "")
            if [ -n "$acct_id" ]; then
                entries+=("${aws_profile}:${acct_id}")
                log_success "Profile ${aws_profile} → Account ${acct_id}"
            else
                log_warning "Could not resolve account ID for profile ${aws_profile}"
            fi
        done
        
        if [ ${#entries[@]} -eq 0 ]; then
            log_warning "No valid AWS accounts discovered. Skipping AWS ingestion."
            return 0
        fi
        
        # Join entries with commas
        account_list=$(IFS=,; echo "${entries[*]}")
        log_info "Built AWS_ACCOUNT_LIST: ${account_list}"
    else
        log_info "Using pre-configured AWS_ACCOUNT_LIST: ${account_list}"
    fi
    
    # Run AWS ingestor once with multi-account support
    log_task "Running AWS multi-account ingestor"
    if [ "$DRY_RUN" != "true" ]; then
        RAG_SERVER_URL="$RAG_SERVER_URL" \
        EXIT_AFTER_FIRST_SYNC="$EXIT_AFTER_FIRST_SYNC" \
        AWS_ACCOUNT_LIST="$account_list" \
        CROSS_ACCOUNT_ROLE_NAME="$CROSS_ACCOUNT_ROLE_NAME" \
        docker compose -f docker-compose.dev.yaml --profile aws-ingestor up aws_ingestor
        log_success "AWS multi-account ingestor completed"
        ((STATS_AWS++))
    else
        log_info "DRY RUN: Would run AWS ingestor with AWS_ACCOUNT_LIST=${account_list}"
    fi
}

################################################################################
# ArgoCD Ingestion
################################################################################

ingest_argocd() {
    log_header "ArgoCD Ingestion"
    
    # ArgoCD Common
    log_section "ArgoCD: ${BOLD}common${NC} (argocd-common.eticloud.io)"
    log_task "Running ArgoCD ingestor"
    
    if [ "$DRY_RUN" != "true" ]; then
        RAG_SERVER_URL="$RAG_SERVER_URL" \
        EXIT_AFTER_FIRST_SYNC="$EXIT_AFTER_FIRST_SYNC" \
        SERVER_URL="$ARGOCD_COMMON_URL" \
        ARGOCD_AUTH_TOKEN="$ARGOCD_COMMON_TOKEN" \
        docker compose -f docker-compose.dev.yaml --profile argocd-ingestor up argocd_ingestor
        log_success "ArgoCD common ingestion completed"
        ((STATS_ARGOCD++))
    else
        log_info "DRY RUN: Would run ArgoCD common ingestor"
    fi
    
    # ArgoCD Internal
    log_section "ArgoCD: ${BOLD}internal${NC} (argocd-internal.eticloud.io)"
    log_task "Running ArgoCD ingestor"
    
    if [ "$DRY_RUN" != "true" ]; then
        RAG_SERVER_URL="$RAG_SERVER_URL" \
        EXIT_AFTER_FIRST_SYNC="$EXIT_AFTER_FIRST_SYNC" \
        SERVER_URL="$ARGOCD_INTERNAL_URL" \
        ARGOCD_AUTH_TOKEN="$ARGOCD_INTERNAL_TOKEN" \
        docker compose -f docker-compose.dev.yaml --profile argocd-ingestor up argocd_ingestor
        log_success "ArgoCD internal ingestion completed"
        ((STATS_ARGOCD++))
    else
        log_info "DRY RUN: Would run ArgoCD internal ingestor"
    fi
}

################################################################################
# Backstage Ingestion
################################################################################

ingest_backstage() {
    log_header "Backstage Ingestion"
    
    log_section "Backstage: ${BOLD}developer.outshift.io${NC}"
    log_task "Running Backstage ingestor"
    
    if [ "$DRY_RUN" != "true" ]; then
        RAG_SERVER_URL="$RAG_SERVER_URL" \
        EXIT_AFTER_FIRST_SYNC="$EXIT_AFTER_FIRST_SYNC" \
        BACKSTAGE_URL="$BACKSTAGE_URL" \
        BACKSTAGE_API_TOKEN="$BACKSTAGE_API_TOKEN" \
        docker compose -f docker-compose.dev.yaml --profile backstage-ingestor up backstage_ingestor
        log_success "Backstage ingestion completed"
        ((STATS_BACKSTAGE++))
    else
        log_info "DRY RUN: Would run Backstage ingestor"
    fi
}

################################################################################
# GitHub Ingestion (multi-org)
################################################################################

ingest_github() {
    log_header "GitHub Ingestion"
    
    log_section "GitHub Orgs: ${BOLD}${GITHUB_ORGS}${NC}"
    log_task "Running GitHub multi-org ingestor"
    
    if [ "$DRY_RUN" != "true" ]; then
        RAG_SERVER_URL="$RAG_SERVER_URL" \
        EXIT_AFTER_FIRST_SYNC="$EXIT_AFTER_FIRST_SYNC" \
        GITHUB_ORGS="$GITHUB_ORGS" \
        GITHUB_TOKEN="$GITHUB_TOKEN" \
        docker compose -f docker-compose.dev.yaml --profile github-ingestor up github_ingestor
        log_success "GitHub multi-org ingestion completed"
        ((STATS_GITHUB++))
    else
        log_info "DRY RUN: Would run GitHub ingestor with GITHUB_ORGS=${GITHUB_ORGS}"
    fi
}

################################################################################
# Webex Ingestion
################################################################################

ingest_webex() {
    log_header "Webex Ingestion"
    
    log_section "Webex Space: ${BOLD}Ask Outshift SRE${NC}"
    log_task "Running Webex ingestor"
    
    if [ "$DRY_RUN" != "true" ]; then
        RAG_SERVER_URL="$RAG_SERVER_URL" \
        WEBEX_ACCESS_TOKEN="$WEBEX_ACCESS_TOKEN" \
        WEBEX_BOT_NAME="$WEBEX_BOT_NAME" \
        WEBEX_SPACES="$WEBEX_SPACES" \
        EXIT_AFTER_FIRST_SYNC="$EXIT_AFTER_FIRST_SYNC" \
        docker compose -f docker-compose.dev.yaml --profile webex-ingestor up webex_ingestor
        log_success "Webex ingestion completed"
        ((STATS_WEBEX++))
    else
        log_info "DRY RUN: Would run Webex ingestor"
    fi
}

################################################################################
# Summary and Stats
################################################################################

show_summary() {
    local end_time=$(date +%s)
    local duration=$((end_time - START_TIME))
    local minutes=$((duration / 60))
    local seconds=$((duration % 60))
    
    echo ""
    log_header "Ingestion Summary"
    log ""
    log "  ${BOLD}AWS:${NC}               ${GREEN}${STATS_AWS}${NC}"
    log "  ${BOLD}ArgoCD Instances:${NC}  ${GREEN}${STATS_ARGOCD}${NC}"
    log "  ${BOLD}Backstage:${NC}         ${GREEN}${STATS_BACKSTAGE}${NC}"
    log "  ${BOLD}GitHub Orgs:${NC}       ${GREEN}${STATS_GITHUB}${NC}"
    log "  ${BOLD}Webex Spaces:${NC}      ${GREEN}${STATS_WEBEX}${NC}"
    log ""
    
    if [ $STATS_FAILURES -eq 0 ]; then
        log_success "All ingestions completed successfully!"
    else
        log_warning "Completed with ${STATS_FAILURES} failure(s)"
    fi
    
    log_info "Total duration: ${minutes}m ${seconds}s"
    echo ""
}

################################################################################
# Main Orchestration
################################################################################

show_banner() {
    echo ""
    log "${MAGENTA}╔════════════════════════════════════════════════════════════════╗${NC}"
    log "${MAGENTA}║${NC}                                                                ${MAGENTA}║${NC}"
    log "${MAGENTA}║${NC}        ${WHITE}${BOLD}RAG INGESTION ORCHESTRATOR${NC}                           ${MAGENTA}║${NC}"
    log "${MAGENTA}║${NC}        ${DIM}Automated multi-source data ingestion${NC}                 ${MAGENTA}║${NC}"
    log "${MAGENTA}║${NC}                                                                ${MAGENTA}║${NC}"
    log "${MAGENTA}╚════════════════════════════════════════════════════════════════╝${NC}"
    
    if [ "$DRY_RUN" = "true" ]; then
        log "${YELLOW}${BOLD}${WARN} DRY RUN MODE - No actual ingestion will occur${NC}"
    fi
    
    log ""
    log "${DIM}RAG Server: ${RAG_SERVER_URL}${NC}"
    log "${DIM}Started: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
}

show_usage() {
    cat << EOF
${BOLD}Usage:${NC}
  $0 [OPTIONS] [SOURCES...]

${BOLD}Options:${NC}
  -h, --help          Show this help message
  -d, --dry-run       Show what would be executed without running
  -a, --all           Run all ingestors (default)

${BOLD}Sources:${NC}
  aws                 AWS ingestion (multi-account)
  argocd              ArgoCD instances
  backstage           Backstage catalog
  github              GitHub organizations (multi-org)
  webex               Webex spaces
  all                 All sources (default)

${BOLD}Environment Variables:${NC}
  RAG_SERVER_URL              RAG server URL
  EXIT_AFTER_FIRST_SYNC       Exit after first sync (0 or 1)
  DRY_RUN                     Enable dry-run mode (true/false)
  
  ${BOLD}AWS:${NC}
  AWS_ACCOUNT_LIST            Pre-configured account list (name1:id1,name2:id2)
                              If not set, auto-discovers from ~/.aws profiles
  CROSS_ACCOUNT_ROLE_NAME     IAM role name for cross-account access
  
  ${BOLD}Credentials:${NC}
  ARGOCD_AUTH_TOKEN_COMMON    ArgoCD common auth token
  ARGOCD_AUTH_TOKEN_INTERNAL  ArgoCD internal auth token
  BACKSTAGE_API_TOKEN         Backstage API token
  GITHUB_TOKEN                GitHub access token
  WEBEX_ACCESS_TOKEN          Webex bot access token
  
  ${BOLD}Service URLs:${NC}
  ARGOCD_COMMON_URL           ArgoCD common instance URL
  ARGOCD_INTERNAL_URL         ArgoCD internal instance URL
  BACKSTAGE_URL               Backstage instance URL
  GITHUB_ORGS                 Comma-separated GitHub org logins
  WEBEX_BOT_NAME              Webex bot name
  WEBEX_SPACES                Webex spaces JSON configuration

${BOLD}Examples:${NC}
  # Run all ingestors
  $0

  # Dry run to see what would execute
  $0 --dry-run

  # Run only AWS and GitHub
  $0 aws github

  # Run with custom RAG server
  RAG_SERVER_URL=https://custom.io $0

EOF
}

main() {
    # Parse arguments
    local sources=()
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -d|--dry-run)
                DRY_RUN="true"
                shift
                ;;
            -a|--all)
                sources=("all")
                shift
                ;;
            aws|argocd|backstage|github|webex|all)
                sources+=("$1")
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Default to all if no sources specified
    if [ ${#sources[@]} -eq 0 ]; then
        sources=("all")
    fi
    
    show_banner
    
    # Check prerequisites
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    # Run selected ingestors
    for source in "${sources[@]}"; do
        case $source in
            all)
                ingest_aws
                ingest_argocd
                ingest_backstage
                ingest_github
                ingest_webex
                break
                ;;
            aws)
                ingest_aws
                ;;
            argocd)
                ingest_argocd
                ;;
            backstage)
                ingest_backstage
                ;;
            github)
                ingest_github
                ;;
            webex)
                ingest_webex
                ;;
        esac
    done
    
    show_summary
    
    if [ $STATS_FAILURES -gt 0 ]; then
        exit 1
    fi
}

# Run main function
main "$@"

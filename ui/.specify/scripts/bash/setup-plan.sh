#!/usr/bin/env bash

set -e

# Parse command line arguments
JSON_MODE=false
FORCE_MODE=false
ARGS=()

for arg in "$@"; do
    case "$arg" in
        --json) 
            JSON_MODE=true 
            ;;
        --force)
            FORCE_MODE=true
            ;;
        --help|-h) 
            echo "Usage: $0 [--json] [--force]"
            echo "  --json    Output results in JSON format"
            echo "  --force   Overwrite existing plan.md with template"
            echo "  --help    Show this help message"
            exit 0 
            ;;
        *) 
            ARGS+=("$arg") 
            ;;
    esac
done

# Get script directory and load common functions
SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Get all paths and variables from common functions
eval $(get_feature_paths)

# Check if we're on a proper feature branch (only for git repos)
check_feature_branch "$CURRENT_BRANCH" "$HAS_GIT" || exit 1

# Ensure the feature directory exists
mkdir -p "$FEATURE_DIR"

# Copy plan template only if plan.md does not already exist
TEMPLATE="$REPO_ROOT/.specify/templates/plan-template.md"
if [[ -f "$IMPL_PLAN" ]] && ! $FORCE_MODE; then
    echo "Plan already exists at $IMPL_PLAN — skipping template copy (use --force to overwrite)"
else
    if [[ -f "$TEMPLATE" ]]; then
        cp "$TEMPLATE" "$IMPL_PLAN"
        echo "Copied plan template to $IMPL_PLAN"
    else
        echo "Warning: Plan template not found at $TEMPLATE"
        touch "$IMPL_PLAN"
    fi
fi

# Output results
if $JSON_MODE; then
    printf '{"FEATURE_SPEC":"%s","IMPL_PLAN":"%s","SPECS_DIR":"%s","BRANCH":"%s","HAS_GIT":"%s"}\n' \
        "$FEATURE_SPEC" "$IMPL_PLAN" "$FEATURE_DIR" "$CURRENT_BRANCH" "$HAS_GIT"
else
    echo "FEATURE_SPEC: $FEATURE_SPEC"
    echo "IMPL_PLAN: $IMPL_PLAN" 
    echo "SPECS_DIR: $FEATURE_DIR"
    echo "BRANCH: $CURRENT_BRANCH"
    echo "HAS_GIT: $HAS_GIT"
fi


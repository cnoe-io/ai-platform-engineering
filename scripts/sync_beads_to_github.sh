#!/bin/bash
# Sync beads issues to GitHub Issues
# Usage: ./scripts/sync_beads_to_github.sh [--dry-run]
#
# Prerequisites:
#   - gh CLI installed and authenticated
#   - bd (beads) installed
#
# Environment:
#   GITHUB_REPO: GitHub repository (default: cnoe-io/ai-platform-engineering)

set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-cnoe-io/ai-platform-engineering}"
DRY_RUN=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "🔄 Syncing beads to GitHub Issues"
echo "   Repository: $GITHUB_REPO"
echo "   Dry Run: $DRY_RUN"
echo ""

# Check prerequisites
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not found. Install with: brew install gh"
    exit 1
fi

if ! command -v bd &> /dev/null; then
    echo "❌ beads (bd) not found."
    exit 1
fi

if ! gh auth status -h github.com &> /dev/null; then
    echo "❌ GitHub CLI not authenticated to github.com. Run: gh auth login"
    exit 1
fi

# Export beads to JSON
cd "$PROJECT_DIR"
BEADS_JSON=$(bd list --json 2>/dev/null || bd export 2>/dev/null)

# Get existing GitHub issues with beads label
echo "📥 Fetching existing GitHub issues..."
EXISTING_ISSUES=$(gh issue list --repo "$GITHUB_REPO" --label "beads" --json number,title,body,state --limit 500 2>/dev/null || echo "[]")

# Function to create or update GitHub issue
sync_issue() {
    local bead_id="$1"
    local title="$2"
    local priority="$3"
    local type="$4"
    local status="$5"
    local description="${6:-}"

    # Build labels
    local labels="beads,$priority,$type"
    if [[ "$status" == "in_progress" ]]; then
        labels="$labels,in-progress"
    fi

    # Build body with beads metadata
    local body="<!-- beads-id: $bead_id -->
**Beads ID:** \`$bead_id\`
**Priority:** $priority
**Type:** $type
**Status:** $status

---

$description"

    # Check if issue already exists
    local existing_number=$(echo "$EXISTING_ISSUES" | jq -r ".[] | select(.body | contains(\"beads-id: $bead_id\")) | .number" 2>/dev/null || echo "")

    if [[ -n "$existing_number" ]]; then
        echo "  ♻️  [$bead_id] Already exists as #$existing_number"

        # Update if status changed
        local gh_state="open"
        [[ "$status" == "closed" ]] && gh_state="closed"

        if [[ "$DRY_RUN" == "false" ]]; then
            gh issue edit "$existing_number" --repo "$GITHUB_REPO" \
                --title "[$bead_id] $title" \
                --body "$body" \
                --add-label "$labels" 2>/dev/null || true
        fi
    else
        echo "  ➕ [$bead_id] Creating: $title"

        if [[ "$DRY_RUN" == "false" ]]; then
            gh issue create --repo "$GITHUB_REPO" \
                --title "[$bead_id] $title" \
                --body "$body" \
                --label "$labels" 2>/dev/null || echo "    ⚠️  Failed to create issue"
        fi
    fi
}

# Process each bead
echo ""
echo "📤 Syncing beads to GitHub..."

bd list --json 2>/dev/null | jq -c '.[]' 2>/dev/null | while read -r issue; do
    bead_id=$(echo "$issue" | jq -r '.id // empty')
    title=$(echo "$issue" | jq -r '.title // empty')
    priority_num=$(echo "$issue" | jq -r '.priority // 2')
    priority="P${priority_num}"
    type=$(echo "$issue" | jq -r '.issue_type // "task"')
    status=$(echo "$issue" | jq -r '.status // "open"')
    description=$(echo "$issue" | jq -r '.description // ""')

    if [[ -n "$bead_id" && -n "$title" ]]; then
        sync_issue "$bead_id" "$title" "$priority" "$type" "$status" "$description"
    fi
done

echo ""
echo "✅ Sync complete!"
if [[ "$DRY_RUN" == "true" ]]; then
    echo "   (Dry run - no changes made)"
fi

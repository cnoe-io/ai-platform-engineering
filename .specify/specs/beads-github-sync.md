# Spec: Beads Task Tracking and GitHub Issues Sync

## Overview

Establish beads (bd) as the primary task tracking system for AI Platform Engineering, with bidirectional synchronization to GitHub Issues for external visibility and collaboration.

## Motivation

### Current State
- Beads is installed but not fully integrated into the development workflow
- GitHub Issues are used externally but disconnected from local task tracking
- AI coding agents need local issue context without web UI access
- Team members juggle between beads CLI and GitHub web interface

### Goals
1. **Single Source of Truth**: Beads as the primary interface for developers and AI agents
2. **External Visibility**: GitHub Issues for stakeholders, contributors, and public visibility
3. **Bidirectional Sync**: Changes flow both ways automatically
4. **AI-Native Workflow**: CLI-first design enables seamless AI agent integration

## Scope

### In Scope
- Beads → GitHub Issues sync (export)
- GitHub Issues → Beads sync (import)
- Field mapping (priority, type, status, labels)
- Cursor/AI agent integration guidelines
- Team onboarding documentation

### Out of Scope
- GitHub Projects integration
- Jira/Linear sync (future consideration)
- Real-time webhooks (batch sync is sufficient)

## Design

### Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│    Developer/AI     │     │   External Users    │
│    (CLI: bd)        │     │   (Web: GitHub)     │
└─────────┬───────────┘     └─────────┬───────────┘
          │                           │
          ▼                           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  .beads/issues.jsonl│◄───►│   GitHub Issues     │
│  (Local Storage)    │     │   (cnoe-io/ai-      │
│                     │     │    platform-        │
└─────────────────────┘     │    engineering)     │
          │                 └─────────────────────┘
          ▼
┌─────────────────────┐
│   Git Repository    │
│   (bd sync)         │
└─────────────────────┘
```

### Field Mapping

| Beads Field | GitHub Field | Notes |
|-------------|--------------|-------|
| `id` | Label: `beads:<id>` | For linking back to beads |
| `title` | Title | Direct mapping |
| `description` | Body | Markdown preserved |
| `status: open` | State: open | Direct mapping |
| `status: closed/done` | State: closed | Direct mapping |
| `status: in_progress` | Label: `in-progress` | Custom label |
| `priority: 1` | Label: `P1` | Priority 1 - High |
| `priority: 2` | Label: `P2` | Priority 2 - Medium |
| `issue_type: epic` | Label: `epic` | Custom label |
| `issue_type: task` | Label: `task` | Custom label |
| `external_ref` | N/A | Stores GitHub issue number |
| `labels` | Labels | Direct mapping |
| `assignee` | Assignees | Username mapping needed |

### Sync Commands

```bash
# Export beads to GitHub Issues
bd gh export [--dry-run] [--all|--open|<issue-id>]

# Import GitHub Issues to beads
bd gh import [--dry-run] [--all|--open|<issue-number>]

# Full bidirectional sync
bd gh sync [--dry-run]

# Link existing beads issue to GitHub issue
bd link <beads-id> gh-<issue-number>
```

### Implementation Using `gh` CLI

Until native beads-GitHub integration exists, use shell scripts with GitHub CLI:

```bash
# Export single beads issue to GitHub
bd show <id> --json | jq -r '...' | gh issue create \
  --title "$TITLE" \
  --body "$BODY" \
  --label "beads:$ID,$PRIORITY,$TYPE"

# Import GitHub issue to beads
gh issue view <number> --json title,body,state,labels | \
  jq -r '...' | bd create --from-json

# Sync status changes
gh issue list --json number,state,labels | \
  while read issue; do
    bd update <matched-id> --status <mapped-status>
  done
```

### Components Affected
- [x] `.beads/` configuration
- [x] `.cursorrules` (workflow documentation)
- [x] `AGENTS.md` (agent instructions)
- [ ] Scripts (`scripts/beads-gh-sync.sh`)
- [ ] Documentation (`docs/`)

## Acceptance Criteria

### Core Sync
- [ ] Export beads issue creates GitHub Issue with correct fields
- [ ] Import GitHub Issue creates beads issue with correct fields
- [ ] `external_ref` links beads ID to GitHub Issue number
- [ ] Status changes sync bidirectionally
- [ ] Labels/priority sync correctly

### Integration
- [ ] AI agents can use `bd` commands for task management
- [ ] `bd sync` works with git push/pull workflow
- [ ] Team can use either interface (beads CLI or GitHub web)

### Documentation
- [ ] Beads workflow documented in `.cursorrules`
- [ ] Agent instructions in `AGENTS.md` are complete
- [ ] Team onboarding guide created
- [ ] Sync script documented with examples

## Implementation Plan

### Phase 1: Beads Configuration (Complete)
- [x] Initialize beads in repository
- [x] Create `.beads/config.yaml`
- [x] Add `AGENTS.md` with bd quick reference
- [x] Document "Landing the Plane" workflow

### Phase 2: Cursor/AI Integration
- [ ] Update `.cursorrules` with beads workflow
- [ ] Add beads commands to code review checklist
- [ ] Document issue creation for remaining work
- [ ] Add beads status updates to session completion

### Phase 3: GitHub Sync Script ✅
- [x] Create `scripts/sync_beads_to_github.sh`
- [x] Implement export: beads → GitHub
- [ ] Implement import: GitHub → beads (not yet implemented)
- [x] Add `--dry-run` mode for safety
- [x] Handle duplicate detection via `beads-id` in issue body
- [x] Makefile targets: `beads-gh-issues-sync`, `beads-gh-issues-sync-run`

### Phase 4: Documentation & Onboarding
- [ ] Create team onboarding documentation
- [ ] Add beads section to `CONTRIBUTING.md`
- [ ] Document sync workflow
- [ ] Create troubleshooting guide

## Testing Strategy

- Manual testing:
  - Create issue in beads, export to GitHub, verify fields
  - Create issue in GitHub, import to beads, verify fields
  - Change status in one system, sync, verify update
  - Test conflict scenarios

- Integration tests:
  - Test sync script with mock issues
  - Verify `bd sync` + `git push` workflow

## Rollout Plan

1. **Phase 1**: Complete beads setup (done)
2. **Phase 2**: Add Cursor integration rules
3. **Phase 3**: Deploy sync script, test with small issue set
4. **Phase 4**: Full team adoption with documentation

## Related

- Beads Issue: `ai-platform-engineering-34j` (Sync beads with GitHub Issues)
- Beads Issue: `ai-platform-engineering-4cp` (Implement beads tracking)
- Beads Issue: `ai-platform-engineering-9wk` (Document beads in workspace rules)
- Beads Repository: [github.com/steveyegge/beads](https://github.com/steveyegge/beads)

## Appendix: Cursor Rules Integration

Add to `.cursorrules`:

```markdown
## Beads Task Tracking

**Location**: `.beads/`

### Essential Commands

\`\`\`bash
bd ready              # Find available work
bd show <id>          # View issue details
bd create "title"     # Create new issue
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
\`\`\`

### Workflow Integration

1. **Starting Work**: `bd ready` → `bd update <id> --status in_progress`
2. **During Work**: Reference issue ID in commits
3. **Completing Work**: `bd close <id>` → `bd sync` → `git push`
4. **Remaining Work**: `bd create "Follow-up task"` for anything incomplete

### Session Completion (Landing the Plane)

Before ending any session:
1. Create issues for remaining work: `bd create "..."`
2. Update issue status: `bd close <id>` or `bd update <id> --status blocked`
3. Sync and push: `bd sync && git push`
```

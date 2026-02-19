---
name: release-readiness-check
description: Verify all prerequisites are met before a release by checking PRs, CI/CD status, environment health, and blocking issues across GitHub, ArgoCD, and Jira. Use before cutting a release, deploying to production, or during release planning.
---

# Release Readiness Check

Orchestrate GitHub, ArgoCD, and Jira agents to perform a comprehensive pre-release verification covering code readiness, environment health, and issue resolution.

## Instructions

### Phase 1: Code Readiness (GitHub Agent)
1. **Check open PRs targeting release branch**
2. **CI/CD status on the release branch**
3. **Recent commits** and conventional commit compliance
4. **Release artifacts** - changelog, version bump, Docker images

### Phase 2: Environment Health (ArgoCD Agent)
1. **Staging environment** - synced, healthy, correct version
2. **Production environment baseline** - healthy before deploying
3. **Helm chart versions** updated

### Phase 3: Issue Resolution (Jira Agent)
1. **Blocking issues** - release-blockers, p0
2. **Testing status** - QA sign-off, regression results
3. **Documentation** - release notes, breaking changes, ADRs

### Phase 4: Release Verdict
Compile all checks into a Go/No-Go decision with clear justification.

## Output Format

\`\`\`markdown
## Release Readiness Report
**Release**: v2.4.0
**Verdict**: GO / NO-GO / CONDITIONAL

### Readiness Checklist
| Category | Check | Status | Details |
|----------|-------|--------|---------|
| Code | All PRs merged | PASS | 0 open PRs |
| Code | CI checks passing | PASS | All 12 checks green |
| Env | Staging healthy | PASS | All 15 apps synced |
| Issues | No release blockers | FAIL | 1 blocker open |
\`\`\`

## Examples

- "Are we ready for a release?"
- "Check release readiness for v2.4.0"
- "Is staging healthy and can we deploy to production?"
- "Are there any release blockers in Jira?"

## Guidelines

- A single failing critical check makes the verdict NO-GO
- Warnings make the verdict CONDITIONAL (can proceed with acknowledgment)
- Always include a rollback plan in the readiness report
- Check for breaking changes and verify they have corresponding ADRs
- Never skip the staging health check
- Include DCO sign-off verification for all commits in the release
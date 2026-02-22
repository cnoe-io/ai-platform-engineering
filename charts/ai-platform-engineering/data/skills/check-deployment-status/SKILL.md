---
name: check-deployment-status
description: Check the health and sync status of all ArgoCD applications across clusters. Identifies out-of-sync, degraded, or unhealthy deployments and provides actionable remediation steps. Use when monitoring deployments, troubleshooting sync failures, or verifying environment health after a release.
---

# Check Deployment Status

Retrieve and analyze the current state of all ArgoCD-managed applications. Surface any that are \`OutOfSync\`, \`Degraded\`, \`Missing\`, or \`Unknown\`, and provide clear next steps.

## Instructions

1. **List all ArgoCD applications** using the ArgoCD agent's MCP tools. Request application name, project, sync status, health status, and target revision.
2. **Categorize results** into:
   - **Healthy & Synced** - no action needed
   - **OutOfSync** - drift detected between desired and live state
   - **Degraded / Unhealthy** - runtime health issues (crashloops, pending pods, failed probes)
   - **Missing / Unknown** - application or resources cannot be found
3. **For each unhealthy application**, provide:
   - Application name and namespace
   - Current sync and health status
   - Last sync timestamp and result
   - Resource-level details (which pods/deployments are failing)
   - Suggested remediation (sync, rollback, check resource limits, etc.)
4. **Summary table** at the top with total counts per status category.

## Output Format

\`\`\`markdown
## Deployment Status Summary

| Status        | Count |
|---------------|-------|
| Healthy       | 42    |
| OutOfSync     | 3     |
| Degraded      | 1     |
| Missing       | 0     |

### Issues Requiring Attention

#### 1. my-app (namespace: production)
- **Sync Status**: OutOfSync
- **Health**: Degraded
- **Last Sync**: 2026-02-08T14:23:00Z (Failed)
- **Details**: Deployment \`my-app\` has 0/3 ready replicas. Pod \`my-app-7d4b8c\` in CrashLoopBackOff.
- **Recommended Action**: Check container logs for startup errors. Verify resource limits and environment variables.
\`\`\`

## Examples

- "Show me the status of all ArgoCD applications"
- "Are there any deployments that are out of sync?"
- "Check deployment health after the last release"
- "Which applications are degraded in the staging cluster?"

## Guidelines

- Always paginate results (default page size: 20) to avoid OOM with large application counts
- Group results by project or cluster when there are more than 50 applications
- Highlight time since last successful sync for OutOfSync apps
- If all applications are healthy, confirm with a brief positive summary rather than listing every app
- When degraded apps are found, check for recent deployment events that may correlate
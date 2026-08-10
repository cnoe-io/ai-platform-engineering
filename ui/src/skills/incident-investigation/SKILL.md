---
name: incident-investigation
description: Correlate PagerDuty incidents with Jira tickets and recent ArgoCD deployments to accelerate root cause analysis. Orchestrates multiple agents to build a timeline of events. Use when investigating active incidents, performing post-mortems, or correlating alerts with changes.
---

# Incident Investigation

Perform multi-agent investigation by correlating PagerDuty incidents, Jira tickets, and ArgoCD deployment history to identify root cause and impacted systems.

## Instructions

### Phase 1: Gather Incident Data (PagerDuty Agent)
1. **Fetch active incidents** - list all triggered and acknowledged incidents
2. For each incident, collect:
   - Incident ID, title, urgency, and status
   - Service affected and escalation policy
   - Triggered timestamp and duration
   - Assigned responders and acknowledgment status
   - Alert details and monitoring source

### Phase 2: Correlate with Tickets (Jira Agent)
1. **Search for related Jira tickets** using:
   - Incident ID or service name in ticket descriptions
   - Recent tickets with labels like `incident`, `outage`, `p0`, `p1`
   - Tickets linked to the affected service or component
2. For each related ticket, collect:
   - Ticket key, summary, status, assignee
   - Priority and labels
   - Comments with recent updates

### Phase 3: Check Recent Deployments (ArgoCD Agent)
1. **Search for recent deployments** in the last 24 hours:
   - Applications related to the affected service
   - Any applications with recent sync operations
   - Failed syncs or rollbacks
2. For each deployment, collect:
   - Application name and sync status
   - Deployment timestamp
   - Revision/commit that was deployed
   - Sync result (success, failed, pruned resources)

### Phase 4: Build Incident Timeline
1. **Merge all events** into a chronological timeline:
   - Deployments -> Alerts triggered -> Incident created -> Responses
2. **Identify correlations**:
   - Did a deployment happen shortly before the incident?
   - Are multiple services affected (blast radius)?
   - Is there a pattern (recurring incident)?
3. **Assess impact**:
   - Which services/teams are impacted?
   - Customer-facing or internal only?
   - Estimated time to resolution

## Output Format

```markdown
## Incident Investigation Report

### Active Incidents
| Incident | Service | Urgency | Duration | Status |
|----------|---------|---------|----------|--------|
| INC-1234 | payment-api | High | 45m | Acknowledged |

### Timeline
| Time (UTC) | Event | Source |
|------------|-------|--------|
| 14:00 | ArgoCD sync: payment-api v2.3.1 deployed | ArgoCD |
| 14:12 | Alert: payment-api error rate >5% | PagerDuty |
| 14:15 | Incident INC-1234 created (High urgency) | PagerDuty |
| 14:18 | Acknowledged by @oncall-engineer | PagerDuty |

### Probable Root Cause
Deployment of payment-api v2.3.1 at 14:00 UTC introduced a regression.
The error rate spike began 12 minutes after deployment.

### Related Jira Tickets
- **PAY-567**: "Payment API 500 errors after v2.3.1" (In Progress)
- **PAY-550**: "Migrate payment-api to new DB schema" (Done - merged 2 days ago)

### Recommended Actions
1. **Immediate**: Rollback payment-api to v2.3.0 via ArgoCD
2. **Short-term**: Review commit diff between v2.3.0 and v2.3.1
3. **Follow-up**: Create post-mortem Jira ticket
```

## Examples

- "Show me active PagerDuty incidents and find related Jira tickets"
- "Investigate the current outage - what changed recently?"
- "Correlate the payment-api incident with recent deployments"
- "Build a timeline for incident INC-1234"

## Guidelines

- Always start with PagerDuty for the source of truth on active incidents
- Look at the 24-hour window before the incident for deployment correlation
- If no incidents are active, report that clearly and suggest checking resolved incidents
- When multiple incidents exist, group by service to identify blast radius
- Include direct links to PagerDuty incidents and Jira tickets in the output
- For recurring incidents, note the frequency and link to previous occurrences
- Never suggest changes that could make the situation worse (e.g., deploying during an active incident)

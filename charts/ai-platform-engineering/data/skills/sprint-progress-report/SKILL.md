---
name: sprint-progress-report
description: Generate a comprehensive sprint progress report from Jira with velocity metrics, burndown analysis, blocker identification, and team workload distribution. Use when preparing sprint reviews, standups, or tracking sprint health mid-cycle.
---

# Sprint Progress Report

Query Jira to build a detailed sprint progress report including velocity, burndown, completion rates, and blockers.

## Instructions

### Phase 1: Sprint Data Collection (Jira Agent)
1. **Identify the current sprint**:
   - Get the active sprint from the team's Jira board
   - Collect sprint name, start date, end date, and goal
2. **Fetch all sprint issues**:
   - Stories, tasks, bugs, and subtasks in the sprint
   - For each: key, summary, status, assignee, story points, priority, labels
3. **Fetch sprint history** (for velocity):
   - Last 3-5 completed sprints
   - Committed vs. completed story points per sprint

### Phase 2: Metrics Calculation
1. **Burndown Metrics**:
   - Total committed story points
   - Completed story points
   - Remaining story points
   - Percentage complete
   - Days remaining in sprint
   - Projected completion (on track / at risk / behind)
2. **Velocity**:
   - Average velocity over last 3-5 sprints
   - Current sprint pace vs. average
   - Velocity trend (increasing, stable, decreasing)
3. **Issue Distribution**:
   - By status (To Do, In Progress, In Review, Done)
   - By type (Story, Bug, Task)
   - By assignee (workload balance)
   - By priority (Critical, High, Medium, Low)

### Phase 3: Blocker & Risk Analysis
1. **Identify blockers**:
   - Issues with \`blocked\` status or \`blocker\` label
   - Issues with no activity for >2 days while In Progress
   - Issues with unresolved dependencies
2. **Identify risks**:
   - High-priority items still in To Do with <3 days remaining
   - Unassigned items
   - Items added mid-sprint (scope creep)
   - Items removed from sprint (scope reduction)

## Output Format

\`\`\`markdown
## Sprint Progress Report
**Sprint**: Sprint 24 - "Platform Reliability"
**Period**: Feb 3 - Feb 14, 2026 | **Days Remaining**: 5
**Sprint Goal**: Improve platform monitoring and reduce incident response time

### Summary
| Metric | Value |
|--------|-------|
| Committed | 34 story points (15 issues) |
| Completed | 21 story points (9 issues) |
| Remaining | 13 story points (6 issues) |
| Completion | 62% |
| Projection | On Track (avg velocity: 32 pts) |
\`\`\`

## Examples

- "Generate a sprint progress report for the current sprint"
- "Show me sprint velocity and burndown"
- "Are we on track to complete this sprint?"
- "What are the blockers in the current sprint?"
- "Show team workload distribution for this sprint"

## Guidelines

- Always calculate projected completion based on historical velocity, not optimistic estimates
- Flag sprints as "at risk" if completion rate is below 80% at the midpoint
- Highlight scope changes (issues added or removed mid-sprint) separately
- If story points are not used, fall back to issue count
- Keep the report scannable - lead with the summary, details below
- Include the sprint goal prominently so progress can be evaluated against intent
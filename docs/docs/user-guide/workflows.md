---
title: Workflows
description: Build, run, resume, and govern multi-step agent workflows.
---

# Workflows

Workflows chain Dynamic Agents into a persistent, multi-step automation. Each
step selects an agent, supplies a prompt, and can use outputs from earlier
steps.

![Workflow authoring and run workspace](/img/features/workflows.svg)

The Workflows navigation item appears when `WORKFLOWS_ENABLED=true`.

## Build a Workflow

1. Open **Workflows** and select **Create Workflow**.
2. Add the workflow name and description.
3. Add and order agent steps.
4. Configure each step's agent, prompt, and failure behavior.
5. Save the workflow and run it with test input.

Available agents are filtered by the current user's access. Saving a workflow
does not bypass access checks when the workflow later runs.

## Run State

Workflow runs persist their current step, timeline, outputs, artifacts, and
terminal status. A run can be:

- Pending or running
- Waiting for human input
- Completed
- Failed
- Cancelled

When a step requests input, provide the requested value from the run view and
resume the run. Cancelling stops future work but does not erase events already
written to the timeline.

## Failure Behavior

Steps can stop the workflow, retry, or allow the workflow to continue,
depending on their configuration. Review downstream prompts before choosing
continue: a later step may require an output that the failed step did not
produce.

## Sharing and Agent Access

Workflow definitions and runs use separate authorization checks. Sharing a
definition or run does not automatically share every agent, skill, tool,
credential, or knowledge source used by it.

## Related Documentation

- [Workflow feature overview](../features/workflows.md)
- [Workflow RBAC](../security/rbac/workflows.md)
- [Schedules](./schedules.md)

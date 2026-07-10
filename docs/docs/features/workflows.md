---
sidebar_position: 2
---

# Workflows

Chain dynamic agents into multi-step automations with the visual workflow builder. Workflows run on demand from the chat UI, on a cron schedule, or when triggered by an approved agent tool call.

**Quick links**: [Helm Chart Docs](../installation/helm-charts/ai-platform-engineering/caipe-ui-chart) · [Security — Workflow RBAC](../security/rbac/workflows)

---

## Visual Workflow Builder

Build workflows directly in the CAIPE web UI without writing code.

- Drag-and-drop step ordering with per-step agent assignment and prompt
- Each step runs a named dynamic agent with a custom prompt and optional config overrides
- Error handling per step: `abort`, `retry` (with configurable max attempts and delay), or `continue`
- Workflow configs stored in MongoDB; optionally bootstrapped via `appConfig.workflow_configs` in the Helm chart

## Run History and Event Timelines

Every execution creates a persistent run record.

- Live status updates: `pending → running → waiting_for_input → completed / failed / cancelled`
- Per-step event timeline showing agent responses, tool calls, and errors
- Artifact storage for files produced during a run
- Shared run visibility: owners can share a run with a team for collaborative debugging

## Human-in-the-Loop (HITL)

Workflows can pause mid-execution and wait for human input or tool approval.

- Steps can emit an interrupt with a custom prompt and structured form fields
- The HITL form renders inline in the chat UI — no page navigation required
- Subagent HITL is supported: a sub-step can interrupt independently of the parent workflow
- Resume data is validated and forwarded to the waiting agent step

## Scheduling

Workflows can run on a cron schedule without human intervention.

- Configure cron expressions per workflow in the UI or via `appConfig.workflow_configs`
- Scheduled runs are owned by the service account and visible to team admins
- Schedule history and next-run time shown in the workflow list

## Agent Workflow Tools

Approved agents can trigger and monitor workflows as built-in tools.

- Add the `workflows` built-in tool to any custom agent and grant access to specific workflow configs
- The agent receives the run ID and can poll for status or surface results inline in chat
- Webhook triggers: POST to `/api/workflow-runs` with a valid Bearer token to start a run from external systems

## Access Control

Workflow configs and runs follow CAIPE's RBAC model.

- Config visibility: `private` (owner only), `team` (shared with named teams), or `global`
- Run visibility: private by default; owners can share a run with a team via the share dialog
- OpenFGA enforces per-config and per-run access on every API call
- Org admins can access any run for troubleshooting regardless of share settings

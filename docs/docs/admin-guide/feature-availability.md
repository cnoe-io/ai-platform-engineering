---
title: Feature Availability
description: Understand CAIPE feature flags, service dependencies, and authorization-gated navigation.
---

# Feature Availability

CAIPE navigation is derived from deployment configuration, service readiness,
storage mode, and authorization. A missing navigation item is not by itself a
health failure.

## Common User-Surface Controls

| Capability | Primary control or dependency |
|---|---|
| Knowledge Bases | `RAG_ENABLED` and a reachable RAG service |
| Workflows | `WORKFLOWS_ENABLED=true` |
| Workflow execution | `WORKFLOW_RUNNER_ENABLED=true` where the runner is required |
| Dynamic Agents runtime | `DYNAMIC_AGENTS_ENABLED=true` and `DYNAMIC_AGENTS_URL` |
| Schedules | `SCHEDULER_ENABLED=true`, Dynamic Agents, and persistent storage |
| Admin-only schedules | `SCHEDULER_ADMIN_ONLY=true` |
| Autonomous tasks | `ENABLE_AUTONOMOUS_AGENTS=true` |
| Credentials | `CAIPE_CREDENTIALS_ENABLED=true` |
| User Connected Apps and Saved Secrets | Credentials enabled and `CAIPE_USER_CONNECTIONS_ENABLED` not false |
| Feedback | `FEEDBACK_ENABLED` not false |
| Chat Audit | `AUDIT_LOGS_ENABLED=true` and an audit backend |
| Identity Sync | A fully configured supported directory connector |
| Prometheus charts | Server-side `PROMETHEUS_URL` |

Consult the Helm chart reference for the authoritative value names and defaults
for a release. Environment variables shown here are runtime controls used by
the Web UI.

## Storage Mode

Without a MongoDB-compatible database, CAIPE uses browser-local storage for
limited chat state. Shared agents, teams, workflows, schedules, credentials,
admin state, and other server-owned resources require persistent storage.

## Admin Tab Gates

The BFF returns a fail-closed gate map for admin destinations. Gates cover
people, integrations, skills, feedback, statistics, metrics, health,
credentials, audit, OpenFGA tools, migrations, approvals, and service accounts.

A destination appears only when both conditions are true:

1. The deployment enables its backing capability.
2. The current identity passes the destination's view gate.

Every write is checked again by its API route.

## Diagnostic Sequence

When a feature is unexpectedly absent:

1. Confirm the release and commit in build information.
2. Confirm the service and runtime flag.
3. Confirm persistent storage when required.
4. Check the user's account, teams, and platform role.
5. Use Access Explorer for the expected action.
6. Check service health and logs.


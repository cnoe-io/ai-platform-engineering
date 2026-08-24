---
title: Autonomous Tasks
description: Review owned autonomous tasks and configure eligible agents.
---

# Autonomous Tasks

The Autonomous workspace groups tasks owned by the signed-in user under the
agents that can run them. It appears when `ENABLE_AUTONOMOUS_AGENTS=true` and
the user has access to an eligible agent.

![Feature-gated Autonomous Tasks preview](/img/features/autonomous-tasks.svg)

## My Tasks

Use **My Tasks** to review task state and the agent responsible for execution.
The list is scoped to the current user and their accessible, schedulable
agents.

## Configure

Users with the automation-management capability also see an admin-only
**Configure** section. Enabling or disabling agent automation changes which
agents are eligible for autonomous execution.

Autonomous execution does not bypass normal agent, tool, credential, workflow,
or knowledge authorization.

:::note Feature availability

This surface is released behind a feature flag and can be intentionally absent
from a deployment.

:::

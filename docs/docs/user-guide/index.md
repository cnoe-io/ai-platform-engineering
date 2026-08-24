---
title: User Guide
description: Use CAIPE to chat with agents, automate work, connect knowledge, and manage personal preferences.
---

# User Guide

CAIPE gives platform teams one governed place to work with AI agents, reusable
skills, operational knowledge, and automations.

## Choose a Starting Point

| Goal | Start here |
|---|---|
| Ask an agent to perform or explain work | [Chat](./chat.md) |
| Create or configure an agent | [Dynamic Agents](./dynamic-agents.md) |
| Reuse a repeatable procedure | [Skills](./skills.md) |
| Chain agents into a repeatable process | [Workflows](./workflows.md) |
| Run an agent later or on a schedule | [Schedules](./schedules.md) |
| Search or add organizational knowledge | [Knowledge Bases](./knowledge-bases.md) |
| Connect a user account or protected token | [Credentials](./credentials.md) |
| Change defaults, appearance, or notifications | [Personal Settings](./settings.md) |

## Why a Feature Might Not Appear

CAIPE adapts its navigation to the deployment and the signed-in user. A feature
can be absent because:

- Its service or feature flag is not enabled.
- Persistent storage required by the feature is not configured.
- The user does not have access to the underlying resource.
- An administrator has limited the feature to specific teams or roles.

If you expect access, contact a CAIPE administrator with the page or resource
name. Do not request credentials or broad administrator access merely to make a
navigation item appear.

## Concepts Used Throughout the UI

| Concept | Meaning |
|---|---|
| Agent | A configured AI persona with a model, instructions, and permitted capabilities |
| Dynamic Agents | CAIPE's released runtime for user-created agents |
| MCP server | A provider that exposes tools an agent can call |
| Skill | A reusable set of instructions packaged as `SKILL.md` |
| Workflow | An ordered set of agent steps with persistent execution state |
| Knowledge base | A governed collection of sources available for retrieval |
| Team | A membership and ownership boundary used for sharing and access |


---
title: Home
description: Understand the CAIPE home page, recent work, and capability shortcuts.
---

# Home

The Home page is the starting point for signed-in users. It summarizes available
capabilities and returns you to recent work without requiring you to understand
the platform architecture.

![CAIPE Home page with the prompt composer and quick-start actions](/img/features/home.svg)

## What You See

- A welcome message using the name supplied by the identity provider
- Capability cards for commonly used platform areas
- Recent conversations
- Personal activity insights when persistent storage is enabled
- Conversations shared directly or through a team when sharing is enabled

The exact cards depend on deployment configuration. For example, knowledge
actions are shown only when RAG is enabled.

## Resume Work

Select a recent conversation to reopen it with its saved agent and history. A
shared conversation remains governed by its owner and team access settings.

If a conversation no longer opens, the conversation or its agent might have
been removed, archived, or unshared. Ask the owner or a platform administrator
to confirm access.

## Storage Behavior

In a persistent deployment, CAIPE loads recent work, insights, and sharing data
from the server. A local-storage deployment keeps only browser-local
conversation state and does not provide team sharing or server-side insights.

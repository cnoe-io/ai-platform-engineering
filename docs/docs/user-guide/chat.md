---
title: Chat
description: Start, manage, share, and resume conversations with CAIPE agents.
---

# Chat

Chat is the primary user experience for working with an agent. CAIPE keeps the
agent identity associated with each conversation and streams runtime activity as
the agent responds.

![CAIPE Chat ready to start a conversation with a Dynamic Agent](/img/features/chat.svg)

## Start a Conversation

1. Open **Chat**.
2. Select **New Chat**.
3. Choose an agent you can access.
4. Enter a request and send it.

When a usable personal or platform default exists, CAIPE uses it for the new
conversation. Otherwise, choose an agent before sending the first message.

## During a Response

Depending on the agent and its tools, the timeline can show:

- Streamed assistant content
- Tool calls and results
- Subagent activity
- Status and warning events
- Generated or attached files
- A request for human input or approval

Do not refresh solely because a long-running tool is quiet. Use the visible run
state, cancel action, or retry action when available.

## Conversation Management

Persistent deployments can provide:

- Conversation search and history
- Pinning and bookmarks
- Archive, restore, trash, and delete operations
- Direct-user and team sharing
- Message feedback
- Conversation metadata and saved turns

Available actions are limited by ownership and relationship-based access
checks. Sharing a conversation does not grant access to its agent, tools,
knowledge bases, or credentials.

## Agent Access Errors

If CAIPE returns an `agent#use` permission error, the user can see the agent
record but is not authorized to invoke it. Choose another accessible agent or
ask the agent owner or administrator to grant the appropriate team access.

## Related Documentation

- [Dynamic Agents](./dynamic-agents.md)
- [Personal Settings](./settings.md)
- [Chat Conversations API](../api/chat-conversations.md)

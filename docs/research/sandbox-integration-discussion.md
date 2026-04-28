# Sandbox Integration: Isolated Execution Environments for Custom Agents

> **Type:** GitHub Discussion Draft
> **Date:** April 2026

---

## Summary

We're exploring sandbox integration for Custom Agents — giving agents access to isolated environments where they can execute code, run CLI commands, and interact with file systems, without coupling the sandbox lifecycle to the agent runtime.

The key design principle: **the lifecycle of a sandbox is separate from the agent runtime lifecycle.** Sandboxes are long-lived, user-managed resources that can be attached to and detached from agent conversations independently.

## Motivation

Today, Custom Agents operate without persistent, isolated execution environments. When an agent needs to run code or interact with a file system, it relies on the runtime's own environment, which is ephemeral and shared. This creates limitations:

- No safe way for agents to execute arbitrary code or CLI commands
- No persistence across agent restarts or conversation switches
- No isolation between users or between chat sessions
- No way for a user to bring their own environment to an agent interaction

Sandboxes solve this by providing managed, isolated environments that agents can use on demand.

## Architecture

### Sandbox Service (Decoupled)

We envision a **separate sandbox service** that handles provisioning, connectivity, and lifecycle management. The service sits alongside the agent runtime — not inside it.

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│              │     │                  │     │                  │
│     UI       │────▶│  Sandbox Service │────▶│  Sandbox Runtime │
│              │     │  (management)    │     │  (openshell/k8s) │
│              │     │                  │     │                  │
└──────┬───────┘     └──────────────────┘     └──────────────────┘
       │                                              ▲
       │             ┌──────────────────┐              │
       └────────────▶│  Agent Runtime   │──────────────┘
                     │                  │  (attached via API)
                     └──────────────────┘
```

This separation is deliberate: the sandbox service could be replaced by the management plane of an upstream sandbox provider without any changes to the agent or UI layer.

### Technologies Under Exploration

- **[NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell)** — Provides containerized shell environments with agent-friendly APIs
- **[Kubernetes Agent Sandbox (SIG)](https://github.com/kubernetes-sigs/agent-sandbox)** — Kubernetes-native sandbox provisioning for AI agents

Both provide isolated execution environments with network and filesystem isolation. We're evaluating which fits best as the backend for our sandbox service.

## User Experience

### Creating Sandboxes

Users create and manage sandboxes directly from the UI, separate from any agent. Sandboxes have their own:

- **Name and description**
- **Visibility** (private, team, or global)
- **Status** (active or hibernating)
- **Type** (e.g., openshell — extensible to other providers)

### Attaching Sandboxes to Agents

When configuring a Custom Agent, creators choose a sandbox mode:

| Mode | Behavior |
|------|----------|
| **No Sandbox** | Agent runs without an isolated environment. Best for simple agents that don't need file system or shell access. |
| **Shared Sandbox** | A single sandbox is used for all users and chats. Ideal for read-only environments or shared team workspaces. |
| **User Chooses** | Users pick which sandbox to use (or skip) when starting a new chat. Flexible — users can select an existing sandbox or create a new one. |
| **Fresh Per Chat** | A new sandbox is automatically created for each conversation. Maximum isolation — each chat gets a clean environment. |

### In-Chat Experience

When an agent is configured with "User Chooses" mode, the user sees a sandbox picker on the new chat welcome screen. They can:

- Select from their existing sandboxes
- Proceed without a sandbox
- Remember their choice for future chats with that agent

Once attached, the sandbox appears in the agent's context panel with an option to detach it.

### Policy Layer

A configurable policy layer would govern sandbox behavior:

- Which users/teams can create sandboxes
- Resource limits (CPU, memory, storage, network)
- Allowed/blocked commands or binaries
- Network egress rules
- Maximum sandbox lifetime and auto-cleanup

## Open Questions

1. **Sandbox hibernation** — Should hibernating sandboxes auto-wake when attached to a new chat, or should the user explicitly wake them?

2. **Cleanup strategy for "Fresh Per Chat"** — What's the right default retention period? Should users be able to "save" a per-chat sandbox before it's cleaned up?

3. **Multi-agent sandbox sharing** — Should a sandbox be attachable to multiple agents simultaneously, or is it 1:1 per conversation?

4. **Sandbox templates** — Should we support templates (e.g., "Python dev environment", "Node.js environment") for quick provisioning?

5. **Backend selection** — OpenShell vs. agent-sandbox vs. pluggable provider interface — what's the right abstraction?

## References

- [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell)
- [Kubernetes Agent Sandbox (SIG)](https://github.com/kubernetes-sigs/agent-sandbox)
- UI mockup writeup: `docs/research/sandbox-ui-mockup-writeup.md`

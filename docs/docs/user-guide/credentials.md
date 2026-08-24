---
title: Credentials
description: Connect applications and store protected secrets for CAIPE tools.
---

# Credentials

The Credentials workspace lets a user provide tool-specific authorization
without placing raw credentials in an agent prompt or conversation.

![Privacy-safe Credentials feature preview](/img/features/credentials.svg)

It appears when the credentials service and user connections are enabled.

## Connected Apps

Connected Apps use an administrator-configured OAuth connector. A user can:

- Start the provider authorization flow
- Review connection health and profile information
- Refresh or reconnect an expired connection
- Remove a connection

The available providers and requested scopes are controlled by the deployment.

## Saved Secrets

Saved Secrets stores bearer tokens and other supported secret values through
the configured secret provider. After creation, CAIPE displays metadata but
does not return the original raw value to the browser.

Depending on policy, a secret can be private or shared with named teams.
Removing or rotating a secret can interrupt agents and MCP servers that depend
on it.

## How Agents Use Credentials

An MCP server declares one or more credential sources. At request time, the
CAIPE BFF resolves an allowed source for the caller and sends the resulting
authorization to the MCP provider. Selecting a credential does not add its raw
value to the agent blueprint or chat transcript.

## Safety

- Prefer OAuth connections over manually copied long-lived tokens.
- Grant the minimum provider scopes needed by the tools.
- Do not paste credentials into chat, prompts, agent descriptions, or support
  tickets.
- Revoke credentials when their owner or purpose changes.

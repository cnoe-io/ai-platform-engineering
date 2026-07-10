---
sidebar_position: 1
---

# Solution Architecture

Users reach CAIPE through Slack, Webex, the UI, or CLI. Keycloak authenticates every path, CAIPE Agent(s) run the request, and AgentGateway routes MCP tool calls after OpenFGA authorization.

![Solution Architecture](images/6_solution_architecture.svg)

## Client authentication

- **Slack / Webex bots** — platform events → bot integration → OBO JWT token exchange (bot as actor)
- **CAIPE UI / CLI** — PKCE flow

Keycloak federates to your IdP and issues JWTs with realm roles.

## Agent and tool path

1. CAIPE Agent(s) receive the user JWT and run the selected agent profile.
2. AgentGateway calls OpenFGA (`ext_authz`) before routing to MCP servers.

See [Gateway Architecture](./gateway.md) for AgentGateway details and [Scheduler](./scheduler.md) for scheduled runs.

---
title: Resources
description: Administer CAIPE agents, tools, knowledge, skills, service accounts, and credentials.
---

# Resources

![Agent configuration resource administration](/img/features/resources.svg)

Resources contains the shared building blocks used by agents and automations.
Each destination has an independent navigation gate and action-level policy.

## Agent Configuration

Import and reconcile agents defined in platform configuration. Config-driven
agents are managed by deployment configuration and should remain read-only in
the UI.

Use reconciliation after changing the declared configuration or repairing
missing database state. Do not use it as a substitute for diagnosing ownership
or authorization problems.

## Autonomous

Monitor autonomous execution and manage automation eligibility when the
autonomous service is enabled. Autonomous execution retains normal resource and
tool authorization; it is not an administrator bypass.

## MCP Catalog

Manage the MCP providers available for agent configuration:

- Register endpoint and transport information
- Configure supported credential-source metadata
- Probe endpoint and authentication readiness
- Discover or synchronize AgentGateway targets when configured
- Test individual tools with controlled input

A connectivity test proves that CAIPE can reach the endpoint. It does not prove
that every user is authorized to invoke every exposed tool.

## RAG

Configure knowledge defaults, ingestion limits, source adoption, and
publication review. Knowledge administration should preserve the separation
between source ownership, ingest permission, search permission, and publication
approval.

## Skill Hubs

Register external GitHub or GitLab repositories as skill sources, refresh or
crawl them, and review their catalog state. Hub ingestion can call the configured
Skill Scanner. A clean scan is best-effort and does not guarantee safety.

## Service Accounts

Service accounts provide identities for non-human callers. Administrators can:

- Create display metadata and link the provider identity
- Assign owning teams
- Grant supported scopes
- Rotate credentials
- Revoke the account
- Find provider identities that have not yet been linked

Store newly issued credentials immediately; CAIPE does not treat the admin UI
as a durable plaintext credential vault.

## Credentials

Configure OAuth connectors and review platform-managed credential metadata and
audit events. Raw user secret values are not returned to administrators.

## Related Documentation

- [Dynamic Agents](../user-guide/dynamic-agents.md)
- [Skills](../features/skills/README.md)
- [Knowledge Bases](../knowledge_bases/index.md)
- [Service account and RBAC concepts](../security/rbac/architecture.md)

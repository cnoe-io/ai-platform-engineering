---
title: Administrator Guide
description: Govern CAIPE people, resources, integrations, operations, and security policy.
---

# Administrator Guide

The Admin workspace manages shared CAIPE platform state. It is separate from
personal Settings and displays only destinations authorized for the current
identity.

## Admin Areas

| Area | Purpose |
|---|---|
| [Teams & Users](./teams-users.md) | People, roles, teams, membership, resources, and identity sync |
| [Platform configuration](./platform-configuration.md) | Defaults and platform-wide announcements |
| [Resources](./resources.md) | Agents, MCP, RAG, skills, service accounts, and credentials |
| [Integrations](./integrations.md) | Slack and Webex routing and access |
| [Insights](./insights.md) | Adoption, activity, outcomes, and feedback |
| [Metrics & Health](./operations.md) | Operational metrics, component health, and build information |
| [Security & Policy](./security-policy.md) | Access policy, approvals, audits, diagnostics, and migrations |

## Authorization Model

Admin navigation is fail-closed. The BFF evaluates admin tab gates and returns
only the areas the current subject can view. A person can therefore manage a
team or integration without receiving unrestricted organization administration.

Page visibility does not replace action authorization. Every mutation must
also pass the route's policy decision.

## View As

Where available, **View as** simulates another user or team to explain visible
navigation and effective access. Simulation is read-only. Exit simulation
before attempting an administrative change.

## Before Applying a Change

1. Confirm the target identity or resource.
2. Review the owning team and current relationships.
3. Prefer the narrowest grant or scope that satisfies the requirement.
4. Apply the change and verify the resulting effective access.
5. Use audit and self-check surfaces when the result differs from expectation.

## Deployment Dependencies

An authorized destination can still be hidden when its backing service or
feature is disabled. See [Feature Availability](./feature-availability.md).


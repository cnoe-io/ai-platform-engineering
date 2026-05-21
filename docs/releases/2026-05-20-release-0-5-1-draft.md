---
slug: release-0.5.1-draft
title: "Draft Release 0.5.1 — Safer Access Control and Connector Onboarding"
date: 2026-05-20
authors: [sriaradhyula]
tags: [release, draft]
draft: true
---

> Draft source: [PR #1444](https://github.com/cnoe-io/ai-platform-engineering/pull/1444)
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.5.1`
> Previous release: confirm before publishing

## Highlights

Release 0.5.1 focuses on making access control safer, easier to operate, and more consistent across CAIPE. It moves more permission decisions into one central authorization model, adds better admin screens for troubleshooting access, and improves Slack and Webex onboarding so teams can connect chat spaces to agents with fewer manual steps.

<!-- truncate -->

For everyday users, the main change is that agent access should feel more predictable: the same permission model is now used across the web UI, Slack, Webex, Dynamic Agents, RAG, workflows, and tool access. For platform admins, this release adds the migration and diagnostic tools needed to see why a user can or cannot access a resource.

## Quick Guide for Non-Specialists

This release touches several infrastructure components. Here is what they mean in plain English:

- **Keycloak** is the login system. It confirms who the user is.
- **OpenFGA** is the permission system. It answers questions like "Can this user use this agent in this team?"
- **ReBAC** means relationship-based access control. Instead of only checking broad roles like "admin" or "viewer", the platform checks relationships such as user -> team -> agent -> channel.
- **BFF** means backend-for-frontend. It is the UI backend that safely handles browser and connector requests.
- **OBO** means on-behalf-of token exchange. It lets a bot call CAIPE as the real user, with that user's permissions.
- **Slack/Webex connectors** are the bot integrations that let users talk to CAIPE agents from Slack channels or Webex spaces.

## What This Means for Users

### Chat and Agent Users

- Access to agents, tools, RAG content, conversations, workflows, and tasks is checked more consistently.
- If you use Slack or Webex, the bot should give clearer messages when access is missing or a channel/space needs setup.
- Teams should see fewer cases where something works in the web UI but fails from a chat connector, or vice versa.

### Team and Platform Admins

- Admin screens now expose more of the access-control state, including relationships, migrations, graph views, tuple checks, connector routes, and runtime sync status.
- Slack channels and Webex spaces can be onboarded and managed with explicit team and agent bindings.
- Admins can inspect and repair Keycloak/OpenFGA migration health from the UI instead of relying only on logs or one-off scripts.

### Operators

- Helm charts now include more of the identity and authorization setup directly, including Keycloak reconciliation, bot secret handling, OpenFGA model loading, token exchange setup, and the CAIPE login theme.
- Runtime bot traffic now uses integration-specific access-check routes instead of admin-only routes.
- CI and validation coverage was expanded for RBAC, Keycloak init, OpenFGA bridge, Webex bot, and RBAC documentation.

## What's New

### Unified Access Control

- CAIPE product permissions now use OpenFGA as the main source of truth for resource access.
- Permission checks were expanded across major product areas: Dynamic Agents, RAG, Slack, Webex, MCP tools, chat conversations, workflows, tasks, skills, and admin APIs.
- Legacy checks based only on MongoDB ownership, visibility flags, or team membership were reduced on high-risk paths.
- Bootstrap admin emails are resolved by the CAIPE UI BFF into durable OpenFGA grants so fresh installs can complete setup and migrations without hardcoding Keycloak UUIDs.

### Admin Tools for Access Management

- New ReBAC admin flows help admins inspect resources, relationships, graph views, migrations, drift, and access decisions.
- Admins can run access checks and see why a user is allowed or denied.
- Migration health views make it easier to detect and repair stuck Keycloak/OpenFGA states.
- Identity group sync support was added so team membership can be reconciled from upstream identity provider claims and groups.

### Slack Connector Improvements

- Slack channels can be mapped to teams and agents through OpenFGA-backed routes.
- Optional first-message auto-assignment can map a new Slack channel to a configured default team and agent.
- Admins can inspect Slack route-cache status, reload routes, and sync Slack config into MongoDB/OpenFGA during migration.
- Slack denial and setup messages were improved so users and operators get clearer next steps.
- Slack bot token handling, active team validation, email masking, and log redaction were tightened.

### Webex Connector Improvements

- Webex bot support now includes runtime handling, WebSocket/WDM support, A2A client wiring, admin APIs, and tests.
- Webex spaces can be connected to teams and agents using the same OpenFGA-backed model as Slack channels.
- Admins can onboard spaces, inspect diagnostics, manage routes, reload runtime state, and sync config.
- Webex denial and setup messages were improved for users and operators.

### Keycloak and Login Improvements

- The Helm chart now packages a customizable CAIPE Keycloak login theme.
- Keycloak auth reconciliation now runs from the chart during install and upgrade, instead of relying on deployment-specific extra hooks.
- Brokered enterprise SSO users are no longer interrupted by the Keycloak "verify profile" prompt for first and last name collection.
- Token exchange setup and bot client secrets are now represented in chart templates and values.
- Keycloak SSO idle time was adjusted so refresh tokens last long enough during local and release validation.

### Dynamic Agents, MCP, and RAG

- A shared MCP auth package was added for JWT validation, JWKS caching, OAuth2 token handling, PDP checks, and token context.
- Dynamic Agents gained JWT middleware, OpenFGA checks, OBO token exchange, and safer outbound token forwarding.
- RAG authorization now includes OpenFGA-backed team access and document ACL handling.
- Dynamic Agent conversation file routes now enforce `dynamic_agent#invoke` before forwarding file requests.

### Release and Test Coverage

- New RBAC matrix tests define expected allow/deny behavior across product routes.
- New Playwright E2E stories cover admin UI, manual team management, identity group sync, policy authoring, graph/access checks, Slack channel ReBAC, and Webex space ReBAC.
- New CI workflows validate RBAC docs, Keycloak init, OpenFGA auth bridge, Webex bot behavior, and RBAC scenarios.
- Release branch CI fixes cleaned up secret-scan fixtures, lint issues, and production TypeScript build errors.

## Fixes

- **Supervisor connection from the UI**: Production deployments no longer expose `localhost` as the browser-facing supervisor URL. The UI now routes through a same-origin API proxy.
- **Keycloak profile prompt**: Enterprise SSO users are no longer stopped by the `VERIFY_PROFILE` prompt during login.
- **Keycloak reconciliation**: Install and upgrade flows now restore required identity-provider and profile settings from the chart.
- **Runtime bot authorization**: Slack and Webex bots now use integration-scoped access-check routes instead of admin UI routes for normal user traffic.
- **OpenFGA bootstrap**: Fresh installs now seed human bootstrap admin grants through the CAIPE UI BFF email reconciler; `openfga.init.seedTuples` remains available for non-user emergency recovery tuples.
- **LiteLLM MCP startup**: FastMCP 3.x startup now passes host and port at transport startup time, preventing the LiteLLM MCP image from crashing before binding.
- **Webex RBAC matrix coverage**: Webex route entries now use Next.js App Router path syntax so release CI can resolve committed route handlers.
- **Release build type safety**: Webex import rows, team Webex space persistence, and Slack default relationship types were narrowed so the UI image can build under stricter production TypeScript checks.
- **Release CI hygiene**: Synthetic auth fixtures were changed to avoid secret-scan matches, unused imports were removed, and RBAC lint failures were resolved.
- **Docker build context**: VM deployment builds no longer traverse persisted runtime volumes, local node modules, VCS metadata, or test artifacts.

## Security and Reliability Notes

- Authorization is now more centralized around OpenFGA, reducing the chance that different parts of the product make different access decisions.
- Bot runtime checks are separated from admin UI authorization, so normal Slack/Webex user traffic no longer depends on admin-only gates.
- Test fixtures were adjusted so secret scanning can run cleanly without weakening the scanner.
- Audit, tracing, and documentation validation were expanded around the RBAC migration.

## Breaking Changes

No explicit breaking change was called out in PR #1444, but this is a large authorization release. Operators should treat the upgrade as a managed rollout and validate access for representative users, teams, agents, Slack channels, Webex spaces, RAG content, and workflows before broad production use.

## Known Follow-Ups

The PR intentionally split several review follow-ups into separate issues:

- [#1454](https://github.com/cnoe-io/ai-platform-engineering/issues/1454): Refactor Dynamic Agents runtime auth surface after RBAC review.
- [#1455](https://github.com/cnoe-io/ai-platform-engineering/issues/1455): Add runtime BFF ReBAC checks for Slack and Webex bots.
- [#1456](https://github.com/cnoe-io/ai-platform-engineering/issues/1456): Move Slack bot identity and team resolution behind the BFF.
- [#1457](https://github.com/cnoe-io/ai-platform-engineering/issues/1457): Simplify RAG authorization to a thin policy enforcement point around OpenFGA.
- [#1458](https://github.com/cnoe-io/ai-platform-engineering/issues/1458): Document RBAC transitional dual gates and retirement plan.

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.5.1 \
  -f your-values.yaml
```

## Upgrade Guidance

### Before Upgrading

- Confirm your Keycloak, OpenFGA, MongoDB, Slack, and Webex values are present in your environment-specific `values.yaml`.
- Review any custom admin roles, team mappings, Slack channel mappings, Webex space mappings, RAG permissions, and dynamic agent tool permissions.
- Plan a short validation window with test users from at least one admin team and one non-admin team.

### After Upgrading

- Confirm pods are healthy:

```bash
kubectl get pods -n <namespace>
```

- Check Keycloak migration health in the admin UI.
- Check OpenFGA/ReBAC migration status and relationship graph views in the admin UI.
- Validate that a known user can access an expected agent from the web UI.
- Validate Slack and Webex channel/space access if those connectors are enabled.
- Validate that denied users receive clear denial messages rather than silent failures.

### Suggested Smoke Tests

- Admin can open the RBAC/ReBAC admin tab.
- Admin can inspect a team, its resources, and its Slack/Webex mappings.
- A team member can use an assigned agent.
- A non-member cannot use that team's private agent or connector route.
- Slack channel or Webex space setup shows actionable diagnostics.
- RAG queries respect team access.
- Workflow and task routes enforce expected team/resource permissions.

## Validation Recorded on the PR

PR #1444 records these checks in the PR body:

- `git diff --check`
- no unresolved merge conflicts or conflict markers
- `npm test -- --runTestsByPath 'src/app/(app)/admin/__tests__/admin-page.test.tsx'`

Current GitHub checks on the PR show DCO, CodeQL, and CodeQL analysis jobs for actions, Go, JavaScript/TypeScript, and Python passing.

## Technical Release Notes

### Authorization Model Expansion

- **OpenFGA-backed resource checks**: Dynamic Agents, MCP server management, RAG tools, workflow configs, workflow runs, task configs, skills, and chat conversation routes now use concrete resource checks instead of relying only on coarse role gates or MongoDB ownership fields.
- **Conversation access model**: Private conversations continue to use implicit Mongo ownership, while sharing and cross-team access use explicit OpenFGA relationships. List, detail, search, trash, archive, restore, pin, share, and Dynamic Agent proxy routes now converge on the same implicit-or-explicit check.
- **Team resource grants**: Admin team resource updates reconcile OpenFGA relationships before persisting Mongo state so MongoDB does not get ahead of the enforcement store during PDP failures.
- **Bootstrap relationships**: The CAIPE UI BFF resolves bootstrap admin emails to Keycloak subjects and seeds durable OpenFGA `organization` and `system_config:platform_settings` grants, avoiding hardcoded Keycloak UUIDs in Helm values.

### Keycloak and OBO Runtime

- **Chart-managed reconciliation**: Keycloak realm setup, identity-provider settings, token-exchange permissions, profile mappers, bot client scopes, and bot service-account roles are reconciled by chart hooks and the UI startup migration instead of scattered manual scripts.
- **Bot OBO permissions**: Slack and Webex bot clients are granted token-exchange permissions for the `caipe-platform` audience, with the target-audience permission using an affirmative strategy when multiple bot policies are attached.
- **Active team scopes**: Team-owned `team-<slug>` client scopes carry the `active_team` claim used by Slack/Webex OBO flows to bind a chat request to the resolved CAIPE team.
- **Production bot secrets**: Bot OBO client secrets are expected to be stable ExternalSecret-backed values in production. For Grid RBAC this uses Keeper paths `projects/caipe/rbac/slackbot` / `KEYCLOAK_SLACK_BOT_CLIENT_SECRET` and `projects/caipe/rbac/webexbot` / `KEYCLOAK_WEBEX_BOT_CLIENT_SECRET`.

### Slack and Webex Connectors

- **Runtime route authorization**: Connector runtime traffic now uses integration-specific access-check routes instead of admin-only routes, separating user interaction authorization from admin surface authorization.
- **Channel and space ownership**: Slack channel and Webex space mappings resolve the effective team from MongoDB mappings and then verify membership through OpenFGA before issuing OBO tokens.
- **Admin-managed connector routes**: Admin panels can inspect, sync, and reload connector route state, including OpenFGA-backed agent grants for Slack channels and Webex spaces.
- **User messaging**: Denial, setup, and transient failure messages were centralized so users get clearer next steps when a team mapping, account link, or permission is missing.

### Dynamic Agents, MCP, and RAG

- **Dynamic Agent PDP gates**: Dynamic Agent create, update, delete, invoke, resume, cancel, file, and picker paths now enforce resource-level authorization before MongoDB writes or downstream runtime calls.
- **MCP authorization package**: Shared MCP auth utilities now cover JWT validation, JWKS caching, OAuth2 token context, and PDP checks for services that need consistent auth enforcement.
- **RAG team access**: RAG BFF routes constrain datasource and knowledge-base access by OpenFGA relationships, while the RAG server repeats token and authorization checks for direct API/MCP access.
- **Tool and server grants**: MCP server routes and RAG tool routes add concrete `mcp_server` and `tool` resource checks so admin and team grants can be reasoned about consistently.

### Admin UI and Diagnostics

- **Migration surfaces**: Admin migration screens expose Keycloak/OpenFGA status, dry-run counts, JSON reports, explicit confirmation gates, and persisted schema/data version state.
- **Access graph inspection**: ReBAC admin tools expose relationship graph, tuple checks, migration history, and access-check diagnostics to help explain allow/deny decisions.
- **Connector onboarding**: Slack channel and Webex space admin panels support discovery, manual IDs, team binding, agent binding, and route sync diagnostics.
- **Header/status indicators**: Admin health panels and status hooks surface migration health so operators can see stale or failed reconciliation without reading pod logs first.

### Validation Additions

- **RBAC matrix coverage**: New route-level tests exercise allow/deny behavior for Dynamic Agents, chat conversations, MCP servers, RAG tools, skills, tasks, workflow configs, workflow runs, Slack access checks, and Webex access checks.
- **Connector tests**: Slack and Webex bot tests cover team resolution, OBO exchange, runtime gates, admin APIs, route sync, and user-facing failure messages.
- **Admin UI tests**: Admin page, migration tab, Keycloak migration health, ReBAC panels, admin tab gates, and header status tests were expanded for the new authorization surfaces.
- **Docs validation**: RBAC documentation was split into canonical architecture, workflows, usage, and file-map references, with validation coverage to keep auth-relevant files documented.

# Comprehensive RBAC Refactor

This page is the short, end-to-end explanation of the Comprehensive RBAC
refactor: what changed, which system owns each decision, and how Keycloak,
AgentGateway, OpenFGA, the Admin UI, Dynamic Agents, and Slack fit together.

## TL;DR

Comprehensive RBAC makes **Keycloak the identity and role issuer**,
**AgentGateway the MCP policy enforcement point**, and **OpenFGA the relationship
policy engine**.

Today, enforcement is split by responsibility:

- **Keycloak JWT roles** still provide signed identity facts and management-plane
  fallback checks.
- **AgentGateway** validates JWTs and delegates MCP authorization to **OpenFGA**
  through `ext_authz`.
- **Admin UI Team Resources** writes Keycloak roles for transition compatibility
  and OpenFGA tuples for relationship decisions.
- **OpenFGA** owns the relationship graph for user/team/tool, agent, and KB
  access. The current AgentGateway bridge uses OpenFGA for the gateway decision
  and defaults to the configured coarse MCP object unless deployed with a more
  specific relation/object mapping.

## Big Picture

```mermaid
flowchart TD
  User[User / Slack User] --> UI[CAIPE UI / Slack Bot]

  UI --> KC[Keycloak]
  KC --> JWT[Signed JWT<br/>sub, email, coarse roles, active_team]

  UI --> DA[Dynamic Agents Runtime]
  Slack[Slack Bot] --> OBO[Keycloak Token Exchange<br/>OBO token with act.sub + active_team]
  OBO --> DA

  DA --> AGW[AgentGateway<br/>PEP for MCP tools]

  AGW --> JWTAuth[jwtAuth<br/>verify iss/aud/exp/JWKS]
  JWTAuth --> ExtAuthz[extAuthz gRPC]
  ExtAuthz --> Bridge[openfga-authz-bridge]
  Bridge --> FGA[OpenFGA PDP]

  FGA --> AGW
  AGW --> MCP[MCP Servers<br/>Jira, RAG, GitHub, ArgoCD]

  Admin[Admin UI<br/>Teams / Resources] --> Mongo[(MongoDB<br/>teams, resources)]
  Admin --> KCScopes[Keycloak Admin API<br/>client scopes + coarse roles]
  Admin --> FGATuples[OpenFGA tuple writer]
  FGATuples --> FGA
```

## Request Flow

1. A user logs in through Keycloak, usually brokered from an enterprise IdP such
   as Duo SSO or Okta.
2. Keycloak issues a signed JWT.
3. The JWT carries identity, coarse roles such as `admin` and `chat_user`, and
   request context such as `active_team`.
4. Dynamic Agents forwards the user JWT to AgentGateway when calling MCP tools.
5. AgentGateway verifies the JWT with Keycloak JWKS.
6. AgentGateway calls OpenFGA through gRPC `extAuthz`.
7. If OpenFGA allows, the MCP request reaches Jira, RAG, GitHub, ArgoCD, or another
   backend MCP server.

```mermaid
sequenceDiagram
  participant DA as Dynamic Agent
  participant AGW as AgentGateway
  participant KC as Keycloak JWKS
  participant FGA as OpenFGA Bridge/PDP
  participant MCP as MCP Server

  DA->>AGW: MCP request + Bearer JWT
  AGW->>KC: Validate JWT signature, issuer, audience, expiry
  AGW->>FGA: gRPC extAuthz Check with jwt.sub
  FGA-->>AGW: allow / deny
  AGW->>MCP: Forward allowed request
```

Failure behavior:

- JWT validation fails: AgentGateway returns `401`.
- OpenFGA denies or is unavailable: AgentGateway returns `403`.

## Keycloak Role Model

Keycloak owns authentication, JWT issuance, and realm-role materialization.

| Role | Meaning |
|------|---------|
| `chat_user` | Basic authenticated CAIPE user |
| `admin` | Admin UI access |
| `kb_admin` | Legacy coarse knowledge base administration |
| `admin_user` | Spec 104 superuser for resource checks |
| `team_member:<slug>` | Temporary compatibility role; new membership writes use OpenFGA |
| `team_admin:<slug>` | Temporary compatibility role; team admin grants should move to OpenFGA |
| `agent_user:<agent_id>` | Legacy compatibility role; new agent use grants are OpenFGA tuples |
| `agent_admin:<agent_id>` | Legacy compatibility role; new agent manage grants are OpenFGA tuples |
| `tool_user:<tool>` | Legacy compatibility role; new tool grants are OpenFGA tuples |
| `tool_user:<server>_*` | Legacy compatibility role; new server-prefix grants are OpenFGA tuples |
| `tool_user:*` | Legacy compatibility role; new wildcard tool grants are OpenFGA tuples |

The `active_team` JWT claim tells AgentGateway which team context is active for
the request. Team slugs, not Mongo ObjectIds, are used in client scopes and
OpenFGA relationship objects.

## AgentGateway

AgentGateway is the central policy enforcement point for MCP traffic. It is not
the identity store and it does not mint tokens. It validates Keycloak-issued
JWTs, then delegates relationship checks to OpenFGA.

AgentGateway policy order:

1. `jwtAuth`: strict JWT validation against Keycloak issuer, audience, expiry,
   and JWKS signature.
2. `extAuthz`: gRPC call to `openfga-authz-bridge`, passing verified `jwt.sub`
   metadata.
3. MCP proxy: forwards the request to the configured backend server only after
   all policy layers allow.

## OpenFGA Rules

The current OpenFGA model contains the existing coarse AgentGateway gate plus
richer ReBAC facts written from the Admin UI.

```text
user:<sub> can_call document:mcp

user:<sub> member team:<slug>
team:<slug>#member can_use agent:<agent_id>
team:<slug>#member can_manage agent:<agent_id>
team:<slug>#member can_call tool:<server>_*
team:<slug>#member can_call tool:*

team:<slug>#member can_read knowledge_base:<id>
team:<slug>#member can_ingest knowledge_base:<id>
team:<slug>#member can_admin knowledge_base:<id>
```

Important nuance: AgentGateway currently checks OpenFGA only for the coarse
`document:mcp` object. The richer `team`, `agent`, `tool`, and `knowledge_base`
tuples are written now so the relationship graph is ready for full per-resource
PDP enforcement once MCP tool context is passed into OpenFGA checks.

## Admin UI As Policy Authoring Surface

The Admin UI has two human-facing ReBAC surfaces:

- **Team Resources** is the source-of-truth editor for team grants. Admins choose
  which agents and MCP tool prefixes a team can use, and the BFF materializes the
  change into OpenFGA tuples and Mongo intent.
- **OpenFGA ReBAC** is the relationship workbench. It provides a guided tuple
  builder, effective-access preview, full-screen all-relationship graph viewing,
  drag/drop policy/resource graph editing, and advanced tuple inspector without
  exposing OpenFGA directly to the browser.

When an admin saves team resources:

```mermaid
flowchart LR
  Save[Admin saves Team Resources] --> FGA[OpenFGA tuple reconciliation]
  Save --> Mongo[Mongo team.resources]

  FGA --> Graph[Relationship graph]
  Mongo --> UI[Admin UI source of truth]
```

Example: granting `platform-engineering` access to Jira writes:

- OpenFGA tuple: `team:platform-engineering#member can_call tool:jira_*`

Most admins should use Team Resources. Platform admins can use OpenFGA ReBAC for
one-off relationship creation, graph-based staging/review, checks,
visualization, and safe tuple cleanup.
MongoDB keeps the UI-level intent, Keycloak gets JWT-compatible role
context, and OpenFGA gets the relationship graph.

## Slack Path

Slack uses the same authorization model, but gets user context through
On-Behalf-Of token exchange.

```mermaid
flowchart TD
  SlackUser[Slack user] --> Bot[Slack Bot]
  Bot --> Link[Resolve Slack user to Keycloak user]
  Bot --> Team[Resolve Slack channel to team]
  Bot --> OBO[Keycloak OBO token exchange<br/>sub=user, act.sub=slack-bot, active_team=team]
  OBO --> DA[Dynamic Agent]
  DA --> AGW[AgentGateway]
```

If a Slack channel is mapped to `platform-engineering`, the bot requests an OBO
token with `active_team=platform-engineering`. AgentGateway then sees the same
user/team context as the web UI path.

## Ownership Summary

| Component | Owns | Does not own |
|-----------|------|--------------|
| Keycloak | Identity, JWT signing, realm roles, OBO token exchange | MCP proxying, OpenFGA relationships |
| Admin UI | Human policy authoring, team resources, Mongo source of intent | JWT validation for MCP traffic |
| Dynamic Agents | Agent runtime, tool loading, forwarding user JWT to MCP path | Final MCP authorization |
| AgentGateway | JWT validation, OpenFGA `extAuthz`, MCP proxying | User database, token minting, policy storage |
| OpenFGA | Relationship graph and PDP decisions | JWT validation, traffic proxying |
| MCP servers | Domain APIs such as Jira, RAG, GitHub, ArgoCD | Primary centralized authorization |

## One-Sentence Mental Model

Keycloak says who you are and what role stamps are on your badge; OpenFGA says
what relationships you have to teams and resources; AgentGateway checks both
before any MCP tool is allowed to run.

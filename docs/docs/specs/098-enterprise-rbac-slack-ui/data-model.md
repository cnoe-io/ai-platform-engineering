# Data Model: Enterprise RBAC for Slack and CAIPE UI

**Phase 1 Output** | **Date**: 2026-03-25 | **Plan**: [plan.md](./plan.md)

## Entity Overview

```text
┌──────────────┐    groups→roles    ┌──────────────┐
│  Enterprise  │ ─────────────────▶ │   Keycloak   │
│  IdP (Okta,  │   identity        │   Realm      │
│  Entra, SAML)│   brokering       │              │
└──────────────┘                    └──────┬───────┘
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                     ┌──────────────┐ ┌─────────┐ ┌──────────┐
                     │  Realm Roles │ │Resources│ │  Users   │
                     │  (platform + │ │(agents, │ │(sub, attrs│
                     │   per-KB/    │ │ KBs)    │ │ slack_id) │
                     │   per-agent) │ │         │ │           │
                     └──────────────┘ └─────────┘ └──────────┘
                              │                         │
                              ▼                         ▼
                     ┌──────────────┐          ┌──────────────┐
                     │   MongoDB    │          │  Slack Link  │
                     │  (teams, KB  │          │  (user attr  │
                     │  ownership,  │          │  in Keycloak)│
                     │  channels)   │          │              │
                     └──────────────┘          └──────────────┘
```

## Keycloak Entities

### Realm Roles (Keycloak)

Platform-level roles assigned to users and mapped from IdP groups.

| Role | Type | Description |
|------|------|-------------|
| `admin` | Built-in | Full platform administration |
| `chat_user` | Built-in | Can use agent chat |
| `team_member` | Built-in | Base role for team-scoped access |
| `kb_admin` | Built-in | KB administration (all KBs) |
| `kb_reader:<kb-id>` | Per-resource | Read access to specific KB |
| `kb_ingestor:<kb-id>` | Per-resource | Read + ingest for specific KB |
| `kb_admin:<kb-id>` | Per-resource | Full admin for specific KB |
| `kb_reader:*` | Wildcard | Read access to all KBs |
| `kb_ingestor:*` | Wildcard | Read + ingest for all KBs |
| `agent_user:<agent-id>` | Per-resource | View + invoke specific agent |
| `agent_admin:<agent-id>` | Per-resource | Full admin for specific agent |
| `agent_user:*` | Wildcard | View + invoke all agents |
| `agent_admin:*` | Wildcard | Full admin for all agents |
| `task_user:<task-config-id>` | Per-resource | View + invoke a specific Task Builder config (`task:<id>` resource) |
| `task_admin:<task-config-id>` | Per-resource | View + invoke + configure + delete for that task config |
| `skill_user:<skill-id>` | Per-resource | View + invoke a specific Skills Gateway skill (`skill:<id>` resource) |
| `skill_admin:<skill-id>` | Per-resource | View + invoke + configure + delete for that skill |
| `offline_access` | Built-in | Refresh token support |

### Resources (Keycloak Authorization Services)

Resources registered for policy-based access control.

| Resource Type | Naming | Scopes | Created By |
|--------------|--------|--------|------------|
| `dynamic_agent` | `agent:<agent-id>` | `view`, `invoke`, `configure`, `delete` | `keycloak_sync.py` on agent create |
| `knowledge_base` | `kb:<kb-id>` | `query`, `ingest`, `admin` | Admin UI on KB create |
| `caipe:task` | `task:<task-config-id>` | `view`, `invoke`, `configure`, `delete` | Task Builder BFF on user task create |
| `caipe:skill` | `skill:<skill-id>` | `view`, `invoke`, `configure`, `delete` | Skills Gateway BFF on user skill create |

### User Attributes (Keycloak)

Custom attributes stored on user profiles.

| Attribute | Type | Description |
|-----------|------|-------------|
| `slack_user_id` | string | Slack user ID for identity linking (FR-025) |

### IdP Mappers (Keycloak)

Mappers that translate enterprise IdP groups to Keycloak roles.

| Mapper Type | Source | Target | Created By |
|-------------|--------|--------|------------|
| Identity Provider Mapper | IdP group name | Keycloak realm role | Admin UI group mapping (FR-024) |

### Client Mappers (Keycloak)

Protocol mappers on the `caipe-ui` client that add claims to tokens.

| Mapper | Claim | Content |
|--------|-------|---------|
| Group Membership | `groups` | User's groups (flat names) |
| Realm Roles | `realm_access.roles` | User's realm roles |
| Org Claim | `org` | Tenant identifier (FR-020) |

## MongoDB Entities

### Team

Collection: `teams`

```typescript
interface Team {
  _id: ObjectId;
  name: string;
  description?: string;
  keycloak_roles: string[];      // Realm roles assigned to team
  members: string[];             // Keycloak user subs
  owner_id: string;              // Keycloak sub of team owner
  created_at: Date;
  updated_at: Date;
}
```

### TeamKbOwnership

Collection: `team_kb_ownership`

```typescript
interface TeamKbOwnership {
  _id: ObjectId;
  team_id: string;               // Reference to Team._id
  kb_ids: string[];              // Knowledge base IDs owned by team
  allowed_datasource_ids: string[]; // Specific datasource restrictions
  created_at: Date;
  updated_at: Date;
}
```

### SlackChannelTeamLink

Collection: `slack_channel_team_links`

```typescript
interface SlackChannelTeamLink {
  _id: ObjectId;
  slack_channel_id: string;      // Slack channel UUID
  slack_workspace_id: string;    // Slack workspace/enterprise ID
  team_id: string;               // CAIPE team ID
  created_by: string;            // Admin who created the mapping
  created_at: Date;
  active: boolean;               // False if channel archived or team deleted
}
```

### SlackLinkNonce

Collection: `slack_link_nonces`

```typescript
interface SlackLinkNonce {
  _id: ObjectId;
  nonce: string;                 // Cryptographically random, single-use
  slack_user_id: string;         // Slack user requesting the link
  consumed: boolean;             // True after successful use
  created_at: Date;              // TTL index: expires after 10 minutes
}
```

Index: `{ created_at: 1 }, { expireAfterSeconds: 600 }` (10-minute TTL)

### SlackUserMetrics

Collection: `slack_user_metrics`

```typescript
interface SlackUserMetrics {
  _id: ObjectId;
  slack_user_id: string;
  keycloak_sub?: string;
  last_bot_interaction: Date;
  obo_exchange_success_count: number;
  obo_exchange_fail_count: number;
  active_channels: string[];     // Channel IDs where user is active
  updated_at: Date;
}
```

### DynamicAgentConfig (existing — RBAC fields highlighted)

Collection: `dynamic_agents`

```typescript
interface DynamicAgentConfig {
  _id: ObjectId;
  name: string;
  owner_id: string;              // Keycloak sub — RBAC field
  visibility: 'private' | 'team' | 'global'; // RBAC field
  shared_with_teams: string[];   // Team IDs — RBAC field
  allowed_tools: string[];
  subagents: any[];
  is_system: boolean;
  enabled: boolean;
  // ... other fields
}
```

## JWT Claims (Token Structure)

### Access Token (Keycloak-issued)

```json
{
  "sub": "user-uuid",
  "act": { "sub": "bot-service-account-uuid" },
  "scope": "openid email profile groups",
  "realm_access": {
    "roles": ["chat_user", "team_member", "kb_reader:kb-team-a", "agent_user:agent-123"]
  },
  "groups": ["eti_sre_admin", "backstage-access"],
  "org": "cisco",
  "email": "user@example.com",
  "iss": "https://keycloak.example.com/realms/caipe",
  "aud": "caipe-ui"
}
```

### OBO Token (Token Exchange result)

Same structure as access token but with `act` claim populated:
- `sub` = originating user
- `act.sub` = bot or agent service account
- `scope` = intersection of user's scope and bot's allowed scope

## State Transitions

### Slack Identity Link Lifecycle

```text
UNLINKED ──[bot sends link URL]──▶ PENDING ──[user completes OIDC]──▶ LINKED
    ▲                                  │                                  │
    │                                  │ [nonce expires/10min]            │ [KC account disabled]
    │                                  ▼                                  ▼
    │                               EXPIRED                           INVALID
    │                                                                     │
    └─────────────────────[admin re-links]────────────────────────────────┘
```

### Dynamic Agent Keycloak Resource Lifecycle

```text
[Agent created in MongoDB]
    │
    ▼
[keycloak_sync.py creates KC resource + auto-generated policies]
    │
    ▼
[ACTIVE — CEL evaluates access using KC roles + MongoDB visibility]
    │
    │ [Agent deleted from MongoDB]
    ▼
[keycloak_sync.py deletes KC resource + cleans up dangling per-agent roles]
```

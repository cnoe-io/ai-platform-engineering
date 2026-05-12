# Contract: Slack Channel ReBAC Administration and Runtime

## Scope

Slack channel access becomes many-to-many. A Slack channel can be granted access to multiple agents, tools, and knowledge bases, while users must still satisfy team/channel/resource ReBAC checks before invoking anything from Slack.

## Admin Endpoints

### `GET /api/admin/slack/channels`

Lists Slack channels visible to the caller.

**Query**

- `team`: optional CAIPE team scope.
- `search`: optional channel name search.

**Response**

```json
{
  "channels": [
    {
      "workspace_id": "T123",
      "channel_id": "C123",
      "name": "platform-support",
      "team_slugs": ["platform"],
      "status": "active"
    }
  ]
}
```

### `GET /api/admin/slack/channels/{workspace_id}/{channel_id}/resources`

Returns resources currently exposed through a Slack channel.

**Response**

```json
{
  "channel": {
    "workspace_id": "T123",
    "channel_id": "C123",
    "name": "platform-support"
  },
  "resources": [
    {
      "resource_type": "agent",
      "resource_id": "platform-engineer",
      "relationship": "allowed_agent",
      "status": "active",
      "source_type": "manual"
    },
    {
      "resource_type": "knowledge_base",
      "resource_id": "platform-runbooks",
      "relationship": "allowed_knowledge_base",
      "status": "active",
      "source_type": "policy_rule"
    }
  ]
}
```

### `POST /api/admin/slack/channels/{workspace_id}/{channel_id}/resources`

Stages or applies resource grants for a Slack channel.

**Request**

```json
{
  "mode": "stage",
  "grants": [
    {
      "resource_type": "agent",
      "resource_id": "platform-engineer",
      "relationship": "allowed_agent"
    },
    {
      "resource_type": "tool",
      "resource_id": "argocd.list_applications",
      "relationship": "allowed_tool"
    }
  ],
  "revocations": []
}
```

**Response**

```json
{
  "change_set_id": "change-set-slack-001",
  "status": "validating",
  "validation": {
    "allowed": true,
    "warnings": []
  }
}
```

### `POST /api/admin/slack/channels/{workspace_id}/{channel_id}/access-check`

Previews whether a Slack user can invoke a selected resource from a channel.

**Request**

```json
{
  "user_subject": "user-123",
  "resource_type": "agent",
  "resource_id": "platform-engineer",
  "action": "invoke"
}
```

**Response**

```json
{
  "allowed": true,
  "checks": [
    {
      "name": "channel_membership",
      "allowed": true
    },
    {
      "name": "channel_resource_grant",
      "allowed": true
    },
    {
      "name": "user_resource_access",
      "allowed": true
    }
  ]
}
```

## Runtime Contract

Slack bot runtime must perform these checks for a message or slash command:

1. Resolve Slack user to a Keycloak user subject.
2. Resolve Slack channel to `slack_channel:<workspace_id>/<channel_id>`.
3. Resolve selected agent/tool/knowledge base resource.
4. Check user access to the Slack channel.
5. Check channel access to the selected resource.
6. Check user/team access to the selected resource.
7. Deny by default with a user-safe explanation if any check fails.

### Runtime Decision Shape

```json
{
  "allowed": false,
  "decision": "deny",
  "reason_code": "channel_resource_not_granted",
  "safe_message": "This Slack channel is not authorized to use the selected agent.",
  "audit": {
    "workspace_id": "T123",
    "channel_id": "C123",
    "resource_type": "agent",
    "resource_id": "platform-engineer"
  }
}
```

## Errors

- `403`: caller cannot administer the channel or selected resource.
- `404`: channel/resource not found or hidden from caller scope.
- `409`: selected channel is archived or resource enforcement state blocks the operation.
- `422`: relationship is unsupported for the selected resource type.

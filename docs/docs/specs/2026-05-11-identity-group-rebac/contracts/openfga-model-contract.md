# Contract: OpenFGA Model Shape

## Scope

This contract documents the target relationship model that the implementation must encode in OpenFGA. Exact syntax may vary as the deploy model is evolved, but every runtime check must map to a resource, relation, subject, and action from this contract.

## Subject Types

- `user:<keycloak-subject>`
- `team:<team-slug>#member`
- `team:<team-slug>#admin`
- `external_group:<provider-id>/<group-id>#member`
- `slack_channel:<workspace-id>--<channel-id>#member`
- `service_account:<id>`
- `anonymous:*` only when explicitly intended and documented.

## Resource Types

- `organization`
- `team`
- `external_group`
- `slack_workspace`
- `slack_channel`
- `agent`
- `mcp_server`
- `tool`
- `knowledge_base`
- `document`
- `skill`
- `task`
- `conversation`
- `admin_surface`
- `policy`
- `audit_view`
- `secret_reference`
- `system_config`

## Standard Actions

| Action | Purpose |
|--------|---------|
| `discover` | Resource appears in selectors/search. |
| `read` | View resource metadata or contents. |
| `use` | Use a resource without changing it. |
| `invoke` | Invoke an agent or task-capable resource. |
| `call` | Call an MCP server/tool. |
| `write` | Update mutable resource data. |
| `create` | Create child resources in a scope. |
| `delete` | Delete or archive a resource. |
| `manage` | Manage assignments and settings. |
| `administer` | Delegate/administer policy for a resource. |
| `audit` | View audit and decision history. |
| `approve` | Approve staged policy changes. |
| `share` | Share a resource with another subject/scope. |
| `ingest` | Add documents or data to a knowledge base. |

## Relationship Families

### Team Membership

```text
team:<slug>#member <- user:<subject>
team:<slug>#admin <- user:<subject>
team:<slug>#member <- external_group:<provider>/<group>#member
team:<slug>#admin <- external_group:<provider>/<group>#member
```

### Team Resource Access

```text
agent:<id>#can_use <- team:<slug>#member
agent:<id>#can_manage <- team:<slug>#admin
tool:<id>#can_call <- team:<slug>#member
knowledge_base:<id>#can_read <- team:<slug>#member
knowledge_base:<id>#can_ingest <- team:<slug>#admin
skill:<id>#can_use <- team:<slug>#member
task:<id>#can_invoke <- team:<slug>#member
```

### Slack Channel Access

```text
slack_channel:<workspace>--<channel>#member <- user:<subject>
slack_channel:<workspace>--<channel>#admin <- team:<slug>#admin
slack_channel:<workspace>--<channel>#allowed_agent <- agent:<id>
slack_channel:<workspace>--<channel>#allowed_tool <- tool:<id>
slack_channel:<workspace>--<channel>#allowed_knowledge_base <- knowledge_base:<id>
```

Runtime checks must combine:

```text
user is channel member
channel is allowed selected resource
user/team can use selected resource
```

### Admin Surface Access

```text
admin_surface:<key>#can_read <- team:<slug>#admin
admin_surface:<key>#can_manage <- team:<slug>#admin
admin_surface:<key>#can_audit <- audit_view:<id>#viewer
```

### Policy Ownership

```text
policy:<id>#owner <- user:<subject>
policy:<id>#approver <- team:<slug>#admin
policy:<id>#can_apply <- admin_surface:rebac#can_manage
```

## Validation Rules

- Every tuple must use a known resource type and relation.
- Every action exposed in the UI must resolve to one or more model relations.
- Relationship write APIs must reject unknown types, unknown relations, and subjects outside the caller's delegated scope.
- Public/anonymous access must use an explicit resource relationship and must be visible in the graph.
- ReBAC-denied checks are final unless the runtime surface is still explicitly marked `rebac_shadowed`.

## Migration Notes

- Keycloak resource roles can temporarily generate corresponding ReBAC tuples during migration.
- CEL admin tab policies and AgentGateway MCP policies can run in shadow mode until the matching ReBAC check is verified.
- OpenFGA model changes must be deployed before tuple writers emit new relation names.

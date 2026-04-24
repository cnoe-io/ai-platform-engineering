# CAIPE RBAC Architecture (moved)

> **This document has moved.** The canonical RBAC reference now lives under
> [`docs/docs/security/rbac/`](../../security/rbac/index.md), split into four focused
> docs so you don't have to read end-to-end to find what you need.

| If you want to… | Go to |
|---|---|
| Get the big picture + JWT primer + threat model | [Security › RBAC](../../security/rbac/index.md) |
| See what each component does (Keycloak, UI, Supervisor, AgentGateway, Dynamic Agents) | [Architecture](../../security/rbac/architecture.md) |
| Trace a request — login, OBO, end-to-end Slack flow, channel routing | [Workflows](../../security/rbac/workflows.md) |
| Bring up the stack, log in as test users, run the demo, troubleshoot | [Usage](../../security/rbac/usage.md) |
| Find the file that owns a piece of the auth path | [File map](../../security/rbac/file-map.md) |

## Important Runtime Note

AgentGateway's current CEL runtime in this repo has a real limitation with JWT-backed role arrays:

- `has(jwt.sub)` / `has(jwt.realm_access.roles)` can return `false` even when the field exists
- `"role" in jwt.realm_access.roles` does not behave like normal CEL membership here
- `jwt.realm_access.roles.exists(...)` can panic the gateway

The production-safe pattern is direct field access plus `.contains(...)`, for example:

```cel
jwt.realm_access.roles.contains("admin_user")
jwt.realm_access.roles.contains("team_member:" + jwt.active_team)
```

That constraint is documented in the live architecture docs and reflected in
`deploy/agentgateway/config.yaml`.

The old single-file version of this document is preserved in git history at the commit
prior to the split (search the commit log for `docs(security): split how-rbac-works.md`).

# Dynamic Agents API — reference notes

Deeper mechanics for `/api/dynamic-agents` beyond the basics in `AGENTS.md`. Source: `ui/src/app/api/dynamic-agents/**`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/dynamic-agents?search=<keyword>` | Search/list agents (matches name/description/etc.) |
| `POST` | `/api/dynamic-agents` | Create a new agent |
| `PUT` | `/api/dynamic-agents?id=<agent_id>` | Update an existing agent (id as query param, NOT a path segment) |
| `DELETE` | `/api/dynamic-agents?id=<agent_id>` | Delete an agent |
| `GET` | `/api/dynamic-agents/teams` | List teams available to the caller as an "owner team" (used by the agent editor's owner-team picker) |

## Creating an agent (`POST /api/dynamic-agents`)

- **`_id` is server-generated**, not client-supplied: `agent-<slugify(name)>`. Any `_id`/`id` in the body is ignored. To land on a specific id, set `name` such that it slugifies to the desired suffix (e.g. `name: "Framework-run oncall agent"` → `_id: "agent-framework-run-oncall-agent"`).
- **Required fields:** `name`, `system_prompt`, `model.id` + `model.provider` (legacy `model_id`/`model_provider` are auto-migrated).
- **Required conditionally:** `owner_team_slug` (or `owner_team_id`) is required unless `visibility: "global"`. Default `visibility` is `"team"` if unspecified; legacy `"private"` is coerced to `"team"`.
- **Optional/defaulted:** `description` (`""`), `allowed_tools` (`{}`), `subagents`/`skills` (`[]`), `enabled` (`true`), `builtin_tools`, `ui`, `features`, `interrupt_on`, `shared_with_teams`, `datasource_ids`/`rag_collection_ids` (capped 200/50, validated).
- **Server-controlled — cannot be set from the request body:** `owner_id` (session user email), `owner_subject` (session `sub`), `is_system`, `config_driven`, `created_at`/`updated_at`. This means copying an agent between environments (e.g. dev → prod) always re-attaches ownership to whoever makes the POST call, not the original owner.

### Owner-team membership gotcha

`GET /api/dynamic-agents/teams` reports `user_role: "admin"` and `can_own_agents: true` for **every** team when the caller is an org-wide admin — this does **not** mean the caller is an actual member of that team's underlying identity-provider group. The create endpoint's real check (`canUseOwnerTeam`) validates true group membership, so:

- Setting `owner_team_slug` to a team you're an org admin over (but not an IdP member of) fails with `403 OWNER_TEAM_FORBIDDEN`.
- Use a team you're genuinely a member of (check your own IdP groups), or have a real member of the target team create/transfer the agent.

### Other validation

- **Global visibility:** requires `organization`/`manage` permission, else `403 GLOBAL_AGENT_FORBIDDEN`.
- **Owner team must exist:** `404 OWNER_TEAM_NOT_FOUND` if the slug doesn't resolve to a team.
- **Reserved/uniqueness:** slug must not collide with `RESERVED_AGENT_SLUGS`, can't start with `__`, and must not already exist (`409`).
- **Subagents:** global agents can only reference global subagents; team agents can reference team/global subagents.

## Copying an agent between environments (e.g. dev → prod)

1. `GET /api/dynamic-agents?search=<name-or-id-fragment>` in the source env to get the full agent doc.
2. Strip server-controlled fields (`_id`, `owner_id`, `owner_subject`, `is_system`, `config_driven`, `created_at`, `updated_at`, `permissions`) and any env-specific IDs (`owner_team_id` — resolve by slug instead, since Mongo `_id`s differ per environment).
3. Check `GET /api/dynamic-agents/teams` in the **target** env for a team slug you're a real member of (see gotcha above) and set it as `owner_team_slug`.
4. `POST /api/dynamic-agents` in the target env with the remaining fields. The new `_id` will be `agent-<slugify(name)>` — same as source if `name` is unchanged.
5. Always confirm the payload with the user before the `POST` — this is a write action against prod/dev and is never done silently (see `AGENTS.md`).

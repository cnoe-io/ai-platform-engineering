# Active-team Token-scoped RBAC — Design

**Status:** Proposed
**Owner:** Platform Eng
**Spec:** [104 — Team-scoped RBAC](./spec.md)
**Last updated:** 2026-04-22

## Why this exists

Today, the RBAC stack has all the right ingredients but assembles them
inconsistently:

- The Slack bot mints a user-scoped token (RFC 8693 token-exchange / Keycloak
  impersonation) — good.
- It then drops that token somewhere between the bot, the BFF, and
  `dynamic-agents`. Live evidence: AgentGateway logs show `jwt.sub =
  service-account-caipe-slack-bot` even though the bot logs say
  `OBO impersonation succeeded`.
- "Team scope" is half-implemented: the bot resolves a CAIPE `team_id` from
  `channel_team_mappings`, but only the RAG path forwards it (as `X-Team-Id`).
  The chat path drops it entirely.
- `X-Team-Id` is an unsigned out-of-band header — easy to forge, easy to drop,
  invisible in audit logs that only capture the JWT.

This design replaces the ad-hoc header with a signed JWT claim called
`active_team` that rides end-to-end inside the user's access token.

---

## What `active_team` is

`active_team` is a **custom claim** in the user's signed access token. It tells
every downstream service which one of the user's teams the current request is
acting on behalf of.

### Example token (decoded)

```json
{
  "sub": "user-uuid-of-srady",
  "preferred_username": "sraradhy",
  "realm_access": {
    "roles": [
      "chat_user",
      "team_member",
      "team_member:team-platform-eng",
      "team_member:team-sre",
      "tool_user:jira_search_issues"
    ]
  },
  "active_team": "team-platform-eng",
  "aud": "agentgateway",
  "iss": "http://keycloak:7080/realms/caipe",
  "exp": 1776999000
}
```

### Why a signed claim instead of `X-Team-Id`

| Property | `X-Team-Id` (header) | `active_team` (claim) |
|---|---|---|
| Tampering | Forgeable by anything in the request chain | Signed by Keycloak; AGW verifies the signature |
| Audit trail | Lost between hops; needs separate log correlation | One token reveals `sub` + `active_team` + `aud` together |
| Cross-service plumbing | Must be re-added at every hop (BFF, DA, AGW) — easy to drop, which is exactly today's bug | Forwarded automatically with `Authorization: Bearer` |
| Replay/anomaly detection | Custom logic | Same JWT lifetime + revocation rules as identity |
| AGW CEL evaluation | `request.headers["x-team-id"]` (untrusted) | `jwt.active_team` (trusted) |
| Membership safety | Bot must remember to enforce "user ∈ team" before sending | Bot enforces at mint; AGW re-verifies via CEL |

### Special values

| `active_team` value | Meaning |
|---|---|
| `"<team-id>"` | Request is acting on behalf of a specific CAIPE team. AGW enforces user is in that team. |
| `"__personal__"` | Personal mode (Slack DM, web UI for users with no teams). No team-scoped tools allowed; only `tool_user:*`, `tool_user:<name>`, `admin_user`, `chat_user` rules apply. |
| (claim absent) | Treated identically to `__personal__` for back-compat during rollout, but emits a warning log. Should not occur post-rollout. |

---

## Locked design decisions

These were chosen before writing any code:

| Decision | Choice | Rationale |
|---|---|---|
| Where `active_team` is set | **Per-team Keycloak client scope** containing a hardcoded-claim mapper; bot requests `scope=team-<id>` at token-exchange | Confirmed working in spike (Experiment D, see below). Per-token (not per-user), stateless, no race conditions, no per-request user mutation |
| Membership enforcement | **Both bot AND AGW** check that user is in `active_team` (defense-in-depth) | A buggy or compromised bot can't grant access to a team the user isn't in |
| Channel without a team | **Reject in Slack** with "ask your admin" message | Group channels are always team-scoped |
| DM (`im`) | Mint with `active_team="__personal__"` | Users can still chat 1:1 with the bot using their personal tool scopes |
| Web UI | Auto-pick the user's first/only team (or `__personal__` if none) | Avoids extra UI work; team picker is a follow-up |
| Rollout | **Big-bang** — replace AGW CEL atomically; no feature flag | One source of truth; less risk of half-migrated drift |
| `X-Team-Id` | **Removed everywhere** (chat + RAG + UI) | One mechanism, not two |

---

## Sequence diagrams

> **Reading guide.** The Keycloak boxes show what's pre-configured (left of
> the colon) and what fires per request (right of the colon). The team
> client scope is created once per team in the lifecycle diagram below;
> here we show how it gets _used_.

### Diagram 0: Team lifecycle (one-time setup per team)

This happens **once when a team is created**, not on every chat message.

```mermaid
sequenceDiagram
    autonumber
    participant Admin as CAIPE Admin<br/>(Web UI)
    participant BFF as caipe-ui BFF<br/>(/api/admin/teams)
    participant Mongo as MongoDB<br/>(teams)
    participant KC as Keycloak Admin API

    Admin->>BFF: POST /api/admin/teams<br/>body — id=platform-eng name="Platform Eng"
    BFF->>Mongo: insert team doc
    BFF->>KC: POST /admin/realms/caipe/client-scopes<br/>name=team-platform-eng<br/>protocol=openid-connect<br/>attribute include.in.token.scope=false
    KC-->>BFF: 201 Created (scope_id)
    BFF->>KC: POST /client-scopes/SCOPE_ID/protocol-mappers/models<br/>protocolMapper=oidc-hardcoded-claim-mapper<br/>claim.name=active_team<br/>claim.value=platform-eng<br/>access.token.claim=true
    KC-->>BFF: 201 Created
    BFF->>KC: PUT /clients/CAIPE_SLACK_BOT/optional-client-scopes/SCOPE_ID
    KC-->>BFF: 204 No Content
    BFF-->>Admin: 201 Created (team usable immediately)

    Note over BFF,KC: Symmetric DELETE on team-delete — unbind scope then delete scope. Also done by init-token-exchange.sh for the special team-personal scope.
```

### Diagram 1: Happy path — Slack channel mapped to a team

The full message-time flow. The blue box is where `active_team` enters
the JWT.

```mermaid
sequenceDiagram
    autonumber
    participant U as User<br/>(Slack)
    participant SB as Slack Bot
    participant CTM as channel_team_mapper<br/>(MongoDB)
    participant KC as Keycloak<br/>(caipe-slack-bot client)
    participant BFF as caipe-ui BFF<br/>(da-proxy)
    participant DA as dynamic-agents<br/>(JwtAuthMiddleware<br/>+ mcp_client)
    participant AGW as AgentGateway<br/>(CEL policy)
    participant MCP as MCP server<br/>(e.g. mcp-jira)

    Note over U,MCP: STEP 1 — bot resolves identity and team
    U->>SB: mention bot — "list jira issues"<br/>channel=C123 slack_user=Uxxx
    SB->>SB: JIT link lookup — slack_user maps to keycloak_user_id
    SB->>CTM: resolve_team for channel C123
    CTM-->>SB: team_id = platform-eng
    SB->>SB: Membership check — team_member:platform-eng in user.realm_access.roles? TRUE

    Note over U,MCP: STEP 2 — token-exchange with team scope
    rect rgb(230, 245, 255)
        Note over SB,KC: This is the only place active_team gets injected.<br/>The hardcoded mapper inside scope team-platform-eng<br/>only fires because we requested that scope.
        SB->>KC: POST /realms/caipe/protocol/openid-connect/token<br/>grant_type=token-exchange<br/>client_id=caipe-slack-bot<br/>client_secret=•••<br/>requested_subject=KEYCLOAK_USER_ID<br/>scope=openid team-platform-eng (key bit)
        KC->>KC: 1) verify client + impersonation perm<br/>2) load user roles<br/>3) evaluate optional scopes matching request<br/>4) team-platform-eng scope hardcoded-claim<br/>   mapper fires → active_team=platform-eng
        KC-->>SB: access_token (RS256 JWT, 5min TTL)<br/>sub=USER_ID<br/>azp=caipe-slack-bot<br/>realm_access.roles=chat_user, team_member, team_member:platform-eng, tool_user:jira_search<br/>active_team=platform-eng
    end

    Note over U,MCP: STEP 3 — call the chat stream
    SB->>SB: set_obo_token(access_token)<br/>(ContextVar for this request)
    SB->>BFF: POST /api/v1/chat/stream/start<br/>Authorization Bearer USER_JWT
    BFF->>BFF: authenticateRequest — uses Bearer as-is (no swap)
    BFF->>DA: POST /api/v1/chat/stream/start<br/>Authorization Bearer USER_JWT

    Note over U,MCP: STEP 4 — DA validates and relays the same token to AGW
    DA->>DA: JwtAuthMiddleware — verify iss + sig + aud + exp<br/>current_user_token.set(jwt)
    DA->>DA: agent_runtime resolves MCP servers for this agent

    rect rgb(245, 240, 255)
        Note over DA,AGW: Outbound MCP calls automatically carry the user JWT (httpx client factory reads from ContextVar). No SA fallback.
        DA->>AGW: POST /mcp/jira initialize<br/>Authorization Bearer USER_JWT
        AGW->>AGW: Validate JWT and parse claims
        AGW->>AGW: CEL — active_team is platform-eng AND team_member:platform-eng is in roles → TRUE
        AGW->>MCP: initialize
        MCP-->>AGW: ok
        AGW-->>DA: ok

        DA->>AGW: POST /mcp/jira tools/list
        AGW->>AGW: per-tool CEL — tool_user:STAR in roles OR tool_user:TOOLNAME in roles OR admin_user in roles
        AGW->>MCP: tools/list
        MCP-->>AGW: jira_search_issues, jira_get_issue, ...
        AGW-->>DA: 200 OK with filtered tool list
    end

    DA->>DA: log "Connected to jira — N tools — sub=USER_ID active_team=platform-eng"
    DA-->>BFF: SSE stream (agent execution)
    BFF-->>SB: SSE stream
    SB-->>U: Slack reply with Jira data
```

### Diagram 2: DM / personal mode

The bot uses a special `team-personal` scope that hardcodes the marker
value. CEL recognizes the marker and skips team-membership checks.

```mermaid
sequenceDiagram
    autonumber
    participant U as User (Slack DM)
    participant SB as Slack Bot
    participant KC as Keycloak (team-personal scope hardcodes active_team=__personal__)
    participant BFF as caipe-ui BFF
    participant DA as dynamic-agents
    participant AGW as AgentGateway (CEL)
    participant MCP as MCP server

    U->>SB: DM — "list my pull requests"
    SB->>SB: channel.type is im — skip channel_team_mapper

    rect rgb(255, 245, 230)
        Note over SB,KC: Same token-exchange shape as happy path — just a different scope name.
        SB->>KC: POST /token<br/>grant_type=token-exchange<br/>requested_subject=USER_ID<br/>scope=openid team-personal (marker scope)
        KC-->>SB: access_token<br/>sub=USER_ID<br/>active_team=__personal__<br/>realm_access.roles=chat_user, tool_user:STAR
    end

    SB->>BFF: POST /chat/stream/start + Bearer
    BFF->>DA: forward Bearer
    DA->>AGW: MCP request to a server + Bearer
    AGW->>AGW: CEL personal branch — active_team is __personal__ → skip team_member check → allow if tool_user matches OR admin_user
    AGW->>MCP: forward allowed calls
    AGW-->>DA: filtered tools
    DA-->>U: response
```

### Diagram 3: Rejection paths

What happens when something is wrong. **Most rejections happen in the bot,
before any token gets minted** — Path C is only triggered if the bot's
state is stale.

```mermaid
sequenceDiagram
    autonumber
    participant U as User (Slack)
    participant SB as Slack Bot
    participant CTM as channel_team_mapper
    participant KC as Keycloak
    participant AGW as AgentGateway

    rect rgb(255, 235, 235)
        Note over U,AGW: PATH A — channel is not assigned to any team
        U->>SB: mention bot in random channel
        SB->>CTM: resolve_team for that channel
        CTM-->>SB: None
        SB-->>U: ❌ This channel has not been assigned to a team. Ask your admin.
        Note right of SB: STOPS HERE. No KC call. No DA call.
    end

    rect rgb(255, 235, 235)
        Note over U,AGW: PATH B — channel mapped but user not in that team
        U->>SB: mention bot in sre channel (user is only in platform-eng)
        SB->>CTM: resolve_team for that channel
        CTM-->>SB: team_id = sre
        SB->>SB: realm role team_member:sre present in user.roles? FALSE
        SB-->>U: ❌ You are not a member of the team that owns this channel.
        Note right of SB: STOPS HERE. No KC call. No DA call.
    end

    rect rgb(255, 245, 220)
        Note over U,AGW: PATH C — bot check passed but it should not have (stale cache or compromised bot). AGW catches it.
        SB->>KC: token-exchange with scope team-sre
        Note over KC: KC issues the token. It does not know which teams the bot SHOULD have allowed — that is the bot job.
        KC-->>SB: JWT with active_team = sre
        SB->>AGW: MCP request to jira + Bearer token
        AGW->>AGW: CEL — is team_member colon active_team in user.roles? FALSE (user lacks team_member:sre)
        AGW-->>SB: 403 Forbidden — error team_membership_failed for active_team sre
        SB-->>U: ❌ Access denied (server-side check failed). Contact your admin.
    end

    rect rgb(255, 235, 235)
        Note over U,AGW: PATH D — admin forgot to create the scope for a new team (team CRUD out of sync with KC)
        U->>SB: mention bot in team-newproject channel
        SB->>CTM: resolve_team for that channel
        CTM-->>SB: team_id = newproject
        SB->>KC: token-exchange with scope team-newproject
        Note over KC: Scope does not exist — KC silently ignores it
        KC-->>SB: JWT WITHOUT active_team claim
        SB->>SB: sanity check — active_team missing — refuse to proceed
        SB-->>U: ❌ Team configuration error. Ask your admin to re-sync teams.
    end
```

---

## File-by-file change summary

| File | Change |
|---|---|
| `charts/ai-platform-engineering/charts/keycloak/scripts/init-token-exchange.sh` | Add a "User Session Note" protocol mapper on `caipe-slack-bot` client: maps session note `active_team` → token claim `active_team` |
| `ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py` | `impersonate_user(user_id, *, active_team, audience="agentgateway")` — sends session note via token-exchange. **Delete** `downstream_auth_headers()` X-Team-Id branch. |
| `ai_platform_engineering/integrations/slack_bot/app.py` (`_rbac_enrich_context`) | Resolve channel→team, verify membership, choose `__personal__` for DMs, reject for unmapped group channels, then mint token with the right `active_team` |
| `ai_platform_engineering/integrations/slack_bot/sse_client.py` | No change (already forwards Bearer). Drop any place that ever set `X-Team-Id` (none in chat path; sanity check). |
| `ui/src/lib/da-proxy.ts` | No change. Already forwards Bearer as-is. Verify no X-Team-Id forwarding code exists. |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/jwt_middleware.py` | Accept tokens with `aud=agentgateway` (in addition to its current expected audience). Log `sub=`, `active_team=`, `aud=` on success. |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mcp_client.py` | Add log line in `_factory`: `AGW outbound: sub=<sub> active_team=<at> server=<server_id>`. Confirm no SA-fallback path exists. |
| `deploy/agentgateway/config.yaml` | Rewrite CEL: replace bare `"team_member" in roles` checks with `jwt.realm_access.roles.contains("team_member:" + jwt.active_team)`; add explicit `__personal__` branch; keep `tool_user:*`/`admin_user` short-circuits. Avoid AGW 0.12 CEL forms `has(...)`, `in`, and `.exists(...)` against JWT role arrays because the live playground shows they either return false or panic the gateway. |
| `ai_platform_engineering/knowledge_bases/rag/server/src/server/{rbac.py,restapi.py}` | Remove `X-Team-Id` reads; replace with `jwt.active_team` claim. |
| `ui/src/app/api/rag/[...path]/route.ts`, `ui/src/app/api/rag/kb/[...path]/route.ts` | Remove `X-Team-Id` forwarding. |
| `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md`, `docs/docs/security/rbac/*.md` | Document the new flow + sequence diagrams |
| Tests across `slack_bot/tests/`, `dynamic_agents/tests/`, `ui/src/**/__tests__/` | Update any test that asserts on `X-Team-Id`; add tests for `active_team` end-to-end |

---

## Spike results (Keycloak 26.3.5, run 2026-04-22)

We ran four experiments against the live `keycloak` container in the dev
docker-compose stack to determine which Keycloak mechanism can carry
`active_team` into a token-exchanged JWT.

### Setup

- Keycloak 26.3.5, realm `caipe`, client `caipe-slack-bot`, RFC 8693
  token-exchange + impersonation already configured by the existing
  `init-token-exchange.sh` script.
- Test user: `admin@example.com` (Keycloak `sub` =
  `dc5460b8-1a56-4b58-a5e0-b163b110aded`).
- All token-exchange calls used the bot's `client_id` + `client_secret`
  with `requested_subject=<test-user-id>`.

### Results

| # | Approach | Outcome | Notes |
|---|---|---|---|
| **A** | "User Session Note" mapper, set the note via `session_note:active_team=...` request parameter | ❌ Fails | Mapper installs cleanly (HTTP 201). Token mints. **`active_team` claim does not appear.** Pure token-exchange does not pass request params into the user session model — session notes are only populated during interactive flows or via the SPI. |
| **B** | "User Model Attribute" mapper + bot mutates user attribute via Admin API right before mint | ✅ Works | Token contains `"active_team": "team-platform-eng"`. **Reliable but racy** — concurrent requests for the same user with different teams would interfere unless we serialize on `user_id`. Adds two extra Admin API round-trips per request. |
| **C** | "Claims Parameter Token" mapper + OIDC `claims=…` request parameter | ❌ Fails | Mapper marshals only claims that already have a source (user attributes, roles). It cannot accept arbitrary values from the request. |
| **D** | One client scope per team named `team-<id>`, each containing an `oidc-hardcoded-claim-mapper` that hardcodes `active_team=<id>`; bot requests `scope=team-<id>` at mint time | ✅ **Works cleanly** | Token contains `"active_team": "team-platform-eng"` only when the matching scope is requested. With `include.in.token.scope=false` the team name does NOT leak into the `scope` claim. Stateless; no per-request mutation; no concurrency hazard. |

### Edge cases verified for Approach D

| Edge | Result |
|---|---|
| Bot requests a scope that doesn't exist (`scope=team-nonexistent`) | KC silently ignores it, token mints with no `active_team` claim. **Bot must ensure scope exists before requesting it** (one-time admin call when a team is created). |
| Bot requests no team scope at all | Token mints with no `active_team` claim. CEL can either treat absence as `__personal__`, OR we pre-create a `team-personal` scope with a hardcoded `active_team="__personal__"` mapper. **Recommended: pre-create the explicit scope** for auditability. |
| Same scope requested twice | Idempotent (mapper fires once). |
| Bot requests two team scopes (`scope=team-A team-B`) | Both mappers fire; the resulting `active_team` claim becomes the value of whichever mapper Keycloak evaluates last (undefined). **Bot MUST request exactly one team scope per token-exchange.** |

### Decision

Adopt **Approach D (per-team client scope with hardcoded-claim mapper)** for production.

**Why D over B (user-attribute):**
- D is stateless (no DB writes per request).
- D has zero concurrency hazards.
- D requires only an admin API call when teams are *created*, not on
  every chat message.
- B's two extra round-trips on every Slack message (set attr → mint →
  revert attr) double the Keycloak load and create a window where a
  parallel request would see the wrong attribute.

**Cost of D:** the team-management code path (where teams are created and
deleted in the admin UI) must also create/delete the matching client
scope. This is a small extension to existing CRUD; we can either:

- Embed the call in the BFF team-create endpoint (simpler), or
- Add a Keycloak-sync background job that reconciles teams ↔ scopes
  (more robust to drift; recommended for production).

### Updated implementation plan (delta from original)

| File | Original plan | Revised plan |
|---|---|---|
| `init-token-exchange.sh` | Add User Session Note mapper on `caipe-slack-bot` client | (no change to bot client) Add idempotent block that ensures a `team-personal` client scope exists with a hardcoded mapper `active_team="__personal__"`, and assigns it as an optional scope on the bot client. |
| BFF/admin team CRUD (`ui/src/app/api/admin/teams/route.ts`) | (n/a) | On team create: call KC Admin API to create client scope `team-<id>` with hardcoded-claim mapper `active_team=<id>` and assign as optional scope on `caipe-slack-bot`. On team delete: remove scope. |
| `slack_bot/utils/obo_exchange.py` `impersonate_user(...)` | Add `active_team` arg → session note | Add `active_team` arg → adds `scope=team-<active_team>` (or `team-personal` for `__personal__`) to the form-encoded body. Validation: must be exactly one team scope per call. |
| Everything else | unchanged | unchanged |

### Audience handling

The Slack-bot mint uses `aud=agentgateway`. `dynamic-agents`'
`JwtAuthMiddleware` currently expects its own audience. Two options:

- Have DA accept multiple audiences (`["dynamic-agents", "agentgateway"]`).
- Have the bot mint a token with `aud=["dynamic-agents", "agentgateway"]`
  (Keycloak supports multi-aud).

Both are fine; the second is cleaner long-term.

### Web UI rollout

The first-team auto-pick decision means UI sessions need to learn the user's
teams at sign-in and inject `active_team` into the BFF request. Two viable
implementations:

- BFF reads `session.user.teams[0]` and re-mints a Keycloak impersonation
  token per request (matches the Slack flow exactly).
- NextAuth refreshes the token at sign-in with `active_team` embedded.

Pick whichever lines up with how the BFF currently obtains the access token.

### Dropping `X-Team-Id` from the RAG path

The RAG team headers were a working contract. Removing them is a behavioural
change for any client (including curl scripts and tests) that calls RAG
directly. Inventory all callers before deleting the read-side; clients then
get migrated in lockstep with the AGW CEL change.

---

## Acceptance criteria

The change is done when **all** of these are true:

1. AgentGateway logs for a Slack-originated tool call show
   `jwt.sub=<user-uuid>` (not the slack-bot service account).
2. AgentGateway access logs include `active_team` in the structured fields
   (either parsed from the JWT or echoed in CEL audit).
3. `dynamic-agents` log line on tool load reads
   `Connected to 'jira': N tools (sub=<user>, active_team=<team-id>)` with
   `N > 0` for users in the team.
4. A test user added to `team-platform-eng` only, posting in `#team-sre`,
   gets the rejection message from Path B above and **no** AGW request is
   made.
5. A DM to the bot mints a token with `active_team="__personal__"` and the
   user can use any non-team-scoped tool they're entitled to.
6. `grep -r "X-Team-Id" .` returns zero hits in production paths
   (test fixtures and spec docs may still reference it for historical
   context).
7. AGW CEL contains no bare `"team_member" in roles` checks; every
   team-scoped rule uses `jwt.active_team`.

---

## Related

- [Spec 104 — Team-scoped RBAC](./spec.md)
- [Spec 098 — Enterprise RBAC + Slack UI](../098-enterprise-rbac-slack-ui/spec.md)
- [Spec 102 — Comprehensive RBAC tests and completion](../102-comprehensive-rbac-tests-and-completion/spec.md)
- [How RBAC works (canonical reference)](../098-enterprise-rbac-slack-ui/how-rbac-works.md)
- [AgentGateway CEL config](/Users/sraradhy/outshift/caipe/ai-platform-engineering-feat-comprehensive-rbac/deploy/agentgateway/config.yaml)

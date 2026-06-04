# Feature Specification: Channel-Derived Team Binding + Personal DM Experience

**Feature Branch**: `main` (working directly on `main` per maintainer instruction)
**Created**: 2026-05-24
**Status**: Draft — awaiting review
**Supersedes**: `docs/docs/specs/2026-05-24-personal-dm-experience/spec.md` — its content has been merged into this spec. The standalone DM spec should be archived once this one is approved.
**Input**: User description (paraphrased from session):
> *"Remove the Keycloak-stamped `active_team` JWT claim. Derive the user's team at the consumer from the same MongoDB data the producer already reads. Make DMs, Webex 1:1 spaces, and the Web UI use the same team-union authorization shape. Give DM users a real, agentic, permission-aware experience: pick their own default agent, list what they can use, and override per thread. Make the whole stack explainable in six sentences."*

## One-sentence summary

Stop encoding the user's team in the OBO JWT; derive it at every consumer from MongoDB (the source of truth that already exists); use the same authorization gate for Slack channels, Slack DMs, Webex spaces, Webex 1:1 spaces, and Web UI chat; and use the freed-up DM surface to let users pick their own preferred agent and steer per thread.

## Problem Context

There are two interlocking problems and they share a single fix.

### Problem 1 — `active_team` in the JWT is the wrong layer for team binding

Today, the user's team affiliation is encoded twice for Slack/Webex bot interactions:

1. **In MongoDB** — `channel_team_mappings[channel_id] → team_slug` (Slack) and `space_team_mappings[space_id] → team_slug` (Webex). Source of truth.
2. **In the Keycloak OBO JWT** — a `team-<slug>` client scope binds an `active_team` protocol mapper to `caipe-platform`; during RFC 8693 token exchange the mapper stamps `active_team=<slug>` into the issued token.

The bot reads the Mongo row, then asks Keycloak to round-trip it back via a JWT claim. The RAG server reads the claim, then does a Mongo lookup keyed off `team_id` to find KB ownership. The actors on the path all have MongoDB access — the JWT round-trip adds no information, only fragility.

The fragility this creates:

- Per-team Keycloak client scopes provisioned at admin time (`ensureTeamClientScope`).
- An audience-default reconciler (`selectAgentGatewayActiveTeamScope`) to keep singularity.
- `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` env var so the reconciler knows which team to pin.
- A cardinality invariant + heal button to detect/repair drift (`audience.<client>.single_team_default`).
- A `team-personal` scope and `__personal__` sentinel for DMs that **structurally cannot be bound as default** on the same audience (the slot is taken), so DMs intermittently fail with "team session unavailable."
- A mismatch check in the bot's `obo_exchange.py` that rejects tokens where the returned `active_team` differs from what was requested.
- An advisory invariant acknowledging DMs are broken.
- ~10 Keycloak invariant rows in the Admin UI, with tooltips that have to explain RFC 8693 default-scope semantics to operators.

The Web UI surface today doesn't use `active_team` at all — `requireAgentUsePermission` only probes `user:<sub> can_use agent:<id>`. A user with team-mediated access but no direct grants is denied in the Web UI even though they can use the same agents from Slack channels. That's an existing inconsistency this spec resolves.

### Problem 2 — DMs are an inert, deployment-default-only surface

Even if Problem 1 didn't exist, today's DM experience is weak:

- DMs bypass channel ReBAC (no channel-team mapping exists for a DM).
- Every user is routed to a single agent picked by `SLACK_INTEGRATION_DM_AGENT_ID` (or the Webex equivalent). A user with access to ten agents still gets the one the operator chose at deploy time.
- The user cannot personalize ("the GitHub agent is my default in DMs").
- The user cannot steer ("for this question I want the Splunk agent, not my default").
- The user cannot discover ("what can I even talk to in here?") without leaving the chat.

### Why one spec instead of two

The two problems share infrastructure:
- Both need the BFF PDP to accept `user_subject=user:<sub>` and resolve "which agents/teams is this user allowed to use" by walking OpenFGA.
- Both make DMs go from "structurally broken" (current state) to "first-class agentic surface."
- Both touch the same code paths in the bots (`obo_exchange.py`, `_rbac_enrich_context`, the DM short-circuit).

Shipping them together means the operator and user both get a coherent jump rather than two confusing interim states ("DMs work now but you can't pick an agent" → "now you can pick an agent but you have to set `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG`").

## Goal

Make the team the responsibility of the data layer (MongoDB + OpenFGA), not the identity token. Keycloak issues an OBO token that proves who is acting and for whom — nothing more. Every consumer that needs the team derives it from the request's channel context (or, where no channel exists, from the user's team memberships in OpenFGA). DMs and the Web UI become first-class surfaces with per-user agent selection, in-DM discovery, and per-thread override, all backed by the same authorization gate as channels.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Slack channel message (Priority: P1)

A user types a message in a Slack channel mapped to team `platform`. They are a member of `platform`. The team has `team:platform#member can_use agent:incident-responder`. They expect the bot to respond.

**Why this priority**: This is the dominant Slack flow and must keep working without operator intervention. It is also the easiest scenario to verify regression-free behavior.

**Independent Test**: Run the existing Slack integration tests against the new code path. With no `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` env var and no `team-platform` Keycloak scope, the bot must still allow the user to talk to the agent.

**Acceptance Scenarios**:

1. **Given** a Slack channel mapped to team `platform`, a user who is a member of `platform`, and an OpenFGA tuple `team:platform#member can_use agent:incident-responder`, **When** the user posts a message routed to that agent, **Then** the bot calls the BFF PDP with `user_subject=team:platform#member`, the PDP returns allow, the bot forwards an OBO token with no `active_team` claim, and the agent responds.
2. **Given** the same setup but the OpenFGA tuple is missing, **When** the user posts a message, **Then** the bot replies with a "your team does not have access to this agent" message and does not forward to Dynamic Agents.
3. **Given** a Slack channel with no Mongo mapping, **When** any user posts a message, **Then** the bot replies "this channel isn't assigned to a CAIPE team yet" and does not forward.

---

### User Story 2 — Slack DM: personalized, agentic, permission-aware (Priority: P1)

A user opens a DM with the bot. They are a member of multiple teams with access to multiple agents. They expect:
- The bot uses their **saved DM default agent** if they've set one (and they still have permission).
- If they haven't set a preference, the bot falls back to the **deployment default DM agent** (existing behavior).
- They can list, in-DM, **what agents they can use** (`/list` or equivalent).
- They can **steer per thread** to a specific agent (`/use <agent>` or equivalent), with the override scoped to that thread only.
- Authorization always re-validates: a saved preference does not bypass `can_use` checks.

**Why this priority**: DMs are broken today (structural Keycloak limitation) AND are deployment-default-only. This story is the load-bearing fix for both problems simultaneously.

**Independent Test**: Send the bot a DM. With no Keycloak `team-personal` scope, no `__personal__` sentinel, and the user having set Agent X as their DM default (in Web UI Settings), the next DM message must route to Agent X. Sending `/use AgentY` then a follow-up message must route the follow-up to AgentY. After the thread ends or expires, the next conversation must revert to Agent X.

**Acceptance Scenarios** (consolidating Problem 1 + Problem 2):

#### Authorization (Problem 1 — the gate works without `active_team`)

1. **Given** a Slack DM with no entry in `channel_team_mappings`, a user who is a member of `team:platform`, and `team:platform#member can_use agent:X`, **When** the user DMs the bot, **Then** the bot calls the BFF PDP with `user_subject=user:<sub>`, the PDP resolves the user's team memberships via OpenFGA `list_objects`, finds `team:platform`, probes `team:platform#member can_use agent:X` (allow), and returns allow.
2. **Given** the same setup but the user is removed from `team:platform`, **When** the user DMs the bot, **Then** the PDP iterates the user's teams (now empty), no direct grant exists, and returns deny. The bot replies that the user has no agents they can use.
3. **Given** an admin has additionally granted `user:<sub> can_use agent:Y` directly (in addition to team grants), **When** the user DMs the bot to use agent Y, **Then** the PDP short-circuits on the direct grant path and allows without iterating team union.

#### Agent selection (Problem 2 — DMs are first-class)

4. **Given** a user who has not set a DM default, **When** they DM the bot, **Then** the bot dispatches to the deployment-configured `dm_agent_id` (falling back to `default_agent_id`), runs the authorization check from scenarios 1-3 against that agent, and dispatches if allowed.
5. **Given** a user who has saved Agent X as their DM default via Web UI Settings, **When** they DM the bot, **Then** the bot resolves X as the target agent, runs the authorization check from scenarios 1-3 against X, and dispatches if allowed.
6. **Given** a user whose saved DM default is Agent X but whose `can_use` permission on X has been revoked, **When** they DM the bot, **Then** the bot falls through to the deployment default DM agent, emits one ephemeral notice explaining the fallback, and dispatches to the deployment default if allowed.
7. **Given** a user who issues `/list` in a DM, **When** the command runs, **Then** the bot returns (ephemerally) the list of agents that user has `can_use` on (direct grants OR any team grants), with human-readable names and short descriptions, paginated if >25.
8. **Given** a user who issues `/use AgentZ` in a DM, **When** they then send a follow-up message in the same thread, **Then** the follow-up is dispatched to AgentZ. Subsequent messages in the same thread continue to AgentZ until the user explicitly changes the agent (via `/use <other>` or `/use default`) or the bot restarts.
9. **Given** a user who issues `/use AgentW` and does not have `can_use` on AgentW, **When** the override command runs, **Then** the bot refuses with a clear message ("you don't have access to AgentW"), the user's existing default is preserved, no override is stored.
10. **Given** a user who issues `/help` in a DM, **When** the command runs, **Then** the bot returns (ephemerally) help text describing the three commands and their semantics.

#### Failure modes

11. **Given** the user-preference store is temporarily unavailable, **When** a user DMs the bot, **Then** the bot falls back to the deployment default DM agent and the DM still succeeds (graceful degradation). One operational log line is emitted.
12. **Given** OpenFGA is temporarily unavailable during the PDP call, **When** the user DMs the bot, **Then** the PDP returns `pdp_unavailable`, the bot denies with a "try again" message. Same fail-closed behavior as today.

---

### User Story 3 — Webex space and Webex 1:1 with personal DM experience (Priority: P1)

Webex is structurally symmetric with Slack. Group spaces are channels; 1:1 spaces are DMs. The personal-DM experience (saved default, list, override, help) applies to Webex 1:1 spaces too. Webex has no native slash commands, so commands are issued as plain text (e.g. `@bot list`, `@bot use github`).

**Why this priority**: Shipping Slack and Webex together prevents asymmetric architecture across the two integrations. If we ship only one, operators will perpetually be asked "when is Webex going to work the same way?"

**Independent Test**: Run the existing Webex integration tests against the new code path. Webex 1:1 interactions for a user with a saved Webex DM default must route to the saved agent and respect overrides exactly like Slack.

**Acceptance Scenarios**: Identical to Story 2 with Webex transport. Webex spaces (group) follow Story 1's pattern; Webex 1:1 spaces follow Story 2's pattern.

---

### User Story 4 — Web UI chat with team-mediated access (Priority: P1)

A user logs into the Web UI and starts a chat with an agent they have team-mediated access to (but no direct user grant).

**Why this priority**: Today the Web UI uses `requireAgentUsePermission` which only probes user-direct grants. A user with only team-mediated access is denied. This is an existing inconsistency — they can use the same agent from a Slack channel but not from the Web UI. The spec closes that gap.

**Independent Test**: With only `team:platform#member can_use agent:X` and no direct user grant, a member of `team:platform` should be able to start a Web UI chat with agent X. Sending a chat with an agent the user does not have access to (via any path) must still be denied.

**Acceptance Scenarios**:

1. **Given** a Web UI user who is a member of `team:platform` and `team:platform#member can_use agent:X` (no direct user grant), **When** they start a chat with agent X, **Then** `requireAgentUsePermission` resolves the user's team memberships, probes the team grants, finds allow, and proceeds to forward the chat.
2. **Given** the same user is removed from all teams and has no direct grants, **When** they try to chat with agent X, **Then** the gate returns deny.
3. **Given** an admin has granted `user:<sub> can_use agent:Y` directly, **When** the user chats with agent Y (regardless of team membership), **Then** the gate allows via the direct-grant path.

(Web UI does not have a "default DM agent" concept of its own; the Web UI's agent picker is the existing UI surface and is unrelated.)

---

### User Story 5 — Admin sets DM default agent picker for users (Priority: P2)

A user opens the Web UI Settings panel. They see a "DM agent" section with a picker. The picker lists only agents the user has `can_use` on. The user picks one and saves; their next DM to the Slack or Webex bot routes to that agent.

**Why this priority**: Without this surface, users can't personalize DMs at all. Tied to FR-002 / Story 2 scenario 5.

**Independent Test**: Open Settings, see picker, see only authorized agents, save one, DM the bot, observe the saved agent is used. Clear the preference, DM again, observe deployment default.

**Acceptance Scenarios**:

1. **Given** a user who has `can_use` on 3 agents, **When** they open the Settings DM-agent picker, **Then** they see exactly those 3 agents (with names and descriptions). No other agents.
2. **Given** a user with 0 accessible agents, **When** they open the picker, **Then** they see a helpful empty-state message ("you don't have access to any agents yet — ask an admin to grant your team access").
3. **Given** a user who has set a default, **When** they look at the picker, **Then** the current default is visibly highlighted. A "clear preference" affordance reverts to deployment default.
4. **Given** the user changes their default, **When** they DM the bot in a NEW thread (or after the in-process preference cache TTL expires, default 60s), **Then** the new default is honored without a bot restart.

---

### User Story 6 — Admin creates a team (Priority: P2)

An admin creates a new team via the Admin UI. They expect the team to be usable immediately for channel/space mappings and grants. They expect to touch no Keycloak configuration.

**Why this priority**: Dominant admin flow. Today triggers Keycloak scope provisioning that can fail, drift, and require an env var.

**Acceptance Scenarios**:

1. **Given** an admin with `admin_ui:admin`, **When** they POST `/api/admin/teams { name: "Platform Engineering" }`, **Then** the BFF inserts a `teams` row in Mongo, writes `team` object tuples to OpenFGA, and returns the team. No Keycloak Admin API calls.
2. **Given** the team exists, **When** the admin maps a Slack channel to it via the Admin UI, **Then** the bot's next channel→team Mongo lookup returns the new mapping and members of the team can use mapped agents in that channel.

---

### User Story 7 — Operator's Keycloak panel after migration (Priority: P2)

An operator opens Admin UI → Security & Policy → Keycloak. They expect to see only the rows actually about Keycloak.

**Acceptance Scenarios**:

1. **Given** a post-migration deployment, **When** the operator opens the Keycloak panel, **Then** they see at most these invariant categories: realm-exists, bot-clients-registered, token-exchange-policy-strict-shape, bootstrap-admins-resolved. No `audience.*.single_team_default`. No `team_personal.dm_mode_known_limitation`. No "Reconcile active-team scope" button.
2. **Given** the operator removes `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` from Helm values, **When** they redeploy, **Then** no warnings or invariants fire about that env var.

---

### Edge Cases

- **User belongs to many teams (50+), all with access to the same agent**: PDP returns allow on first match; no double-counting. Performance: see Open Question on `list_objects` perf.
- **User in zero teams, no direct grants, DMs the bot**: PDP returns deny; bot responds "no agents available" with guidance.
- **Channel mapping changes mid-conversation**: bot looks up channel→team on every message; mid-conversation re-mapping takes effect immediately.
- **Tokens in flight from before the migration** (legacy `active_team` claim present): consumers prefer channel-derived team but accept the claim as fallback during the dual-read window.
- **RAG server receives a request with neither claim nor channel_id**: fail closed.
- **DM thread override active, then bot restart**: thread overrides do not persist across restarts (FR-016); next message reverts to saved default.
- **DM thread override and user wants to revert mid-thread**: user issues `/use default` (Slack) or `use default` (Webex) which clears any active thread override AND clears the saved preference, reverting to the deployment default agent. See FR-033.
- **DM thread override and user wants a different agent**: user issues `/use <other-agent>` which replaces the active thread override.
- **User types `/use github-agent` but the agent name has a typo**: bot replies with a friendly correction ("did you mean github?") — does not silently route to default, does not silently fail.
- **Two users DM the bot simultaneously**: each has independent preference / override state; no cross-contamination.
- **Web UI user with team-mediated agent access**: with this spec, they can chat with team-mediated agents. Without the spec they could not. This is a behavior broadening.

## Requirements *(mandatory)*

### Functional Requirements

#### Authorization & gating (preserved in shape, simplified in implementation)

- **FR-001**: System MUST continue to enforce that a Slack channel mapped to a team only allows users who are members of that team to talk to mapped agents from that channel.
- **FR-002**: System MUST continue to enforce that a team must have an OpenFGA `team#member can_use agent` tuple for its members to use an agent.
- **FR-003**: System MUST continue to enforce that an unmapped Slack channel or Webex space cannot reach Dynamic Agents — bot edge denies before forwarding.
- **FR-004**: AgentGateway MCP-tool gating per `user can_invoke tool` is unchanged.

#### DM, Web UI, and Webex 1:1 authorization (new shape — direct OR team union)

- **FR-005**: For Slack DMs (no `channel_team_mappings` row), the bot MUST call the BFF PDP with `user_subject=user:<sub>`. No `__personal__` sentinel.
- **FR-006**: For Webex 1:1 spaces (no `space_team_mappings` row), the bot MUST call the BFF PDP with `user_subject=user:<sub>`.
- **FR-007**: For Web UI chat requests, `requireAgentUsePermission` MUST allow if EITHER `user:<sub> can_use agent` (direct grant) OR any team the user belongs to has `team:<slug>#member can_use agent`.
- **FR-008**: BFF PDP MUST resolve "team union" by listing user team memberships via OpenFGA `list_objects(user, member, team)`, then probing each `team:<slug>#member can_use agent:<id>` until one returns allow or all are exhausted.
- **FR-009**: BFF PDP MUST short-circuit on direct grant (`user:<sub> can_use agent:<id>`) before iterating team union.
- **FR-010**: When the PDP returns allow, the audit log MUST include a `team_resolution_path` field: `direct_user_grant` | `team_union:<slug>` | `channel_grant_and_team` | `denied`.

#### Token shape and Keycloak surface

- **FR-011**: Slack bot, Webex bot, and Web UI MUST NOT request `scope=team-<slug>` or `scope=team-personal` on token exchange. Only `scope=openid` plus audience.
- **FR-012**: Consumers (RAG, Dynamic Agents) MUST NOT require `active_team` claim. Dual-read window: they MAY read it if present; after Phase 3 the readers and the issuer-side machinery are removed.
- **FR-013**: BFF MUST NOT call `ensureTeamClientScope` when creating a team in Phase 2 onward. Phase 3 deletes the function.
- **FR-014**: `selectAgentGatewayActiveTeamScope`, `ensureTeamClientScope`, the `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` env var, the `POST /api/admin/keycloak/active-team-scope` BFF route, and the heal UI button MUST be removed in Phase 3.
- **FR-015**: The `audience.<client>.single_team_default` invariant and `team_personal.dm_mode_known_limitation` advisory MUST be removed in Phase 3.

#### Channel context propagation

- **FR-016**: Bots MUST include the originating `channel_id` (and `workspace_id`) in the chat request envelope forwarded to Dynamic Agents. Web UI omits both.
- **FR-017**: RAG server MUST derive `team_id` from `channel_id` via the existing `channel_team_mappings` collection when channel context is present. When absent (Web UI, DM, Webex 1:1), RAG MUST evaluate team-union from the user's OpenFGA memberships for KB filtering — matching the gate policy.
- **FR-018**: Absence of a `channel_team_mappings` row is the DM signal. The string sentinel `__personal__` MUST be removed.

#### Per-user DM agent preference (new — replaces personal-DM spec)

- **FR-019**: System MUST persist, per user, a "DM default agent" preference (`dm_default_agent_id`) that survives bot restarts, Web UI restarts, and user sessions. Stored in MongoDB as part of an existing user-preferences collection (no new collection if one exists; create one named `user_preferences` if not).
- **FR-020**: Web UI Settings MUST expose a dedicated, discoverable surface for the user to view and update their DM default agent.
- **FR-021**: The Web UI picker MUST list only agents the user has `can_use` on (via direct grants or any team grants).
- **FR-022**: The Web UI MUST show what the deployment default is (the agent used when no preference is set) so "clear preference" is meaningful.
- **FR-023**: Slack bot and Webex bot MUST, on every DM message, resolve the dispatch agent in this order:
  1. The user's active thread override (Phase 2), if any and if user has `can_use`.
  2. The user's saved DM default (`dm_default_agent_id`), if any and if user has `can_use`.
  3. The deployment-configured `dm_agent_id`, if user has `can_use`.
  4. The deployment-configured `default_agent_id`, if user has `can_use`.
  5. Deny with "no agents available" guidance.
- **FR-024**: The bot MUST re-verify `can_use` on the resolved agent at dispatch time. A saved preference does not bypass authorization.
- **FR-025**: If a saved preference is bypassed because permission was revoked or the agent no longer exists, the user MUST receive a single ephemeral notice in that DM explaining the fallback. The notice MUST NOT block the request.
- **FR-026**: The bot's user-preference lookup MUST be cached briefly per user inside the process (default 60s TTL) for latency. Cache MUST honor changes within the TTL.
- **FR-027**: If the preference-storage backend is unavailable, the bot MUST gracefully fall back to the deployment default. One operational log line per outage window.

#### In-DM commands (new — from personal-DM spec)

- **FR-028**: Slack bot MUST expose `/list` (or `/caipe-list`) returning ephemerally the agents the user has `can_use` on. Names, short descriptions, paginated for >25 entries.
- **FR-029**: Slack bot MUST expose `/use <agent>` (or `/caipe-use <agent>`) setting an explicit thread-scoped override.
- **FR-029a**: Slack bot MUST accept the literal token `default` as the argument to `/use` (i.e. `/use default` or `/caipe-use default`). This single command MUST (a) clear any active thread override for the current thread, and (b) clear the user's saved DM preference (`dm_default_agent_id := null` in `user_preferences`). Subsequent messages then route via the standard chain (FR-023), which falls through to the deployment default. The bot MUST acknowledge with an ephemeral confirmation naming the deployment-default agent the user will now be talking to.
- **FR-030**: Slack bot MUST expose `/help` (or `/caipe-help`) showing available commands, including `/use default`.
- **FR-031**: Webex bot MUST provide equivalent functionality. Since Webex has no native slash commands, the bot MUST accept plain text commands `list`, `use <agent>`, `use default`, `help` directed to it (after the `@bot` mention or as the entire 1:1 message body), and MAY also support natural-language detection of the same intents.
- **FR-032**: Thread overrides MUST be scoped to the current DM thread, MUST NOT cross threads, MUST NOT affect saved preference (except via the explicit `/use default` command — FR-029a), MUST NOT persist across bot restarts. Thread overrides do NOT have a time-based expiry: an override remains in effect for the lifetime of the bot process (or until the user explicitly changes it via another `/use <agent>` or `/use default` command in the same thread).
- **FR-033**: If a user issues `/use <agent>` for an agent they don't have `can_use` on, the bot MUST refuse with a clear message, preserve existing default, store no override. `/use default` MUST always succeed (no permission check — clearing your own preference is always allowed).
- **FR-034**: All command output MUST be ephemeral where the platform supports it (Slack: `response_type=ephemeral`; Webex: direct reply to the issuer only).
- **FR-035**: Commands MUST be rate-limited per user (default: 5 commands per 30 seconds).
- **FR-036**: `/list` MUST resolve permissions at command time, not from a stale cache.
- **FR-037**: User-visible bot messages (notices, refusals, help, fallback explanations) MUST use the existing `user_messages.py` templating infrastructure, not ad-hoc literal strings.

#### Migration safety

- **FR-038**: Phase 1 (additive, dual-read) MUST land without breaking any existing Slack/Webex/Web UI flow.
- **FR-039**: Phase 2 (flip default) MUST be deployable independently of Phase 3.
- **FR-040**: Phase 3 (demolition) MUST be reversible up until Keycloak `team-<slug>` scopes are deleted. Scope deletion is the point-of-no-return.

#### Audit & observability

- **FR-041**: Every bot DM dispatch decision MUST log: user_id, resolved agent_id, source (`saved_preference` | `thread_override` | `deployment_dm_default` | `deployment_default` | `denied`), team_resolution_path (from FR-010), and authorization outcome.
- **FR-042**: Dynamic Agents MUST drop the `active_team` log field once Phase 2 is deployed.

### Key Entities

#### Existing (no schema change)
- **Channel/Space mapping**: `channel_team_mappings`, `space_team_mappings` — source of truth for room→team.
- **Team membership**: OpenFGA `team:<slug>#member` tuples.
- **Agent grants**: OpenFGA tuples `<subject> can_use agent:<id>`.

#### New
- **User Preference**: `user_preferences` (or extension of existing collection if one exists). Key fields: `user_id` (Keycloak sub), `dm_default_agent_id` (nullable), `updated_at`. Lifecycle: created on first save, updated on user change, cleared by user via "clear preference" action. Deleted automatically if user is purged (out of scope for this spec).
- **DM Thread Override**: In-process map keyed by `(workspace_id, channel_id, user_id, thread_ts)` for Slack and `(person_id, room_id)` for Webex 1:1, valued by `agent_id`. Bounded scope; never persisted; no time-based expiry — entry lives until the user explicitly changes the agent (`/use <other>` or `/use default`) or until the bot process restarts.
- **PDP request envelope** (changed): `/access-check` accepts `user_subject` as either `team:<slug>#member` (mapped channel/space) or `user:<sub>` (DM/1:1/Web UI). PDP behavior depends on subject type.
- **Chat request envelope** (new optional field): `channel_id` and `workspace_id` present for bot-originated requests; absent for Web UI.

## Success Criteria *(mandatory)*

### Authorization simplification (Problem 1)

- **SC-001**: Slack DMs work end-to-end without `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` set and without any `team-*` scope bound as default on `caipe-platform`. Verified by `tests/rbac/end_to_end/test_slack_dm.sh` (new).
- **SC-002**: Webex 1:1 spaces work end-to-end under the same conditions. Verified by `tests/rbac/end_to_end/test_webex_1to1.sh` (new).
- **SC-003**: Web UI chat works for a user with team-mediated access only. Verified by new Jest integration test.
- **SC-004**: After Phase 3, adding a new team makes zero Keycloak Admin API calls.
- **SC-005**: After Phase 3, Keycloak panel has at most 4 invariant rows.
- **SC-006**: After Phase 3, `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` removed from Helm chart and `docker-compose.dev.yaml`.
- **SC-007**: After Phase 3, `rg "active_team" ai_platform_engineering ui` returns no production matches.
- **SC-008**: All three surfaces use the same PDP code path with `user_subject` distinguishing the cases.

### Personal DM experience (Problem 2)

- **SC-009**: A user can set a DM default agent in Web UI Settings and see the result in a follow-up DM within 60 seconds, no bot restart.
- **SC-010**: 100% of bot DM dispatches honor the user's saved preference when authorized.
- **SC-011**: 100% of dispatches that would have used a no-longer-authorized preference fall back gracefully with exactly one ephemeral notice per fallback occurrence (per thread, not per message).
- **SC-012**: `/list` returns results within 2 seconds at p95 for users with up to 50 accessible agents.
- **SC-013**: After a thread override, 100% of subsequent messages in the same thread route to the chosen agent until the user explicitly changes the agent (`/use <other>` or `/use default`) or the bot restarts.
- **SC-014**: 0 cases of cross-user state leakage in DM preference, override, or accessible-agents lookup.
- **SC-015**: When the preference-storage backend is unavailable, DM messages still succeed (via deployment default) at ≥99% over the outage window.
- **SC-016**: `/help` and `/list` p95 latency under 1 second in steady state.

### Combined

- **SC-017**: End-to-end RBAC test suite runtime stays within 10% of pre-spec baseline.
- **SC-018**: RBAC docs in `docs/docs/security/rbac/` have the `active_team`, `team-<slug>`, `team-personal` narrative removed. The "How RBAC works" page is one page shorter and the architecture diagram shows the simplified 5-box model.
- **SC-019**: A new operator can read `docs/docs/security/rbac/index.md` and understand the entire authorization model in under 10 minutes (subjectively measured; we will validate with one external reader).

## Phasing and Independent Deliverability

### Phase 1 — Additive dual-read (foundation)

**Goal**: Both code paths coexist. Nothing breaks. No user-visible change.

- BFF PDP `requireAgentUsePermission` adds a `team_union` fallback when no direct grant exists.
- BFF PDP `/access-check` already accepts `user_subject=user:<sub>`; extend it to do team-union if no direct grant.
- Bots include `channel_id` + `workspace_id` in the chat envelope forwarded to Dynamic Agents (additive field; safely ignored).
- RAG server: if `active_team` claim is missing AND `channel_id` is present in request context, derive `team_id` from `channel_team_mappings` and proceed.
- Add `user_preferences` MongoDB collection + read API used by the bot (not yet wired into dispatch).
- Add Web UI Settings panel for DM default agent (writes preference; not yet honored by bot — that's Phase 2 dispatch).

**FRs**: FR-001 through FR-010, FR-016 through FR-021, FR-038.

### Phase 2 — Flip default + DM personalization live

**Goal**: New code paths are used by default. Old paths still work (for in-flight tokens). Personal DM experience is live for users.

- Bots stop requesting `scope=team-<slug>` / `scope=team-personal` on token exchange.
- Bots stop the `active_team` mismatch check in `obo_exchange.py`.
- Bots stop using `PERSONAL_ACTIVE_TEAM` sentinel; DMs use `user_subject=user:<sub>` and call the PDP.
- Bots honor the saved DM default agent preference (FR-023 dispatch chain).
- Slack slash commands `/list`, `/use`, `/help` go live (manifest updated).
- Webex equivalent commands go live.
- Web UI `requireAgentUsePermission` honors team-union grant (today restricted to direct only).
- Keycloak still has `team-*` scopes provisioned but no longer issues `active_team` claims (because nothing requests the scopes).
- Dynamic Agents drop the `active_team` log line.

**FRs**: FR-011, FR-022 through FR-037, FR-039, FR-041, FR-042.

### Phase 3 — Demolition

**Goal**: Delete the now-unused Keycloak surface and the supporting code.

- BFF: delete `ensureTeamClientScope`, `selectAgentGatewayActiveTeamScope`, the `POST /api/admin/keycloak/active-team-scope` route, the cardinality invariant, the team-personal DM advisory, the heal UI button.
- Bots: delete the `active_team` parameter, the `_apply_active_team` helper, the mismatch check (already inert from Phase 2).
- RAG: delete the `active_team` claim extractor.
- Keycloak: delete `team-<slug>` and `team-personal` client scopes via a one-time cleanup migration (or operator opt-in script — see Open Question).
- Helm chart: remove `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` value definition.
- `docker-compose.dev.yaml`: remove the env var passthrough.
- Documentation: rewrite `docs/docs/security/rbac/*` to drop the `active_team` narrative.

**FRs**: FR-012, FR-013, FR-014, FR-015, FR-040.

### Independent value per phase

- Phase 1 alone is shippable. Adds the data plumbing; no behavior change.
- Phase 1 + 2 is shippable and delivers full user-visible value: DMs work, users can personalize, Web UI parity. Keycloak still has extra scopes but they're inert.
- Phase 3 is the cleanup. Critical for the explainability goal (SC-019) but not for functional correctness.

## Non-Goals

- **Not changing the OpenFGA authorization model.** Same tuples, same probes. We change the producer of the team subject, not the schema.
- **Not changing AgentGateway↔MCP authorization.** Per-user-per-tool, orthogonal.
- **Not changing admin UI for team/channel/space CRUD.** Same UX. BFF stops calling Keycloak on team create, but UI doesn't notice.
- **Not adding context-scoped grants** ("Agent X usable in channels but not DMs"). Current OpenFGA model supports it via different resource refs; out of scope here.
- **Not multi-tenant bot instances per realm.** Assumes one bot per realm.
- **Not retrofitting other token-exchange consumers** (e.g. dynamic-agents OBO chains for MCP). Those continue to use OBO without `active_team` for their own reasons.
- **Not changing the channel→team and user-membership pre-checks at the bot edge.** They remain — fast-deny paths.
- **Not introducing a supervisor-style LLM auto-router as the DM default agent.** A user can pick any agent they have access to; introducing a "platform supervisor" agent is a separate design decision.
- **Not per-user agent permissions management.** Spec consumes existing permission system; granting/revoking is out of scope.
- **Not cross-platform thread continuity.** A Slack DM thread and a Webex DM thread are independent.

## Assumptions

- The authoritative OpenFGA system can answer `list_objects(user, member, team)` and `list_objects(user, can_use, agent)` efficiently for users with ≤50 memberships / agent grants.
- A user-preferences MongoDB collection exists or can be created without conflicting with other in-flight specs.
- Slack workspace operators are willing to update the Slack app manifest to register new slash commands as part of deploying Phase 2.
- Slack DM detection (`is_dm_channel`) and Webex 1:1 detection (`space.type == "direct"`) are reliable signals already used by the bots.
- The bots can call the BFF authenticated via OBO context (already true).

## Dependencies

- Existing per-user OBO token-exchange flow.
- Existing OpenFGA-backed permission system with `list_objects` support.
- Existing user-settings storage in the BFF (or willingness to create `user_preferences` collection if absent).
- Existing identity-link prerequisite: bot must resolve chatting user to a CAIPE Keycloak identity before reading preferences or checking permissions.
- Phase 3 demolition depends on Phase 2 having shipped and been observed running for at least one release window (so any in-flight tokens with the legacy claim have expired naturally).

## Open Questions

1. **OpenFGA `list_objects` performance.** DM/Web UI path runs `list_objects(user, member, team)` for each PDP call. For users in many teams, this is N+1 OpenFGA calls. **Plan**: ship Phase 1+2 without optimization, with an in-process per-user 60s cache. Monitor latency. If it becomes a problem add a server-side OpenFGA relation (`agent#can_be_used_by_any_team_of_user`) in a future spec.

2. **`active_team` log field deprecation window.** Spec FR-042 drops it in Phase 2. If anyone uses the log field for downstream observability (Splunk dashboards), they need a heads-up before Phase 2 ships. **Plan**: announce in the Phase 1 release notes; deprecate the field in Phase 2.

3. **Keycloak `team-<slug>` scope cleanup mechanism (Phase 3).** Options:
   - (a) BFF-initiated migration script that uses Keycloak Admin API to bulk-delete `team-*` scopes once Phase 2 has been live for one release.
   - (b) Operator-facing button in Admin UI that lists current `team-*` scopes and deletes them on click.
   - (c) Leave scopes in place forever; they're inert and harmless.
   **Plan**: default to (a) — automated migration as part of the Phase 3 release. (c) is the rollback path if something breaks.

4. **Webex command syntax.** Slack has slash commands. Webex doesn't. **Plan**: text commands `list`, `use <agent>`, `help` directed at the bot (after `@bot` mention or as full message body in 1:1). Optional follow-up: natural-language detection for "what agents can I use?" etc., but not a hard requirement for shipping.

5. **Web UI DM default agent picker placement.** New section in existing Settings panel, or new top-level "DM" subpage? **Plan**: new section in existing Settings panel (one less navigation surface).

6. **Per-user preference storage location.** MongoDB collection name `user_preferences` is a natural fit. Check whether an existing collection serves user-scoped settings; if so, add the field there. **Plan**: scan for existing `user_settings` / `user_preferences` collections at plan time and reuse if found.

## What Stays The Same

For reviewers to know what they do NOT need to re-validate:

- **Keycloak as identity authority.** Still issues OBO. Signs `sub`, `act.sub`, `aud`, `exp`. We remove one custom claim, not the identity model.
- **OpenFGA tuples and authorization model.** All existing tuples remain.
- **MongoDB schemas** (other than new `user_preferences` field/collection).
- **Bot edge denies for unmapped channels/spaces.** Keep working as fast-fail paths.
- **The two distinct gates** (Human→Agent at bot/BFF; Agent→Tool at AgentGateway). Both stay.
- **Admin UI flows for team/channel/space CRUD.** No UX changes for admins managing data.
- **Deployment-level `default_agent_id` and `dm_agent_id` config**. Still the fallback when user has no preference.

## Glossary (for the spec — to be migrated into `docs/docs/security/rbac/`)

- **PEP** (Policy Enforcement Point): Where a deny happens. Slack/Webex bot for human→agent; AgentGateway for agent→tool.
- **PDP** (Policy Decision Point): Where the allow/deny *decision* is made. BFF for human→agent; OpenFGA bridge for agent→tool.
- **Team union**: The set of agents a user can use by virtue of being a member of any team that has been granted access.
- **DM personal mode**: A direct message between a user and the bot. Detected by absence of a `channel_team_mappings` (or `space_team_mappings`) row for the channel/space, not by a JWT claim or sentinel string.
- **Saved preference vs thread override**: The user's persistent default for DMs (stored in `user_preferences`) vs a per-thread choice that lives in the bot's process memory until the user explicitly changes it or the bot restarts. Neither has a time-based expiry.

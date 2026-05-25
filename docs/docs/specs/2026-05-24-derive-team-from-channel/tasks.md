# Tasks: Channel-Derived Team Binding + Personal DM Experience

**Input**: Design documents from `docs/docs/specs/2026-05-24-derive-team-from-channel/`
**Prerequisites**: [spec.md](./spec.md), [plan.md](./plan.md)

## Format: `[ID] [P?] [Phase] Description`

- **[P]**: Can run in parallel with sibling [P] tasks (different files, no ordering dependency)
- **[Phase]**: Migration phase (P1=additive, P2=flip, P3=demolition)
- Tasks include exact file paths
- Every implementation task has a sibling test task in the same phase

## Path Conventions

- **Bots**: `ai_platform_engineering/integrations/slack_bot/`, `ai_platform_engineering/integrations/webex_bot/`
- **BFF + Admin UI**: `ui/src/`
- **RAG server**: `ai_platform_engineering/knowledge_bases/rag/server/src/server/`
- **Dynamic agents**: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/`
- **End-to-end tests**: `tests/rbac/end_to_end/`
- **Docs**: `docs/docs/security/rbac/`

---

## Phase 0: Pre-flight (one-shot)

**Purpose**: Establish baseline. No code changes.

- [ ] T001 Capture current baseline: snapshot Keycloak realm export, current `team-*` scopes, current MongoDB collections — save to `docs/docs/specs/2026-05-24-derive-team-from-channel/baseline/` (gitignored).
- [ ] T002 Confirm `make lint && make test` and `npm run lint && npm test` are green on current `main` before any spec work.

**Checkpoint**: Clean baseline.

---

## Phase 1: Additive — new code paths exist, no behavior change

**Goal**: All new BFF helpers, API routes, Web UI panels, bot envelope fields, and RAG channel-derivation logic land. Bots STILL request `team-<slug>` scopes; Bots STILL use deployment default for DMs. End users see no change.

**Independent Test**:

1. Deploy Phase 1.
2. As a user, hit `/api/user/preferences` via the admin Web UI Settings panel — save a preference.
3. Verify MongoDB `user_preferences` collection has the row.
4. DM the Slack bot — still routes to deployment default (preference not honored yet — this is correct for Phase 1).
5. Run `tests/rbac/end_to_end/test_keycloak_scope_absent.sh` — passes (proves new channel-derived path works for direct RAG calls).

### 1.1 — BFF: Shared PDP helper (foundation for everything else)

- [ ] T010 [P1] Write Jest test for `listUserTeamSlugs` (60s in-process cache, hit/miss, ttl expiry) in `ui/src/lib/rbac/__tests__/openfga-team-membership.test.ts`.
- [ ] T011 [P1] Implement `ui/src/lib/rbac/openfga-team-membership.ts` exporting `listUserTeamSlugs(userSub, tenantId, openFga)`. 60s LRU cache keyed by `(tenantId, userSub)`, max 10k entries.
- [ ] T012 [P1] Write Jest test for `evaluateAgentAccess` (direct grant short-circuit, team-union iteration with 0/1/many teams, denied path, channel-grant-and-team path) in `ui/src/lib/rbac/__tests__/pdp-shared.test.ts`.
- [ ] T013 [P1] Implement `ui/src/lib/rbac/pdp-shared.ts` exporting `evaluateAgentAccess({ userSub, tenantId, agentId, teamSubject?, openFga })` returning `{ allowed: boolean, path: 'direct_user_grant' | 'team_union' | 'channel_grant_and_team' | 'denied', reasonCode: string, matchedTeamSlug?: string }`. Internally calls `listUserTeamSlugs` then parallel `check` per team with early termination on first allow.
- [ ] T014 [P1] [P] Refactor existing `/api/integrations/slack/channels/[wsId]/[channelId]/access-check/route.ts` to use `evaluateAgentAccess`. Behavior MUST be byte-identical to current. Add regression test asserting same response shape and HTTP codes for known inputs.

### 1.2 — BFF: User preferences API

- [ ] T020 [P1] [P] Write Jest test for `POST/GET /api/user/preferences` in `ui/src/app/api/user/preferences/__tests__/route.test.ts`. Cases: GET when none saved → `{dm_default_agent_id: null}`; PUT valid agent → 200; PUT agent the user doesn't have `can_use` on → 403; PUT non-existent agent → 404; PUT `null` → clears; unauthenticated → 401.
- [ ] T021 [P1] Create `ui/src/lib/rbac/user-preferences-store.ts` — thin Mongo wrapper: `getUserPreference(tenantId, userId)`, `setUserPreference(tenantId, userId, agentId | null)`. Index ensure-on-startup pattern matches existing helpers.
- [ ] T022 [P1] Implement `ui/src/app/api/user/preferences/route.ts` — `GET` reads from store; `PUT` validates via `evaluateAgentAccess`, then writes. Both routes require authentication (existing `getServerSession`) and resolve `userId` from session.
- [ ] T023 [P1] [P] Write Jest test for `/api/user/accessible-agents` in `ui/src/app/api/user/accessible-agents/__tests__/route.test.ts`. Returns paginated agent list (direct grants ∪ team-mediated), filtered to current user.
- [ ] T024 [P1] Implement `ui/src/app/api/user/accessible-agents/route.ts` using `pdp-shared` helpers + agent metadata lookup. Default page size 25; max 100.

### 1.3 — Web UI: DM agent preference picker

- [ ] T030 [P1] Write Jest+RTL test for `DmAgentPreferencePanel.tsx` in `ui/src/components/settings/DmAgentPreference/__tests__/DmAgentPreferencePanel.test.tsx`. Cases: empty accessible-agents (empty-state); current default highlighted; save changes preference; clear reverts to "deployment default"; load failure shows retry; saving while preference fetch is mid-flight is debounced.
- [ ] T031 [P1] Implement `ui/src/components/settings/DmAgentPreference/useAccessibleAgents.ts` — SWR-style fetch hook over `/api/user/accessible-agents`.
- [ ] T032 [P1] Implement `ui/src/components/settings/DmAgentPreference/DmAgentPreferencePanel.tsx`. Wire into existing Settings page route (whatever its current path is — likely `ui/src/app/settings/page.tsx`).

### 1.4 — Bot envelope extension (channel context in chat envelope)

- [ ] T040 [P1] Write pytest for `slack_bot/utils/sse_client.py` covering: envelope includes `channel_id`, `workspace_id`, `thread_ts`, `surface_kind` ('channel' | 'dm') fields. Existing tests still pass.
- [ ] T041 [P1] Modify `ai_platform_engineering/integrations/slack_bot/utils/sse_client.py` — add the 4 fields to outbound request body. Default to `None` if absent. Tests assert backward compat — Dynamic Agents that don't know the fields ignore them.
- [ ] T042 [P1] [P] Symmetric change for Webex: `ai_platform_engineering/integrations/webex_bot/utils/sse_client.py` (or equivalent). Same test approach.
- [ ] T043 [P1] [P] In `caipe-ui` BFF route `ui/src/app/api/v1/chat/stream/start/route.ts` (and siblings `/v1/chat/*`), propagate the new envelope fields verbatim to Dynamic Agents. Test asserts pass-through.

### 1.5 — RAG: channel-derived team fallback (dual-read setup)

- [ ] T050 [P1] Write pytest for `rag/server/src/server/rbac.py::derive_team_for_request` in `ai_platform_engineering/knowledge_bases/rag/server/tests/test_team_derivation.py`. Cases: claim present + channel_id present (claim wins — legacy path); claim absent + channel_id with mapping (Mongo wins); claim absent + channel_id without mapping (returns None); claim absent + channel_id absent (returns None).
- [ ] T051 [P1] Implement `derive_team_for_request(request_envelope, user_context) -> str | None` in `rag/server/src/server/rbac.py`. Both authz gates (the RBAC gate in `rbac.py` and the data-filtering gate in `tools.py`) call this helper. The legacy `extract_active_team_from_claims` is kept and tried first; new Mongo-based path runs only if claim is absent.
- [ ] T052 [P1] [P] Update `rag/server/src/server/tools.py` to read `channel_id` from request envelope and pass through to `derive_team_for_request`. Existing claim path unchanged.

### 1.6 — Bot user-preferences HTTP client (Phase 2 will consume)

- [ ] T060 [P1] Write pytest for `slack_bot/utils/user_preferences_client.py` covering: 60s per-user TTL cache; cache miss → HTTP call; cache hit → no HTTP call; HTTP 5xx → null fallback + log; HTTP 404 → null (no preference saved); concurrent requests for same user dedupe to one in-flight call.
- [ ] T061 [P1] Implement `ai_platform_engineering/integrations/slack_bot/utils/user_preferences_client.py` — `httpx` client, 60s TTL cache (use `cachetools.TTLCache`), structured `loguru` log on failure. Module exposes `async get_user_dm_preference(user_id, obo_token) -> str | None`.
- [ ] T062 [P1] [P] Symmetric Webex version: `ai_platform_engineering/integrations/webex_bot/utils/user_preferences_client.py`. Test approach identical.

### 1.7 — End-to-end Phase 1 verification

- [ ] T070 [P1] Write `tests/rbac/end_to_end/test_keycloak_scope_absent.sh` — boots dev compose stack with `team-platform` Keycloak scope DELETED before `caipe-ui` starts. Sends a probe RAG query with `channel_id` set to a channel mapped to team-platform. Asserts: RAG returns expected team-platform docs (proving channel-derived path works without the claim).
- [ ] T071 [P1] Smoke test: deploy Phase 1 to local docker compose dev; user saves preference via UI; verify Mongo `user_preferences` row; restart Slack bot pod; preference still saved (Mongo persistence).

**Checkpoint Phase 1**: All Phase 1 [P1] tasks complete. CI green. Manual smoke passes. **No end-user-visible behavior change.** Ready to commit Phase 1.

---

## Phase 2: Flip default + DM personalization live

**Goal**: Bots stop requesting `team-<slug>` scopes. DMs and 1:1 spaces use union-of-teams PDP. Saved preferences honored. Slash commands live. Web UI broadens to team-union access.

**Prerequisite**: Phase 1 committed and deployed to at least one environment for one full release window.

**Independent Test**:

1. As a user with no direct grant but team membership granting agent X, DM the Slack bot. Bot routes to agent X (was rejected pre-Phase-2).
2. Same user runs `/caipe-list` — sees agent X (and any others their teams grant).
3. User runs `/caipe-use AgentY` (where Y is also accessible). Next message in same thread routes to Y.
4. User runs `/caipe-use default`. Next message routes to deployment default. Saved preference cleared in Mongo.
5. User clears thread (new Slack thread) — preference (now null) → falls through to deployment default. Confirms preference cleared.
6. Restart bot — thread override gone (in-process). Preference still cleared.
7. Webex 1:1 with text `list` and `use AgentY` — symmetric behavior.
8. Web UI: user with team-mediated access only successfully sends a chat to agent X.

### 2.1 — Bot OBO simplification

- [ ] T100 [P2] Write pytest for `slack_bot/utils/obo_exchange.py::impersonate_user` — assert it NO LONGER accepts `active_team` param; assert it NO LONGER calls `_apply_active_team`; assert mismatch check is removed; assert token request body has only `scope=openid` + audience. Tests use a stubbed Keycloak fixture.
- [ ] T101 [P2] Modify `ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py` — drop `active_team` param from `impersonate_user` signature; remove `_apply_active_team` call; remove mismatch detection branch. Keep `_apply_active_team` function body for now (Phase 3 deletes it).
- [ ] T102 [P2] [P] Symmetric change in `ai_platform_engineering/integrations/webex_bot/utils/obo_exchange.py`.
- [ ] T103 [P2] Update all callers of `impersonate_user` in Slack bot to drop the `active_team` arg. Run `rg "impersonate_user.*active_team" ai_platform_engineering/integrations/slack_bot/` → must return zero results.
- [ ] T104 [P2] [P] Same caller update for Webex bot.

### 2.2 — Bot DM authorization path (PDP via user_subject)

- [ ] T110 [P2] Write pytest for `slack_bot/utils/slack_rebac.py::check_dm_authorization` in `ai_platform_engineering/integrations/slack_bot/tests/test_slack_rebac_dm.py`. Cases: user has direct grant → allow; user has no direct but team grants → allow; user has neither → deny; PDP unreachable → fail-closed with telemetry.
- [ ] T111 [P2] Modify `slack_bot/utils/slack_rebac.py` (and `_rbac_enrich_context` in `app.py`) — DM branch short-circuits to BFF PDP with `user_subject=user:<sub>` and no `team_subject`. The `PERSONAL_ACTIVE_TEAM` sentinel branch and the team-scope-via-claim branch are REMOVED.
- [ ] T112 [P2] [P] Symmetric change for Webex `webex_bot/utils/webex_rebac.py` 1:1 branch.

### 2.3 — DM dispatch chain (per-user preference, FR-023)

- [ ] T120 [P2] Write pytest for `slack_bot/utils/dm_agent_resolver.py::resolve_dm_agent` in `ai_platform_engineering/integrations/slack_bot/tests/test_dm_agent_resolver.py`. Cases: thread override present + still authorized → returns override; thread override present + NO LONGER authorized → falls through with ephemeral notice; no override + saved preference + authorized → returns preference; saved preference no longer authorized → falls through to dm_agent_id; no preference + dm_agent_id authorized → returns it; nothing authorized → returns None (deny with help text).
- [ ] T121 [P2] Implement `ai_platform_engineering/integrations/slack_bot/utils/dm_agent_resolver.py` with `resolve_dm_agent(...)` honoring the FR-023 priority chain. Re-checks `can_use` via BFF before returning each candidate.
- [ ] T122 [P2] [P] Symmetric Webex: `webex_bot/utils/dm_agent_resolver.py`.

### 2.4 — Thread overrides in-process

- [ ] T130 [P2] Write pytest for `slack_bot/utils/dm_thread_overrides.py` in `ai_platform_engineering/integrations/slack_bot/tests/test_dm_thread_overrides.py`. Cases: set → get same value; set then set different → second wins; clear via `/use default` → get returns None; bounded size (1000 entries) — oldest evicted; thread_key normalization (workspace,channel,user,thread_ts); NO time-based eviction (assert calling after simulated 1h still returns the override).
- [ ] T131 [P2] Implement `ai_platform_engineering/integrations/slack_bot/utils/dm_thread_overrides.py` — `OverrideStore` class with `set(key, agent_id)`, `get(key) -> agent_id | None`, `clear(key)`. Implementation: `collections.OrderedDict` with max-size LRU bound (1000). No `expires_at` field.
- [ ] T132 [P2] [P] Symmetric Webex: `webex_bot/utils/dm_thread_overrides.py` with `(person_id, room_id)` key.

### 2.5 — Slack slash commands

- [x] T140 [P2] Write pytest for `slack_bot/utils/slash_commands.py::handle_list_command` covering: returns ephemeral text; available=False fallback message; empty list message; rate limit enforced. *Filename renamed from `slack_slash_commands.py` to keep parity with `text_commands.py` on the Webex side.*
- [x] T141 [P2] Write pytest for `handle_use_command` — `use AgentX` allowed → override set; `use AgentX` denied (known agent) → friendly refusal, no override change; `use github-agent` denied (unknown) → "did you mean github?" hint; `use default` → clears thread override + clears saved preference + ephemeral confirmation; `use` with no arg → usage hint; rate limit 5/30s enforced; PDP unavailable → fail-closed copy.
- [x] T142 [P2] Write pytest for `handle_help_command` — returns help text constant; rate-limited; copy lives next to its single call site (FR-037).
- [x] T143 [P2] Implement `ai_platform_engineering/integrations/slack_bot/utils/slash_commands.py`. Pure handlers; the Bolt registration of `/caipe-list`, `/caipe-use`, `/caipe-help` is left for the wire-up follow-up (T144). `use default` clears override + saved preference; `use <agent>` re-checks the PDP every time.
- [x] T144 [P2] Update Slack app manifest docs at `docs/integrations/slack-manifest.md` (NEW file) with required commands and scopes. Add release-note pointer.
- [x] T145 [P2] Wire slash command rate limiter (`5/30s` per user). Added `slack_bot/utils/command_rate_limiter.py` (sliding-window LRU; no existing rate limiter found in repo).

### 2.6 — Webex text commands

- [x] T150 [P2] Write pytest for `webex_bot/utils/text_commands.py::parse_command_text` — first token `list` → list; `use AgentX` → use; `use default` → use+default; `help` → help; `@caipe list` (post-mention) → list; arbitrary chat → None; non-string → None.
- [x] T151 [P2] Write pytest for `handle_list_command` / `handle_use_command` / `handle_help_command` — same handler behavior as Slack tests in §2.5 but for Webex copy and `(person_id, room_id)` OverrideKey.
- [x] T152 [P2] Implement `ai_platform_engineering/integrations/webex_bot/utils/text_commands.py`. Strict prefix match after leading-mention strip; `default` token handling identical to Slack.
- [x] T153 [P2] Hook command dispatcher into existing Webex message handler at the entry point in `webex_bot/app.py`. Commands intercept BEFORE the chat dispatch path. *Wire-up follow-up.*

### 2.7 — Web UI gate broadening

- [x] T160 [P2] Write Jest test for `requireAgentUsePermission` team-union path in `ui/src/lib/rbac/__tests__/openfga-agent-authz.test.ts`. Existing direct-grant + email-fallback + deny + 503 + 401 + 400 tests preserved; added: team-union allow (with matched-slug audit field), neither-direct-nor-team-union deny, direct-grant-shortcircuit (does NOT call `listUserTeamSlugs`), and fails-closed when team listing throws.
- [x] T161 [P2] Modify `ui/src/lib/rbac/openfga-agent-authz.ts::requireAgentUsePermission` so that when the direct probes (user-subject and email-principal fallback) both deny, we now call `listUserTeamSlugs` + per-team `team:<slug>#member can_use agent:<id>` probes. `ALLOW_TEAM_UNION` reason code added to `AuditReasonCode`.

### 2.8 — Dynamic Agents log cleanup (FR-042)

- [x] T170 [P2] [P] No existing log-content test references `active_team`; verified by `rg`. Pre-existing tests in `dynamic_agents/tests/test_jwt_middleware.py` all pass after the change.
- [x] T171 [P2] [P] Remove the `active_team` log field from `dynamic_agents/src/dynamic_agents/auth/jwt_middleware.py`. Replaced with a code comment pointing at this spec. CHANGELOG entry deferred to the Phase 2 release notes.

### 2.9 — End-to-end Phase 2 verification

- [x] T180 [P2] Write `tests/rbac/end_to_end/test_slack_dm.sh` — full DM chain. Sets up: team-platform with channel mapping, agent grant via team-platform; user is team-platform member. Sends DM, expects deployment default; saves preference via API; DMs again, expects preferred agent; runs `/caipe-use AgentX`; sends DM, expects X; runs `/caipe-use default`; sends DM, expects deployment default + asserts Mongo preference is null.
- [x] T181 [P2] [P] Write `tests/rbac/end_to_end/test_webex_1to1.sh` — Webex equivalent.
- [x] T182 [P2] [P] Write `tests/rbac/end_to_end/test_webui_team_grant.sh` — user with team-only grant successfully sends chat to a team-granted agent via Web UI.
- [ ] T183 [P2] Manual smoke: deploy Phase 2 to dev stack. Exercise all three end-to-end scripts plus a Slack channel message (regression). Observe one full integration test run; no `active_team` rejections in logs.

**Checkpoint Phase 2**: All Phase 2 tasks complete. CI green. Manual smoke passes. **DM personalization is live. Bots no longer request `team-*` scopes.** Ready to commit Phase 2.

---

## Phase 3: Demolition

**Goal**: Delete now-unused Keycloak surface, BFF helpers, bot helpers, RAG legacy claim extractor. Documentation rewrite. Operator-runnable scope cleanup script.

**Prerequisite**: Phase 2 deployed to all environments for ≥1 release window. No `active_team` rejection logs observed.

**Independent Test**:

1. After demolition: `rg "active_team" ai_platform_engineering ui` returns only references in this spec doc, CHANGELOG, and (optionally) the historical RBAC doc.
2. `rg "KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG"` returns only release-note refs.
3. `rg "team-personal"` returns no production matches.
4. Run `scripts/cleanup-team-keycloak-scopes.sh` in dev stack. Confirm Keycloak has zero `team-*` and zero `team-personal` scopes. Re-run all Phase 2 e2e scripts → all pass.
5. Open `docs/docs/security/rbac/index.md` — word count ≤ 50% of pre-Phase-3 (SC-018).

### 3.1 — BFF deletions

- [ ] T200 [P3] Delete `ui/src/app/api/admin/keycloak/active-team-scope/` (route + tests + directory).
- [ ] T201 [P3] In `ui/src/lib/rbac/keycloak-admin.ts` — delete: `ensureTeamClientScope`, `selectAgentGatewayActiveTeamScope`, exported `BOT_OBO_AUDIENCE_CLIENT_ID` if only used by deleted helpers, any helper exclusively used by the deleted functions. Keep `keycloakAdminClient` and other surface needed by remaining admin flows.
- [ ] T202 [P3] In `ui/src/lib/rbac/keycloak-invariants.ts` — delete `audience.<client>.single_team_default` invariant and `team_personal.dm_mode_known_limitation` invariant. Update `keycloak-invariants.test.ts`: remove the corresponding test blocks. Run the test file and confirm no flakes.
- [ ] T203 [P3] In `ui/src/components/admin/KeycloakMigrationHealthPanel.tsx` — remove: the active-team-scope action UI (input + button + state machine), the heal-result toast, related dispatch handlers. Remove imports that become dead.
- [ ] T204 [P3] In `ui/src/components/admin/__tests__/KeycloakMigrationHealthPanel.test.tsx` — remove tests for the deleted UI surface. Confirm remaining tests pass.
- [ ] T205 [P3] In `ui/src/components/admin/invariant-explanations.ts` — remove `audienceSingleDefault` and `team_personal.dm_mode_known_limitation` entries. Update `invariant-explanations.test.ts`.
- [ ] T206 [P3] In `ui/src/app/api/admin/teams/route.ts` (and any sibling `route.ts` for team CRUD) — remove the call site of `ensureTeamClientScope` from the team-create handler. Update its tests to assert the call is no longer made.

### 3.2 — Bot deletions

- [ ] T210 [P3] In `slack_bot/utils/obo_exchange.py` — delete `_apply_active_team` function entirely; clean up dead imports. Delete any helper exclusively used by it.
- [ ] T211 [P3] [P] Symmetric for `webex_bot/utils/obo_exchange.py`.
- [ ] T212 [P3] In `slack_bot/app.py` — remove the now-dead `PERSONAL_ACTIVE_TEAM` import and any references; remove the legacy DM-claim branch.
- [ ] T213 [P3] [P] Symmetric for Webex `webex_bot/app.py`.
- [ ] T214 [P3] Run `rg -n "active_team|PERSONAL_ACTIVE_TEAM|_apply_active_team" ai_platform_engineering/integrations/` — must return zero results. Add this check to the verification gate.

### 3.3 — RAG deletions

- [ ] T220 [P3] In `rag/server/src/server/rbac.py` — delete `extract_active_team_from_claims`. Adjust `derive_team_for_request` to drop the claim-first branch — now Mongo-only via `channel_id`. Adjust corresponding test in `test_team_derivation.py` to reflect: claim presence is now irrelevant; channel_id is the only signal.
- [ ] T221 [P3] Run `rg -n "active_team|extract_active_team_from_claims" ai_platform_engineering/knowledge_bases/` — must return zero results.

### 3.4 — Config + Helm cleanup

- [ ] T230 [P3] In `docker-compose.dev.yaml` — remove the `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` env-var passthrough block from `caipe-ui` service.
- [ ] T231 [P3] In Helm chart `charts/ai-platform-engineering/charts/caipe-ui/values.yaml` and templates — remove `keycloak.rbacActiveTeamSlug` value field and any `template`-side env injection.
- [ ] T232 [P3] In `setup-caipe.sh` (and any sibling onboarding script) — remove references to the env var.
- [ ] T233 [P3] Run `rg -n "KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG"` — must return only docs / CHANGELOG / spec / migration-script references.

### 3.5 — Keycloak scope cleanup script

- [ ] T240 [P3] Write `scripts/cleanup-team-keycloak-scopes.sh` — kcadm-based, lists all `team-<slug>` and `team-personal` scopes, prompts (Y/n) per scope or `--yes` to skip prompts, deletes via `kcadm.sh delete client-scopes/<id>`. Idempotent. Logs each action.
- [ ] T241 [P3] Write `tests/rbac/end_to_end/test_cleanup_script.sh` that boots dev compose, asserts pre-state has team scopes, runs the cleanup script with `--yes`, asserts post-state has zero `team-*` scopes, re-runs all Phase 2 e2e scripts → all pass.

### 3.6 — Documentation rewrite

- [ ] T250 [P3] Rewrite `docs/docs/security/rbac/architecture.md`:
  - Remove the `active_team` section (Component 1 — Keycloak).
  - Remove the audience-cardinality invariant subsection.
  - Remove the DM-mode advisory.
  - Remove the `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` env-var documentation.
  - Add the new "team derivation from channel context" section.
  - Update component summaries: caipe-ui = PDP, Slack/Webex bots talk directly to Dynamic Agents (per user correction in spec authoring).
  - Re-render the architecture diagram (mermaid).
- [ ] T251 [P3] Rewrite `docs/docs/security/rbac/workflows.md`:
  - Replace the channel-message sequence diagram with the post-spec version (no Keycloak team-scope round-trip).
  - Replace the DM-message sequence diagram with the new dispatch chain (override → preference → dm_agent_id → default_agent_id → deny).
  - Add a new sequence diagram for `/use default` showing both override + preference cleared in one round-trip.
- [ ] T252 [P3] Rewrite `docs/docs/security/rbac/usage.md`:
  - Remove the `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` section.
  - Remove the "Reconcile active-team scope (targeted heal)" section.
  - Remove the DM-mode known-limitation troubleshooting bullet.
  - Add: how to save / clear DM preference (Web UI + in-DM `/use default`).
  - Add: `cleanup-team-keycloak-scopes.sh` operator runbook.
- [ ] T253 [P3] Update `docs/docs/security/rbac/file-map.md`:
  - Remove rows for `active-team-scope/route.ts`, `audience.single_team_default` invariant, `team_personal.dm_mode_known_limitation` invariant.
  - Add rows for `api/user/preferences/route.ts`, `api/user/accessible-agents/route.ts`, `DmAgentPreferencePanel.tsx`, `dm_agent_resolver.py` (slack+webex), `dm_thread_overrides.py` (slack+webex), `slack_slash_commands.py`, `webex_text_commands.py`, `user-preferences-store.ts`, `pdp-shared.ts`, `openfga-team-membership.ts`.
- [ ] T254 [P3] Rewrite `docs/docs/security/rbac/index.md` — the 5-component summary using the merged-spec mental model. Target word count ≤50% of pre-Phase-3 length. Update any links to the deleted files/sections.

### 3.7 — Test deletions/updates

- [ ] T260 [P3] Re-run `npm test` across `ui/` and assert no test references deleted invariants, deleted routes, or deleted UI surfaces. Delete tests that solely exercise removed surface; update tests whose surface was modified but still exists.
- [ ] T261 [P3] Re-run `make test` across Python and assert no test references deleted functions. Same cleanup pattern.

### 3.8 — Final verification

- [ ] T270 [P3] Run the complete verification gate:
  - `make lint && make test` clean (Python).
  - `npm run lint && npm test` clean (UI).
  - `rg "active_team" ai_platform_engineering ui` returns only spec doc + CHANGELOG.
  - `rg "KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG"` returns only docs/CHANGELOG.
  - `rg "team-personal"` returns no production matches.
  - `scripts/cleanup-team-keycloak-scopes.sh --yes` succeeds in dev stack.
  - All Phase 2 e2e scripts re-run after cleanup → all pass.
  - `docs/docs/security/rbac/index.md` word count ≤ 50% of pre-Phase-3.
- [ ] T271 [P3] Tag the Phase 3 commit clearly in CHANGELOG as the "demolition" release. Include the loud-and-clear notice about one-way-door cleanup script.

**Checkpoint Phase 3**: All Phase 3 tasks complete. Verification gate passes. **Keycloak surface is clean.** Ready to commit Phase 3 + run cleanup script in each environment per release process.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0**: No deps; runs first.
- **Phase 1**: Depends on Phase 0. Within Phase 1, subsection 1.1 (BFF PDP helper) blocks 1.2, 1.3, 1.7. Subsections 1.4–1.6 are independent of 1.1 and can run in parallel.
- **Phase 2**: Depends on Phase 1 fully deployed for one release window. Within Phase 2, subsection 2.1 (OBO simplification) is independent. Subsections 2.2–2.4 share authorization plumbing; 2.5 (Slack commands) and 2.6 (Webex commands) are independent of each other after 2.3. Subsection 2.7 (Web UI) is independent.
- **Phase 3**: Depends on Phase 2 deployed for ≥1 release window with no `active_team` log noise. Within Phase 3, subsections are mostly independent file deletions; documentation rewrites (§3.6) can run in parallel with deletions.

### Parallel Opportunities

- All `[P]` tasks within a subsection can run together.
- Within Phase 1, subsections 1.4, 1.5, 1.6 can be worked on in parallel by different developers after 1.1–1.3 land.
- Within Phase 2, Slack (§2.5) and Webex (§2.6) command implementations are independent.
- Within Phase 3, the deletions (§3.1–§3.5) and the documentation rewrites (§3.6) can run in parallel.

---

## Implementation Strategy

### Single-developer sequential

1. Phase 0 (T001–T002).
2. Phase 1 subsections in order: 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7.
3. Commit Phase 1. Deploy. Wait one release window.
4. Phase 2 subsections in order: 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 → 2.9.
5. Commit Phase 2. Deploy. Wait one release window.
6. Phase 3 subsections in order: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8.
7. Commit Phase 3. Deploy. Run cleanup script per environment.

### Multi-developer parallel (Phase 1)

- Dev A: 1.1 (BFF PDP helper) — blocks others, so go first.
- Dev B (after 1.1): 1.2 (User preferences API) + 1.3 (Web UI panel).
- Dev C: 1.4 (Bot envelope) + 1.5 (RAG fallback) — independent of 1.1.
- Dev D: 1.6 (Bot pref client) — independent.
- All converge on 1.7 (e2e tests).

### Multi-developer parallel (Phase 2)

- Dev A: 2.1 + 2.2 (OBO + DM authz).
- Dev B: 2.3 + 2.4 (resolver + overrides).
- Dev C: 2.5 (Slack commands).
- Dev D: 2.6 (Webex commands).
- Dev E: 2.7 (Web UI broadening) + 2.8 (DA log cleanup).
- All converge on 2.9 (e2e tests).

---

## Test Discipline

For every implementation task:

1. **Write the test FIRST.** Confirm it fails (red).
2. Implement the minimum to make the test pass (green).
3. Refactor if needed; re-run.
4. Move to the next task.

Each `[P1]` / `[P2]` / `[P3]` task with a sibling test task above it must produce code where the sibling test passes.

`rg` deletion checks (T214, T221, T233, T270) are NOT optional. If they return matches that aren't documented exceptions (spec doc, CHANGELOG, migration script), the phase is not complete.

---

## Dead-Code Cleanup Discipline

Phase 3 is the only phase that deletes. But every phase MUST avoid introducing new dead code:

- Phase 1: any new helper that isn't yet used (Phase 2 will consume it) MUST have a test that exercises it via a stub caller. We do not ship unused exports.
- Phase 2: when a function's signature changes (e.g. `impersonate_user` losing `active_team`), all callers MUST be updated in the same commit. No "TODO update other caller" left in code.
- Phase 3: after each subsection, run `rg` for the deleted symbol across the repo. If any match remains in production code, the subsection is not complete.

`rg -n` for the following symbols at the end of Phase 3 MUST return zero production matches (only spec/CHANGELOG references allowed):

- `active_team`
- `PERSONAL_ACTIVE_TEAM`
- `_apply_active_team`
- `ensureTeamClientScope`
- `selectAgentGatewayActiveTeamScope`
- `extract_active_team_from_claims`
- `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG`
- `audience.single_team_default`
- `team_personal.dm_mode_known_limitation`
- `audienceSingleDefault`

---

## Notes

- Phase boundaries align with commit boundaries: each phase is a single commit on `main`.
- Each phase commit message follows Conventional Commits with `feat(rbac):` scope and references this spec.
- DCO sign-off + `Assisted-by: Claude:claude-opus-4-7` trailer on every commit (per repo policy).
- Rate-limit utility (T145) — if a shared one exists, use it; if not, the one we add lives in `slack_bot/utils/` and can be shared with Webex via a copy-paste-and-test sibling.
- The "release window" between phases is operator policy; in the spec we say "one full release window" to allow the operator to set the cadence.

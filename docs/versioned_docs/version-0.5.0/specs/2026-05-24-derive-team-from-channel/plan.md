# Implementation Plan: Channel-Derived Team Binding + Personal DM Experience

**Branch**: `main` (working directly on `main` per maintainer instruction)
**Date**: 2026-05-24
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-05-24-derive-team-from-channel/spec.md`

## Summary

Remove the Keycloak-stamped `active_team` JWT claim and the per-team Keycloak client scopes that produce it. Derive the user's effective team at every consumer from the MongoDB data the producer already reads. Unify Slack channels, Slack DMs, Webex spaces, Webex 1:1s, and Web UI chat behind a single authorization gate (`user_subject` is either `team:<slug>#member` or `user:<sub>`; the BFF PDP probes direct grants first, then iterates the user's team memberships). Use the freed-up DM surface to ship per-user DM agent preferences, in-DM discovery/override slash commands, and graceful fallback when preferences become unauthorized.

**Technical approach**: three sequential, individually-deployable phases — additive dual-read (Phase 1), flip default + DM personalization (Phase 2), demolition (Phase 3). Each phase is a separate Git commit, lint+test gated, with documented rollback. Phase 1 ships zero behavior change for end users; Phase 2 is when DM users see new features; Phase 3 cleans up the Keycloak surface.

## Technical Context

**Language/Version**: Python 3.11+ (Slack bot, Webex bot, dynamic agents, RAG server), TypeScript 5.x / Node 20+ (Next.js BFF + admin UI)
**Primary Dependencies**: FastAPI, Slack Bolt, Webex Webhooks SDK, Next.js App Router, MongoDB driver (Python + Node), OpenFGA HTTP API, Keycloak Admin REST (read-only after Phase 3 demolition removes the team-scope provisioning calls), Jest, pytest
**Storage**: MongoDB — existing `channel_team_mappings`, `space_team_mappings`, `teams` collections (unchanged). One new collection: `user_preferences` (one document per user, holding `dm_default_agent_id` + future per-user settings). OpenFGA — no model changes.
**Testing**: pytest for Python (Slack bot, Webex bot, RAG, dynamic-agents middleware), Jest for TypeScript (BFF routes, admin UI components, PDP helpers), shell scripts under `tests/rbac/end_to_end/` for end-to-end cross-component validation.
**Target Platform**: Linux container deployments under Docker Compose (dev) and Helm/Kubernetes (production)
**Project Type**: Multi-service web application (4 distinct deployable services touch this spec: caipe-ui [BFF+admin], slack-bot, webex-bot, RAG server; supporting service dynamic-agents is touched only for log-line removal)
**Performance Goals**:

- BFF PDP latency (p95) ≤ 200ms for cache-hit, ≤ 600ms for cache-miss with team-union list_objects (per SC-009/SC-017)
- DM dispatch end-to-end (p95) ≤ 2s including agent invocation
- `/list` command (p95) ≤ 2s for users with ≤50 agents (SC-012)
- `/help` and other meta commands (p95) ≤ 1s (SC-016)

**Constraints**:

- Phase 1 ships strictly additive — no observable behavior change for any existing user or operator
- Phase 2 must not break in-flight tokens issued by Phase 1 deployments (dual-read window through Phase 2)
- Phase 3 demolition is reversible until Keycloak `team-<slug>` scopes are deleted

**Scale/Scope**: Small (≤10 deployments today, ≤100 teams per deployment, ≤50 channels per team, ≤500 users per deployment, ≤50 agents per user). `list_objects` perf budget is for this scale; if scale grows we add a server-side OpenFGA relation (deferred per Open Question #1).

## Constitution Check

The CAIPE Constitution (`.specify/memory/constitution.md`) v1.0.0 sets seven design principles + a governance gate. Re-checked against this plan:

| Principle | Compliance | Notes |
| --- | --- | --- |
| **I. Worse is Better** | ✅ | Net deletion. Three-phase rollout exists because we cannot atomically shift active workloads, not because we want abstraction. |
| **II. YAGNI** | ✅ | DM thread overrides are in-process only; no DB. Web UI doesn't get its own DM-default concept (it doesn't need one). OpenFGA list_objects optimization is explicitly deferred to a future spec. |
| **III. Rule of Three** | ✅ | Slack and Webex bots have always been duplicated; this spec doesn't extract a third abstraction. PDP helper is shared but only because the BFF route and `requireAgentUsePermission` already used a common code path. |
| **IV. Composition over Inheritance** | ✅ | New helpers (`resolve_dm_agent`, `check_can_use_agent_for_user`) are plain functions, dependency-injected where the bot's request-handling path already accepts callables. |
| **V. Specs as Source of Truth** | ✅ | This plan derives from approved `spec.md`. No code without spec sign-off. |
| **VI. CI Gates Are Non-Negotiable** | ✅ | Each phase commit is lint+test gated. Existing CI workflows (Python lint, UI Jest, RBAC e2e) all run on each commit. |
| **VII. Security by Default** | ✅ | Authorization gate semantics are unchanged. Net result is fewer trust paths (one OpenFGA query layer instead of Keycloak claim + OpenFGA). Re-verification at dispatch (FR-024) prevents preference-based privilege escalation. |

**Governance gate**: No constitution amendments needed.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-05-24-derive-team-from-channel/
├── spec.md              # Approved (the contract)
├── plan.md              # This file — phase strategy, technical context
├── tasks.md             # Phase 3 of speckit — granular task list (next)
├── quickstart.md        # Phase 1 of speckit — operator/dev onboarding for the new model (deferred to post-implementation; the doc rewrite in `docs/docs/security/rbac/` is the user-facing replacement)
├── data-model.md        # OpenFGA model unchanged; Mongo schema additions documented inline below (no separate file needed)
└── contracts/
    └── pdp-access-check.md  # PDP request/response contract for the unified gate
```

Notes:

- `quickstart.md` is intentionally skipped — the operator-facing replacement is the rewrite of `docs/docs/security/rbac/` (already part of Phase 3 task list).
- `data-model.md` is skipped because the only new persisted entity is `user_preferences` with two fields; the schema is captured in the "Database migrations" section below.
- `contracts/pdp-access-check.md` will be added in Phase 1 since the unified PDP contract is the load-bearing interface; one short contract doc is enough.

### Source Code (repository root)

The change touches existing directories. No new top-level structure.

```text
ai_platform_engineering/
├── integrations/
│   ├── slack_bot/
│   │   ├── app.py                              # Phase 1: pass channel_id+workspace_id in chat envelope. Phase 2: stop active_team scope, honor saved preference, accept overrides, route slash commands.
│   │   ├── utils/
│   │   │   ├── obo_exchange.py                 # Phase 2: drop active_team param + mismatch check. Phase 3: delete _apply_active_team helper.
│   │   │   ├── slack_rebac.py                  # Phase 2: bot calls PDP with user_subject=user:<sub> on DMs.
│   │   │   ├── dm_agent_resolver.py            # NEW (Phase 1 read, Phase 2 use): dispatch chain (override → saved → dm_agent_id → default_agent_id → deny).
│   │   │   ├── dm_thread_overrides.py          # NEW (Phase 2): in-process map (workspace, channel, user, thread) → agent_id; no TTL, lives until explicit change or restart.
│   │   │   ├── slack_slash_commands.py         # NEW (Phase 2): /list, /use (incl. `/use default`), /help handlers.
│   │   │   └── user_preferences_client.py      # NEW (Phase 1): HTTP client to BFF for reading user prefs; cached 60s.
│   │   └── tests/                              # New unit + integration tests per surface.
│   └── webex_bot/
│       ├── app.py                              # Symmetric Slack changes.
│       ├── utils/
│       │   ├── obo_exchange.py                 # Phase 2: same as Slack.
│       │   ├── webex_rebac.py                  # Phase 2: user_subject=user:<sub> on 1:1.
│       │   ├── dm_agent_resolver.py            # NEW.
│       │   ├── dm_thread_overrides.py          # NEW.
│       │   ├── webex_text_commands.py          # NEW (Phase 2): parse `list` / `use <agent>` / `help` from @mention/1:1 text.
│       │   └── user_preferences_client.py      # NEW.
│       └── tests/
├── dynamic_agents/
│   └── src/dynamic_agents/auth/jwt_middleware.py   # Phase 2: drop active_team log field.
└── knowledge_bases/
    └── rag/server/src/server/
        ├── rbac.py                             # Phase 1: derive team from channel_id when claim missing. Phase 3: delete claim extractor + __personal__ short-circuit.
        └── tools.py                            # Phase 1: read channel_id from request envelope; same derivation.

ui/
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── admin/
│   │       │   ├── keycloak/
│   │       │   │   ├── active-team-scope/      # Phase 3: DELETE this directory (route + tests).
│   │       │   │   └── ...
│   │       │   └── teams/
│   │       │       └── route.ts                # Phase 2: stop calling ensureTeamClientScope. Phase 3: remove the now-dead branch.
│   │       ├── user/
│   │       │   └── preferences/                # NEW (Phase 1): GET/PUT /api/user/preferences (user-scoped, OBO-authed).
│   │       │       ├── route.ts
│   │       │       └── __tests__/
│   │       └── v1/chat/                        # Phase 1: tolerate channel_id passthrough; do not require it.
│   ├── components/
│   │   ├── admin/
│   │   │   ├── KeycloakMigrationHealthPanel.tsx    # Phase 3: drop active-team-scope action surface, cardinality invariant, DM advisory.
│   │   │   ├── invariant-explanations.ts           # Phase 3: drop audienceSingleDefault + dm_mode_known_limitation entries.
│   │   │   └── ...
│   │   └── settings/
│   │       └── DmAgentPreference/              # NEW (Phase 1 UI; Phase 2 wires into bot dispatch).
│   │           ├── DmAgentPreferencePanel.tsx
│   │           ├── useAccessibleAgents.ts
│   │           └── __tests__/
│   └── lib/
│       └── rbac/
│           ├── keycloak-admin.ts               # Phase 3: delete selectAgentGatewayActiveTeamScope, ensureTeamClientScope, audience-scope export.
│           ├── keycloak-invariants.ts          # Phase 3: delete audience.single_team_default invariant + team_personal.dm_mode_known_limitation.
│           ├── openfga-agent-authz.ts          # Phase 2: extend requireAgentUsePermission with team-union fallback.
│           ├── openfga-team-membership.ts      # NEW (Phase 1): list_objects(user, member, team) helper, cached per-process.
│           └── pdp-shared.ts                   # NEW (Phase 1): shared team-union resolver used by /access-check and requireAgentUsePermission.

docker-compose.dev.yaml                         # Phase 3: drop KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG passthrough.

charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh    # Phase 3: scope cleanup helper (operator-runnable) — see Open Question #3.

docs/docs/security/rbac/
├── architecture.md                              # Phase 3: drop active_team narrative, DM advisory, audience-cardinality invariant. Add the unified PDP shape + DM dispatch chain.
├── usage.md                                     # Phase 3: drop the KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG section, the "Reconcile active-team scope" surface, the DM-mode known limitation.
├── workflows.md                                 # Phase 3: redraw the channel-message + DM-message sequences without Keycloak team-scope round-trip.
├── file-map.md                                  # Phase 3: drop the audience-cardinality + active-team-scope entries; add user_preferences route + DmAgentPreference component.
└── index.md                                     # Phase 3: update the 5-component summary.

tests/
└── rbac/
    └── end_to_end/
        ├── test_slack_dm.sh                    # NEW (Phase 2): exercises FR-005 + FR-023 chain in a docker-compose dev stack.
        ├── test_webex_1to1.sh                  # NEW (Phase 2): Webex equivalent.
        ├── test_webui_team_grant.sh            # NEW (Phase 2): Web UI agent access via team membership only.
        └── test_keycloak_scope_absent.sh       # NEW (Phase 1): asserts the spec works with zero team-* Keycloak scopes (precondition for Phase 3 demolition).
```

**Structure Decision**: Follow the existing multi-service layout. No new top-level directories. The only new package directories are `ai_platform_engineering/integrations/*/utils/` files for DM-specific concerns (preference client, dispatch resolver, thread overrides, command handlers), and `ui/src/components/settings/DmAgentPreference/` for the Web UI panel. Co-locating with the existing bot utilities keeps the changes legible to anyone who already knows the bot layout.

## Database migrations

**Required for Phase 1**: Yes — one new collection.

**Deliverable**: This section, with the schema captured inline. No separate `mongodb-migration.md` is needed because the change is one collection with two fields. If the change grew, we'd promote it.

### `user_preferences` collection

```text
db.user_preferences
{
  _id: ObjectId,
  user_id: string,           // Keycloak sub claim — primary key for queries.
  tenant_id: string,         // For multi-tenant deployments; matches the tenant_id used in teams/channels.
  dm_default_agent_id: string | null,   // Agent ID the user has saved as their DM default; nullable.
  updated_at: ISODate,
}
```

**Indexes**:

- `{ tenant_id: 1, user_id: 1 }` — UNIQUE. Read pattern is always `(tenant_id, user_id)`.
- `{ updated_at: -1 }` — for operational analytics; not load-bearing.

**Backfill**: None. New users get no preference until they save one. Existing users' first DM after Phase 2 ships uses the deployment default (FR-023 step 3), which is the current behavior.

**Rollback**: Drop the collection. The bot's preference client returns null when the collection is missing (FR-027 graceful degradation path), so dropping is safe even mid-traffic. Saved preferences are lost; users have to re-save.

**Environments**: Same shape dev/staging/prod. Helm chart's existing mongo-init pattern creates the collection + index on first deploy; same pattern reused.

### Phase 3 (no migration)

Phase 3 deletes Keycloak `team-<slug>` client scopes via a one-time operator script (see Open Question #3 in `spec.md`; resolution: opt-in script `scripts/cleanup-team-keycloak-scopes.sh`). No MongoDB change in Phase 3.

## Complexity Tracking

No constitution violations. Three justified pieces of complexity worth calling out so they don't surprise reviewers:

| Complexity | Why | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Three-phase rollout instead of single big-bang | Phase 1 ships strictly additive so we can deploy and observe at zero risk; Phase 2 flips default with both paths still wired; Phase 3 deletes. Each phase is independently reversible up to the previous one. | A single big-bang commit would force us to lock-step deploy every component (Slack bot, Webex bot, BFF, RAG, dynamic-agents). Failure of any one component blocks rollback. Phasing trades implementation duration for operational safety. |
| Shared `pdp-shared.ts` helper duplicated across `/access-check` route and `requireAgentUsePermission` | Each surface had its own gate-evaluation code path before; both now need the new "direct OR team-union" logic. A shared helper prevents skew. | Duplicating the logic in each route means a future grant-type addition (e.g. project-scoped grants) has to be added in N places. Cost of one helper ≪ cost of skew bugs. |
| In-process DM thread overrides (no DB, no TTL) | Specced as in-process map (FR-032). Survives only within the bot pod lifetime. Recreating after a restart would require persistence + cleanup + cross-pod sharing — overkill for a thread-scoped affordance whose natural expiry is "the user changes their mind or the bot restarts". | Persisted overrides would survive bot restarts but introduce a permission-cache invalidation problem (revoking a user's `can_use` while their override is persisted = stale state). In-process keeps the security model trivial: every bot restart re-evaluates from current OpenFGA truth. Adding a time-based TTL would surprise users mid-thread without their input; restart and explicit re-selection are the only natural reset points. |

## Phase Strategy (the load-bearing part of this plan)

### Phase 1 — Additive dual-read foundation

**Goal**: All new code paths exist. No old code path is removed. End users see no change. Operators see no change.

**What lands**:

1. **BFF helpers** (new files):
   - `ui/src/lib/rbac/openfga-team-membership.ts` — `listUserTeamSlugs(userSub, tenantId, openFga)` returning `string[]`; 60s in-process cache by `(tenantId, userSub)`.
   - `ui/src/lib/rbac/pdp-shared.ts` — `evaluateAgentAccess({ userSub, tenantId, agentId, teamSubject?, openFga })` returning `{ allowed, path, reasonCode }` where `path` is one of `direct_user_grant | team_union:<slug> | channel_grant_and_team | denied`. Used by both `/access-check` and Phase 2's `requireAgentUsePermission` update.

2. **BFF API surface** (new files; not yet wired into bot dispatch):
   - `ui/src/app/api/user/preferences/route.ts` — `GET` returns `{ dm_default_agent_id }` for the authenticated user; `PUT` validates the agent is in the user's accessible-agents set, then upserts.
   - `ui/src/app/api/user/accessible-agents/route.ts` — returns the union (direct grants + team-union) for the authenticated user, paginated; used by the Web UI picker and (in Phase 2) by `/list`.

3. **Web UI Settings panel** (new component):
   - `ui/src/components/settings/DmAgentPreference/DmAgentPreferencePanel.tsx` — picker filtered to accessible agents, shows current default, save/clear affordances, surfaces "deployment default" label so "clear" is meaningful.

4. **Bot envelope extension**:
   - Slack `sse_client.py` request body gains optional `channel_id`, `workspace_id`, `thread_ts` fields. Forwarded to `/api/v1/chat/stream/start` etc.
   - Webex equivalent.
   - `caipe-ui` `/api/v1/chat/*` routes propagate the new fields verbatim to Dynamic Agents.

5. **RAG fallback derivation**:
   - `rag/server/src/server/rbac.py::extract_active_team_from_claims` is kept; a new helper `derive_team_for_request(request, user_context)` returns `team_id` from (a) the JWT claim if present (legacy path) or (b) `channel_team_mappings[channel_id]` via Mongo when the claim is absent and `channel_id` is in the request envelope. Both gates use this helper.

6. **Bot user-preferences client** (new files, not yet invoked):
   - `slack_bot/utils/user_preferences_client.py` and Webex equivalent — HTTP client calling `GET /api/user/preferences`; per-user 60s TTL cache. Used by Phase 2 dispatch chain.

7. **Tests added**:
   - Jest: pdp-shared evaluator (direct grant, team-union with 0/1/many teams, denied paths). `/api/user/preferences` route. `DmAgentPreferencePanel` component.
   - pytest: `user_preferences_client` HTTP cache + fallback.
   - End-to-end: `tests/rbac/end_to_end/test_keycloak_scope_absent.sh` — boots the dev stack, removes `team-platform` Keycloak scope, asserts a channel message still routes correctly via the (legacy still-on) path AND the new channel-derived path works for a probe direct-call to RAG.

**What does NOT land in Phase 1**:

- Bots do not stop requesting `team-<slug>` scopes — they still do.
- Bots do not honor the saved DM preference yet — picker writes the preference, but the bot still uses the deployment default.
- No slash commands.
- No deletions.

**Verification before merging Phase 1**:

- `npm run lint` clean; `npm test` green on affected suites.
- `make lint` and `make test-supervisor && make test-agents` clean.
- `tests/rbac/end_to_end/test_keycloak_scope_absent.sh` passes.
- Manual smoke: deploy dev stack; open Web UI Settings; see picker; save a preference; verify Mongo collection has the row; restart bot; preference survives.

**Rollback**: Revert the Phase 1 commit. The new BFF routes return 404; the picker is gone; bot preference client is uninvoked. Nothing else is affected.

### Phase 2 — Flip default + DM personalization live

**Goal**: Bots use new code paths by default. Old paths still work for in-flight tokens. Personal DM experience is live.

**What lands**:

1. **Bot OBO simplification**:
   - Slack `obo_exchange.py`: `impersonate_user` stops accepting `active_team` param; drops `_apply_active_team` call and the mismatch check. Token request carries only `scope=openid` + audience.
   - Webex equivalent.

2. **Bot DM authorization path**:
   - Slack `_rbac_enrich_context` short-circuits to PDP-with-`user_subject=user:<sub>` for DMs. The `PERSONAL_ACTIVE_TEAM` sentinel branch is removed.
   - Webex equivalent for 1:1 spaces.

3. **DM dispatch chain (FR-023)**:
   - New `slack_bot/utils/dm_agent_resolver.py::resolve_dm_agent(user_id, tenant_id, deployment_defaults, prefs_client, overrides_store) -> ResolvedAgent | None` implementing the priority chain: thread override → saved preference → `dm_agent_id` → `default_agent_id` → deny.
   - Each step re-checks `can_use` via BFF before returning. A revoked preference falls through with a single ephemeral notice (FR-025).
   - Webex equivalent.

4. **Slack slash commands**:
   - `slack_bot/utils/slack_slash_commands.py` registers `/caipe-list`, `/caipe-use`, `/caipe-help` handlers (resolution per Open Question #2: namespaced; default in spec).
   - Slack app manifest update documented in `docs/integrations/slack-manifest.md` (new doc).
   - Rate-limit: 5/30s per user (FR-035).

5. **Webex text commands**:
   - `webex_bot/utils/webex_text_commands.py` parses `list` / `use <agent>` / `help` from a 1:1 message body or from `@bot list` in a space.

6. **Web UI gate broadening**:
   - `ui/src/lib/rbac/openfga-agent-authz.ts::requireAgentUsePermission` now calls `pdp-shared.evaluateAgentAccess` with `user_subject=user:<sub>` and no team subject. Direct grant short-circuits; team-union iterates.

7. **Dynamic Agents log cleanup** (FR-042):
   - `dynamic_agents/src/dynamic_agents/auth/jwt_middleware.py` drops the `active_team=%s` log field. Add release-note line.

8. **Tests added/extended**:
   - Slack: `test_dm_personal_mode_pdp.py`, `test_dm_agent_resolver.py`, `test_slash_commands.py`. Webex equivalents.
   - Jest: `requireAgentUsePermission` team-union path tests. Override the existing test that pinned user-direct-only behavior — that pin becomes obsolete.
   - End-to-end: `test_slack_dm.sh`, `test_webex_1to1.sh`, `test_webui_team_grant.sh`.

**What does NOT land in Phase 2**:

- Keycloak `team-<slug>` scopes still exist (operator may notice they're inert but harmless).
- BFF still has `ensureTeamClientScope` and `selectAgentGatewayActiveTeamScope` code (uncalled from team-create, but the functions remain).
- The cardinality invariant + heal UI button still exist (also inert — there are no team-* defaults to drift among once nothing is asking for them).
- `active_team` claim extractor in RAG still exists (fallback path).

**Verification before merging Phase 2**:

- All Phase 1 verification still passes.
- New end-to-end tests pass.
- Manual smoke across all three surfaces:
  - Slack channel still works.
  - Slack DM with saved preference routes to preferred agent; `/list` returns the right set; `/use AgentX` overrides for the thread; `/use default` clears both override and saved preference and reverts to deployment default.
  - Webex 1:1 same as Slack DM.
  - Web UI chat works for a user with team-mediated access only (regression test).
- Observe one full release window (per FR-040, demolition prerequisite): no `active_team` rejection errors in logs.

**Rollback**: Revert the Phase 2 commit. Bots resume requesting `team-<slug>` scopes; mismatch check re-enables; DM dispatch falls back to deployment default; slash commands stop responding (operator updates Slack manifest to remove them). Preferences in Mongo are preserved but unused. Web UI broadening reverses, restoring strict user-direct behavior.

### Phase 3 — Demolition

**Goal**: Delete the now-unused Keycloak surface and supporting code. Documentation rewrite.

**What lands**:

1. **BFF deletions**:
   - `ui/src/lib/rbac/keycloak-admin.ts`: remove `ensureTeamClientScope`, `selectAgentGatewayActiveTeamScope`, all helpers exclusively used by them. Keep `keycloakAdminClient` (still needed for bootstrap admin sync).
   - `ui/src/lib/rbac/keycloak-invariants.ts`: drop `audience.<client>.single_team_default` and `team_personal.dm_mode_known_limitation`. Update tests.
   - `ui/src/app/api/admin/keycloak/active-team-scope/`: delete directory (route + tests).
   - `ui/src/components/admin/KeycloakMigrationHealthPanel.tsx`: remove the `active-team-scope-action` block, the "Reconcile active-team scope" surface, the heal-state-machine code.
   - `ui/src/components/admin/invariant-explanations.ts`: remove `audienceSingleDefault` + `team_personal.dm_mode_known_limitation` entries.

2. **Bot deletions**:
   - Slack/Webex `obo_exchange.py`: delete `_apply_active_team` and the legacy `active_team` parameter signature. `impersonate_user` is now a clean wrapper.
   - Slack/Webex `app.py`: drop the now-dead `PERSONAL_ACTIVE_TEAM` import and any remaining references.

3. **RAG deletions**:
   - `rag/server/src/server/rbac.py`: delete `extract_active_team_from_claims`. `derive_team_for_request` no longer has a "claim-first" branch.

4. **Dynamic agents** (already done in Phase 2 — no Phase 3 action).

5. **Config / Helm cleanup**:
   - `docker-compose.dev.yaml`: remove `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` block.
   - Helm chart values: remove the `keycloak.rbacActiveTeamSlug` field and its template references.
   - Update `setup-caipe.sh` if it mentions the env var.

6. **Keycloak scope cleanup**:
   - Add `scripts/cleanup-team-keycloak-scopes.sh` — an operator-runnable script (kcadm-based) that lists current `team-<slug>` and `team-personal` scopes, prompts, and deletes. Idempotent; safe to re-run.
   - Add a documented one-line instruction in the release notes: *"After deploying Phase 3, run `./scripts/cleanup-team-keycloak-scopes.sh` to remove inert team scopes from your Keycloak realm. This is a one-time cleanup."*

7. **Documentation rewrite**:
   - `docs/docs/security/rbac/architecture.md`: replace the `active_team` section, the audience-cardinality section, the DM-mode advisory, and the env-var description with the new "team derivation from channel context" model. Redraw the architecture diagram.
   - `docs/docs/security/rbac/workflows.md`: replace the channel-message and DM-message sequence diagrams with the post-spec versions (matching the diagrams already drafted in this conversation).
   - `docs/docs/security/rbac/usage.md`: drop the `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` section, the "Reconcile active-team scope" troubleshooting, the DM-mode known-limitation.
   - `docs/docs/security/rbac/file-map.md`: drop entries for the cardinality invariant + heal route; add entries for `user_preferences` route, `DmAgentPreference` component, `dm_agent_resolver`.
   - `docs/docs/security/rbac/index.md`: rewrite the "what each component does" five-component summary using the merged-spec mental model.

8. **Tests updated**:
   - Delete `ui/src/app/api/admin/keycloak/active-team-scope/__tests__/route.test.ts`.
   - Update `keycloak-invariants.test.ts` — remove the audience-cardinality test block.
   - Update `KeycloakMigrationHealthPanel.test.tsx` — remove the active-team-scope-action tests.
   - Update `invariant-explanations.test.ts` — remove the deleted entries.

**Verification before merging Phase 3**:

- All Phase 1 + 2 tests still pass.
- `make lint && make test` clean across Python.
- `npm run lint && npm test` clean across UI.
- `rg "active_team" ai_platform_engineering ui` returns no production matches (only the spec doc and CHANGELOG entries).
- `rg "KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG"` returns only release-note and migration-script references.
- `rg "team-personal"` returns no production matches.
- Run `./scripts/cleanup-team-keycloak-scopes.sh` in dev stack; confirm scopes are gone; re-run all e2e tests; everything still passes.
- Open `docs/docs/security/rbac/index.md` rendered — count the words; should be ≤ 50% of pre-Phase-3 length (SC-018).

**Rollback**: Phase 3 is reversible up until `cleanup-team-keycloak-scopes.sh` is run against a production realm. Pre-script-run, `git revert` of the Phase 3 commit restores the heal button, the invariant, the env var, etc. Post-script-run, operators must re-create the scopes via the BFF (now-deleted) or by running an `init-token-exchange.sh` re-bootstrap. **Document this asymmetry in the release notes loud and clear.**

## Architectural Decisions

### A1 — Shared PDP helper (`pdp-shared.ts`) instead of duplicating "direct OR team-union" in two routes

Today's `/api/integrations/slack/channels/[wsId]/[channelId]/access-check` and `requireAgentUsePermission` each have their own gate logic. With this spec they both need "direct grant OR team-union" semantics. Choice: extract a shared `evaluateAgentAccess` helper.

**Trade-off**: One more file to keep in sync vs. logic skew between two callers. The shared helper wins on Rule of Three grounds (this is the second occurrence with a third in sight — Webex spaces).

**What we explicitly didn't extract**: per-surface envelope handling (request shape parsing, audit field set, structured logging). Each caller still does its own envelope work. Only the OpenFGA query orchestration is shared.

### A2 — Per-user OpenFGA team-list cache (60s TTL, in-process)

Team-union resolution requires `list_objects(user, member, team)`. For a user in 5 teams that's 1 call returning 5 results, then 5 `check` calls in the worst case. We could:

- (a) Cache the team list per-user for some TTL.
- (b) Run all 5 `check`s in parallel and short-circuit on first allow.
- (c) Add a server-side `agent#can_be_used_by_any_team_of_user` relation in the OpenFGA model.

**Plan**: (a) with 60s TTL, plus (b) parallelization within a single request. Defer (c) to a future optimization spec. This matches Open Question #1 in `spec.md`.

**Rationale**: At the current scale (≤50 agents per user, ≤10 teams per user), (a)+(b) gets us under the SC-016 1s budget comfortably. (c) is a model change and we want one architecture change at a time.

### A3 — Thread overrides in-process only, no TTL

Slack thread overrides could be stored in MongoDB so they survive bot restarts. They could also be replicated across bot pods for HA. They could also have a time-based TTL (e.g. 30 min inactivity) so they auto-expire.

**Plan**: None of the above. In-process, single pod, no time-based expiry. An override lives until the user explicitly changes it (`/use <other>` or `/use default`) or the bot process restarts.

**Rationale**: An override is a per-thread micro-affordance ("for this question, use AgentX"). Three reasons against each rejected alternative:

- **Persisting to Mongo**: would create a permission-cache invalidation problem (revoking a user's `can_use` while their override is persisted = stale state). In-process keeps the security model trivial: every bot restart re-evaluates from current OpenFGA truth.
- **Cross-pod replication**: today the bot is single-replica. If/when that changes we revisit; YAGNI.
- **Time-based TTL**: would surprise users mid-thread. A user who set `/use AgentX` and walked away for 35 minutes returning to find their thread silently switched back to a different agent is a worse UX than the override sticking. Users have an explicit way to reset (`/use default`), and bot restarts are infrequent + visible — those are the two natural reset points. Inactivity-based expiry is a third reset point that doesn't pull its weight.

The DM Thread Override entity (spec §Key Entities) is thus a simple `Map<thread_key, agent_id>` with no `expires_at` field.

### A4 — Saved preference is global, not per-platform

A user has ONE `dm_default_agent_id`. The same value is honored by both Slack and Webex bots.

**Rationale**: Users don't think of themselves as having different identities per platform; their preferred DM agent is a preference about the user, not the surface. If we needed platform-specific preferences later we'd add `dm_default_agent_id_slack`, `dm_default_agent_id_webex` — but YAGNI applies until proven otherwise.

### A5 — `user_preferences` collection name

We considered extending an existing collection if one had user-scoped settings. After investigation in spec authoring (Open Question #6), no such collection exists in a clean form — there's a `users` collection but it's identity-linked, not preference-shaped. A new `user_preferences` collection is the cleanest fit.

**Rationale**: Future user-scoped preferences (notification settings, theme, default Web UI agent picker order) belong in the same collection. We name it generically to leave room.

### A6 — `/list`, `/use`, `/help` are namespaced as `/caipe-list` etc. in Slack

Slack workspace operators install the bot into workspaces that may have other slash commands. Choosing `/list` risks collision with another app's `/list`. Choosing `/caipe-list` is unambiguous and consistent with the existing `/caipe` style (where it exists).

**Rationale**: One-time cost of a longer command; lifetime benefit of no surprises.

### A7 — Webex commands are plain-text with `list`, `use <agent>`, `use default`, `help`

Webex has no native slash commands. Adaptive cards with buttons would be richer but require message-edit permissions and complicate the bot's outbound posting code.

**Rationale**: Plain-text commands compose naturally with the bot's existing 1:1-handling code; they're discoverable via `help` which the bot responds to as a courtesy whenever it doesn't recognize an instruction. Adaptive cards become a future polish item; YAGNI for the first cut.

### A8 — `/use default` is the single reset command for both saved preference and thread override

Users might want to clear their saved DM preference (revert to deployment default) without leaving Slack/Webex for the Web UI. We could add a dedicated `/clear` or `/reset` command, or overload `/use` with a literal `default` argument.

**Plan**: Overload `/use` with the literal token `default`. `/use default` (or `use default` in Webex) clears BOTH any active thread override AND the user's saved preference, so the chain in FR-023 falls through to the deployment default. The bot confirms with the deployment-default agent's name so the user knows what they'll be talking to next.

**Rationale**:

- One command surface, not two. Discovering `/use` already implies the existence of a "what if I want the system to choose" option.
- `default` is a reserved token — agents cannot be named `default` (FR-029a). Cheap to enforce in the agent-creation API.
- Clearing both layers at once matches user intent: "stop personalizing my DM experience" is one decision, not two. If a user wanted to clear only the thread override and keep the saved preference, they'd issue `/use <saved-agent>` explicitly (which is essentially "set thread override = saved preference").

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Phase 2 ships, an in-flight token with `active_team=team-X` arrives, RAG's claim-first path mishandles it | Low | Medium | Dual-read window: claim-first remains in Phase 2 (deleted only in Phase 3). End-to-end test exercises both. |
| `list_objects` latency degrades for users in many teams | Medium (at scale) | Medium | A1 + A2 caching at 60s; instrumented latency; if SC-016 violated we add the OpenFGA model relation (deferred). |
| Slack manifest update fails to propagate to all workspaces in Phase 2 | Low | Low | Slash commands fail silently in unupdated workspaces; the bot still works for free-form messages and saved preferences. Operator gets a release-note action item. |
| Saved preference for an agent that gets renamed/deleted | Medium | Low | FR-024 re-validation: if `can_use` fails or agent doesn't exist, fall through to deployment default with one ephemeral notice. |
| Phase 3 demolition is irreversible after scope cleanup | Low (operator action) | High (if rolled back accidentally) | Cleanup script is gated behind explicit operator invocation, NOT auto-run on Phase 3 deploy. Release note loud-and-clear. |
| Webex command parsing collides with user message content ("use this approach") | Low | Low | Strict command prefix match: command keyword must be the first non-whitespace token in 1:1 mode or immediately after `@bot` in space mode. Anything else is treated as a chat message. |
| End-user surprise that Web UI behavior changed (team-mediated access now allowed) | Medium | Low | Release notes call this out. It's a strict broadening — no one loses access. |

## Out of Scope (deferred to future specs)

- **OpenFGA model optimization** (`agent#can_be_used_by_any_team_of_user` relation). See Open Question #1.
- **Web UI's own DM-default-equivalent picker for the Web UI chat starting agent**. Out of scope; the Web UI's existing agent picker remains the way to start a chat.
- **Cross-platform thread continuity** (Slack→Webex). Different threads.
- **Per-agent context-scoped grants** ("Agent X usable in channels but not DMs"). OpenFGA model supports it; product call about whether to expose.
- **Group-context overrides** (per-channel override of saved preference). Channels already have channel-mapped agents; out of scope to layer per-user overrides on top.

## Open Questions (resolved in this plan)

The spec listed six open questions. Resolutions:

1. **OpenFGA `list_objects` perf**: Defer optimization to future spec; Phase 1+2 ship with (a)+(b) caching and parallelization. Monitor latency.
2. **`active_team` log field deprecation**: Drop in Phase 2 with a release-note announcement in Phase 1.
3. **Keycloak `team-<slug>` scope cleanup**: Operator-runnable script `scripts/cleanup-team-keycloak-scopes.sh`. Not auto-run.
4. **Webex command syntax**: Plain-text `list`, `use <agent>`, `help` (decision A7).
5. **Web UI DM picker placement**: New section in existing Settings panel (not a new subpage).
6. **`user_preferences` collection**: New top-level collection by that exact name (decision A5).

Spec questions are now closed. Plan questions: none.

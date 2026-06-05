# Fine-Grained RBAC for `withAuth`-Only Routes Plan

## Goal

Replace the catch-all `supervisor#invoke` ("signed-in") OpenFGA gate that the
BFF currently slaps on a long tail of `/api/*` routes with **resource-specific
relations** that match each endpoint's actual semantics. The signed-in tuple
should remain the *minimum* gate but stop being the *primary* gate for
endpoints that have a real resource concept (own profile, own files, own
feedback, own credentials, supervisor chat, NPS, settings, etc.).

The trigger for this work was an audit during the
`2026-05-26-canonical-team-membership` rollout: every endpoint whose only
auth line was `withAuth(...)` resolved to `supervisor#invoke`, so the same
single tuple is gating "talk to the supervisor", "read your own user
profile", "search the user directory", and "list your own files". That
coupling is wrong on two axes: it overshoots (revoking chat access also
revokes profile read) and it undershoots (a directory search is gated by a
tuple named for the chat supervisor).

## Current State

`ui/src/lib/api-middleware.ts::resolveLegacyWithAuthRbacPolicy` maps URL
prefixes to a single `{ resource, scope }` pair that `withAuth` then runs
through `requireRbacPermission`. The current mapping (post the
2026-05-27 `platform-config` carve-out) is:

| URL prefix                                     | PDP gate                  |
|------------------------------------------------|---------------------------|
| `/api/users/debug`                             | `admin_ui#view`           |
| `/api/admin/platform-config` (GET, exception)  | `supervisor#invoke`       |
| `/api/admin/*` (other GET)                     | `admin_ui#view`           |
| `/api/admin/*` (non-GET)                       | `admin_ui#manage`         |
| `/api/users/me`, `/api/users/search`           | `supervisor#invoke`       |
| `/api/settings`, `/api/nps`                    | `supervisor#invoke`       |
| `/api/chat`                                    | `supervisor#invoke`       |
| `/api/task-configs` (GET / non-GET)            | `dynamic_agent#view` / `manage` |
| `/api/workflow-runs` (GET / non-GET)           | `dynamic_agent#view` / `invoke` |
| `/api/catalog-api-keys`                        | `skill#configure`         |
| `/api/skills/seed`                             | `admin_ui#admin`          |
| `/api/skills/token`                            | `skill#invoke`            |
| `/api/skills` / `/api/skill-templates` (rest)  | `skill#view` / `delete` / `configure` |
| **fallback**                                   | `supervisor#invoke`       |

Concrete routes that today fall through to the `supervisor#invoke` catch-all:

- `/api/users/me`, `/api/users/me/insights`, `/api/users/me/favorites`,
  `/api/users/me/agent-history`, `/api/users/me/agent-skills`,
  `/api/users/search`
- `/api/chat/conversations`, `/api/chat/conversations/[id]/*` (messages,
  share, audit), `/api/chat/audit/*`, `/api/chat/run`
- `/api/settings/*`, `/api/nps/*`
- `/api/files/list`, `/api/files/content`
- `/api/feedback`
- `/api/credentials/retrieve`, `/api/credentials/audit`,
  `/api/credentials/health`, `/api/credentials/connections/*`,
  `/api/credentials/oauth/*`, `/api/credentials/inject/*`,
  `/api/credentials/secrets/*`, `/api/credentials/oauth-connectors/*`
- `/api/ai/review`, `/api/ai/assist`
- `/api/integrations/slack/.../access-check`,
  `/api/integrations/webex/.../access-check`
- `/api/auth/my-roles`, `/api/auth/slack-link`, `/api/auth/webex-link`,
  `/api/auth/role`
- `/api/dynamic-agents/models`, `/api/dynamic-agents/available` (also has
  its own `agent#use` resource filter — see Category 3 in the audit)
- `/api/version`, `/api/a2a/[[...path]]` (a2a has its own JWT validation)

A handful of these (`/api/credentials/*`, `/api/integrations/*/access-check`,
the `/api/chat/conversations/[id]` family) do enforce real
resource-scoped checks one stack frame deeper, in their service or via
`requireConversationResourcePermission` etc. But the BFF-level gate they
share with everything else still says `supervisor#invoke`, which means:

1. **Audit signal is wrong.** `audit_event_id` rows for "read my own profile"
   look identical to "invoke supervisor with a prompt" — both
   `capability: supervisor#invoke`. Forensics on a chat-only revocation
   becomes harder.
2. **Revocation is too coarse.** Removing `organization:caipe#can_use` from
   a user kicks them out of chat *and* their own profile / feedback /
   settings. There is no way to disable just the chat surface.
3. **Mental model leaks.** New endpoints that show up under `/api/foo`
   silently inherit `supervisor#invoke`. Developers stop thinking about
   authz because "the BFF handles it" — but the gate is meaningless for
   anything that isn't the supervisor.

## Target Model

Introduce a small set of new OpenFGA relations on `organization:caipe` (or
narrower objects where appropriate) that match the way users actually
think about these surfaces. Each `withAuth`-only route file is then
mapped to one of these:

| New PDP capability                   | OpenFGA relation                              | Routes it covers                                                                 |
|--------------------------------------|-----------------------------------------------|----------------------------------------------------------------------------------|
| `self_profile#read`                  | `organization:caipe#can_read_self` (auto for every member) | `/api/users/me`, `/api/users/me/insights`, `/api/users/me/favorites`, `/api/users/me/agent-*`, `/api/auth/my-roles`, `/api/auth/role` |
| `self_profile#write`                 | same relation (writes self only)              | `PATCH /api/users/me`, `/api/auth/slack-link`, `/api/auth/webex-link`            |
| `user_directory#read`                | `organization:caipe#can_search_directory`     | `/api/users/search`                                                              |
| `chat_supervisor#invoke` (rename)    | `organization:caipe#can_chat`                 | `/api/chat/*`, `/api/a2a/*`, `/api/dynamic-agents/models`                       |
| `feedback#submit`                    | `organization:caipe#can_submit_feedback`      | `/api/feedback`, `/api/nps/*`                                                    |
| `user_settings#read` / `#write`      | `organization:caipe#can_manage_self`          | `/api/settings/*`                                                                |
| `user_files#read` / `#write`         | scoped per file: `file:<id>#owner` or `organization:caipe#can_use_files` | `/api/files/list`, `/api/files/content`                                          |
| `ai_assist#invoke`                   | `organization:caipe#can_use_ai_assist`        | `/api/ai/review`, `/api/ai/assist`                                               |
| `credential#read`/`#write` (already exists for `secret_ref` — formalise) | existing `secret_ref:<id>#reader`/`writer`  | All `/api/credentials/*` (currently delegated to service layer)                  |
| `slack_channel#check_access`         | existing per-channel relations                | `/api/integrations/slack/.../access-check`, webex equivalent                     |

Notes on the model side:

- `can_read_self`, `can_search_directory`, `can_chat`, `can_submit_feedback`,
  `can_manage_self`, `can_use_files`, `can_use_ai_assist` are all
  organization-level relations granted automatically to every member of
  `organization:caipe#member`. They become **revocable** by writing a
  tombstone tuple or by removing organization membership entirely.
- `self_profile#*` is special: the gate is "are you signed in AND is the
  resource keyed on your own subject?" — that second half stays in the
  route handler (we already do this), but the relation name makes it
  explicit.
- `credential#*` is already resource-scoped under `secret_ref:<id>` and
  enforced by the credential services. The BFF gate just needs to call
  `can_chat` for the parent "I'm allowed to use CAIPE at all" check and
  let the service do per-credential authz.

## Migration Slices

1. **Audit the current mapping.** Extend the
   `2026-05-27-fine-grained-rbac-for-withauth-routes/` spec with a
   complete file-by-file table (auto-generated from
   `resolveLegacyWithAuthRbacPolicy` plus a grep across `/api/*` for routes
   that fall through). Mark each row with one of the new capabilities.
2. **Extend the OpenFGA model.** Add the new relations under
   `organization:caipe` (and possibly `user:self`) in `deploy/openfga/model.fga`.
   Grant them by default to `member` so existing users keep working.
   Bump the OpenFGA model id and reconcile.
3. **Extend the RBAC type registry.** Add the new
   `{ resource, scope }` pairs to `RbacResource`/`RbacScope` in
   `ui/src/lib/rbac/types.ts` and teach
   `organizationRelationFor`/`resourceScopedTupleFor` how to translate them
   into tuples.
4. **Rewrite the resolver.** Replace
   `resolveLegacyWithAuthRbacPolicy` with a per-route map (not just prefix
   match) so new routes either pick an explicit capability or fail loud at
   boot. Keep `supervisor#invoke` as a deprecated fallback that logs a
   warning.
5. **Migrate routes in batches.** Per slice, update the route file *and* its
   tests to assert the new gate (mirroring the pattern just landed in
   `ui/src/lib/__tests__/api-middleware.test.ts` for the `platform-config`
   carve-out).
6. **Telemetry pass.** Update Grafana/Datadog dashboards that count
   `capability: supervisor#invoke` to split out the new capabilities so we
   can see real chat usage vs. background self-profile reads.
7. **Retire the fallback.** Once every route has an explicit mapping and
   the warning log goes quiet for two release cycles, delete the catch-all
   and make a missing entry throw at module load.

## Non-Goals

- Do not change the existing fine-grained gates for `admin_ui#*`,
  `team#*`, `agent#use`, `skill#*`, `system_config#*`, `dynamic_agent#*`,
  or `rag#*`. They are already correctly resource-scoped.
- Do not require the route handler to remove its own per-resource checks
  (`requireConversationResourcePermission`, `filterResourcesByPermission`,
  `requireResourcePermission`, etc.). Those stay; the BFF gate only
  enforces the *coarse capability* that the surface exists at all.
- Do not change the JWT shape, NextAuth session callbacks, or
  `BOOTSTRAP_ADMIN_EMAILS` semantics in this spec.
- Do not move team-membership decisions out of the canonical Mongo store
  (covered by `2026-05-26-canonical-team-membership`).

## Acceptance Checklist

- [ ] Every `/api/*` route in the BFF either calls a fine-grained
      `require*Permission` helper directly or maps to an explicit
      capability in the new resolver — no route silently inherits
      `supervisor#invoke`.
- [ ] OpenFGA model exposes the new relations and the bootstrap script
      grants them to `organization:caipe#member` so existing users keep
      working without a migration.
- [ ] Audit log capability codes match the user's mental model
      (`self_profile#read`, `chat_supervisor#invoke`, etc.) — visible in
      `audit_event_id` rows during a manual smoke run.
- [ ] A revocation test demonstrates that removing
      `can_chat` from a user blocks `/api/chat/*` and `/api/a2a/*` but
      not `/api/users/me`, `/api/settings/*`, or `/api/feedback`.
- [ ] The catch-all branch in `resolveLegacyWithAuthRbacPolicy` is
      removed (or asserts at boot) and the BFF policy resolver test in
      `ui/src/lib/__tests__/api-middleware.test.ts` covers each new
      capability with at least one allow and one deny case.
- [ ] Docs page under `docs/docs/security/rbac/` (per the
      living-docs rule in `CLAUDE.md`) lists the new capabilities,
      where they're granted, and how to revoke them.

## Risks

- **Default-allow trap.** Adding new relations and granting them to
  `member` keeps current behaviour, which means the spec's *security
  benefit* is only realised once someone actually revokes a capability.
  Document the revocation workflow before declaring the spec done.
- **Token-only callers.** The BFF gate also runs for non-browser
  callers (CLI, bots) using bearer tokens. Confirm those tokens carry
  enough OpenFGA tuples to satisfy the new gates, otherwise integrations
  silently break.
- **Bootstrap admin escape hatch.** `BOOTSTRAP_ADMIN_EMAILS` currently
  short-circuits PDP via `isBootstrapAdminEmail` in
  `requireRbacPermission`. Decide whether bootstrap admins automatically
  satisfy the new capabilities or whether they go through the same checks
  as everyone else.

## Open Questions

- Should `self_profile#read` be a relation on `organization:caipe`, or
  should we model `user:<sub>` as a first-class object with a `self`
  relation? The latter is cleaner but requires writing one tuple per
  user at signup time.
- Are `/api/files/*` actually session-scoped, or do users have a
  persistent file store? The answer determines whether we need a `file`
  type in OpenFGA.
- Does the supervisor chat capability need to be per-conversation
  (`conversation:<id>#invoke`) for the audit-log story to work, or is
  per-user enough?

## Tracking

- Precursor work: `2026-05-26-canonical-team-membership` (canonical
  team-membership reader; unblocks per-team-membership gates).
- Companion work: `2026-05-19-rag-thin-pep-openfga`,
  `2026-05-19-slack-thin-bot-bff-delegation`,
  `2026-05-16-dynamic-agent-pdp-gate` — same pattern (thin BFF gate +
  fine-grained downstream PDP), different surface.
- Issue: TBD — file once Speckit `/speckit.specify` step is run on this
  plan.

# Plan: Remove the Slack bot's direct Keycloak Admin credentials

> **Status:** Ready to implement (fresh session).
> **Author of plan:** drafted at the end of the #1781 work session.
> **Tracking:** follow-up to #1781 (PR #1788). No GitHub issue yet — create one
> (suggested title: *"Remove KEYCLOAK_SLACK_BOT_ADMIN_* — route all Slack bot
> Keycloak access through the BFF"*) and reference it in the PR.

---

## 0. How to start (READ FIRST)

**Base all changes off the branch `feat/1781-bff-provision-shell-user`** — NOT
`main`. That branch (PR #1788) introduced the canonical `provisionShellUser`
lib function, the `POST /api/admin/users/provision-shell` BFF endpoint, the
`bff_client`-based Slack-bot call pattern, and the `admin_surface:user_provisioning`
OpenFGA grant. This plan extends that exact pattern to the bot's remaining
Keycloak Admin operations. If #1788 has merged to `main` by the time you start,
branch off `main` instead and confirm those pieces are present.

```bash
# If #1788 is still open:
git fetch origin
git worktree add ../caipe-remove-slackbot-kc-admin -b feat/slack-bot-remove-direct-keycloak-admin origin/feat/1781-bff-provision-shell-user

# If #1788 already merged:
git worktree add ../caipe-remove-slackbot-kc-admin -b feat/slack-bot-remove-direct-keycloak-admin origin/main
```

Work in the new worktree. Reuse the #1781 implementation as the template for
everything below — it is the reference for endpoint shape, auth gating, the
Python `bff_client` call, error mapping, OpenFGA seeding, and test style.

**Environment notes (from the #1781 session):**
- Python venv lives at the repo root: use `/Users/kkantesa/ai-platform-engineering/.venv/bin/{python,pytest,ruff}`.
  In a fresh worktree run pytest with `PYTHONPATH=<worktree-root>` so it loads the worktree copy.
- The UI worktree has no `node_modules`. Symlink the main repo's to run jest/tsc/eslint:
  `ln -s /Users/kkantesa/ai-platform-engineering/ui/node_modules <worktree>/ui/node_modules`
  (verify `package.json` is identical first; remove the symlink before committing).
- There are 9 pre-existing Slack-bot test failures/errors from a missing
  `slack_sdk` module in the venv (`test_slack_route_no_silent_failure.py`,
  `test_error_recovery.py`). These are **unrelated** — confirm they also fail on
  `main` and ignore them.

---

## 1. Goal & motivation

Today the Slack bot reaches Keycloak two different ways:

1. **`caipe-slack-bot` service-account token** (via `ai_platform_engineering/integrations/slack_bot/utils/bff_client.py`)
   → talks to the **BFF** (Next.js UI). Authentication is the SA JWT; the BFF
   graphs it as `service_account:<sub>` and authorizes it with **OpenFGA grants**.
   This is the correct, first-party path.
2. **`KEYCLOAK_SLACK_BOT_ADMIN_*` credentials** (client `caipe-platform`, via
   `keycloak_admin.py` → `_get_admin_token` / `KeycloakAdminConfig`) → talks to
   the **Keycloak Admin REST API directly**. This is the layering smell #1781
   called out: a bot holding realm-management credentials.

#1781 moved user **creation** from path (2) to path (1). This plan moves the
**remaining** Keycloak Admin operations (lookups + attribute read/write) onto
path (1) as well, and then **deletes the `KEYCLOAK_SLACK_BOT_ADMIN_*` credentials
from the Slack bot entirely** — code, env, chart, secrets, and docs.

**Net effect:** the Slack bot holds exactly one Keycloak credential (its SA
client-credentials token), and every capability it has is an explicit, auditable
OpenFGA grant seeded in `init-token-exchange.sh`. The token does
service-to-service auth; the grants are its RBAC.

**Out of scope (do NOT touch):** the **Webex bot**. See §8.

---

## 2. Exact inventory of the Slack bot's direct-Keycloak-Admin surface

`keycloak_admin.py` exports 8 functions that use the direct-Admin path
(`_get_admin_token` + `KeycloakAdminConfig`). Their real usage:

| Function | Live Slack-bot caller(s) | Disposition |
|---|---|---|
| `get_user_by_attribute(attr, value)` | `identity_linker.py` — resolve `slack_user_id`; read `slack_preauth_prompted` / `slack_preauth_prompted_at` | **Migrate** (read-by-attribute) |
| `get_user_by_email(email)` | `identity_linker.py:177` (`auto_bootstrap_slack_user`) | **Migrate** (read-by-email) |
| `get_user_attribute(user_id, attr)` | `channel_team_mapper.py:238` — read `caipe_default_team_id` | **Migrate** (read one attribute by id) |
| `set_user_attribute(user_id, attr, value)` | `identity_linker.py` — write `slack_user_id`, `slack_preauth_prompted_at` | **Migrate** (write/merge one attribute by id) |
| `create_user_from_slack(...)` | `identity_linker.py:215` | **Already migrated in #1781** (calls BFF) |
| `remove_user_attribute(...)` | none | **Dead code — delete** |
| `fetch_user_realm_role_names(...)` | none | **Dead code — delete** |
| `get_user_by_id(user_id)` | none in Slack bot; **Webex bot only** (`webex_bot/utils/space_team_resolver.py:242`) | **Leave** (Webex out of scope; see §8) |

So the live Slack surface to migrate is **4 functions → 3 logical operations**:
- read user by attribute (exact)
- read user by email (exact)
- read a single attribute off a known user id
- write/merge a single attribute onto a known user id

The reads (by-attribute, by-email, single-attribute-by-id) all return "a user
record (id + attributes + enabled)", so they collapse into **one resolve
endpoint**. The write is **one attribute-merge endpoint**.

### Verify the inventory before coding
```bash
# Confirm no NEW callers appeared since this plan was written:
for fn in get_user_by_attribute get_user_by_email get_user_attribute set_user_attribute \
          remove_user_attribute fetch_user_realm_role_names get_user_by_id; do
  echo "=== $fn ==="
  grep -rn "\b$fn\b" ai_platform_engineering/integrations/slack_bot --include="*.py" | grep -v "/tests/" | grep -v "def $fn"
done
```
If `remove_user_attribute` / `fetch_user_realm_role_names` gained a caller, or
`get_user_by_id` gained a *Slack* caller, adjust scope accordingly.

---

## 3. The authorization constraint that shapes the design (IMPORTANT)

You **cannot** simply point the bot at existing user endpoints. Two reasons:

1. **No lookup-by-attribute or lookup-by-email endpoint exists** anywhere under
   `ui/src/app/api/`. They must be built.

2. **`requireRbacPermission` hardcodes `user:${subject}`** (see
   `ui/src/lib/api-middleware.ts` ~line 827) — it does **not** call
   `subjectFromSession`, so a service-account token is graphed as `user:<sub>`
   and can never match a `service_account:` OpenFGA grant. The same is true of
   `requireUserProfileRead` in `ui/src/lib/rbac/require-openfga.ts` (uses
   `user:${caller}`). The existing `GET`/`PUT /api/admin/users/[id]` routes use
   these gates, so the bot's SA token would 403 there.

   **Only `requireResourcePermission(session, {type, id, action})`
   (`ui/src/lib/rbac/resource-authz.ts`) uses `subjectFromSession`, which graphs
   `isServiceAccount` callers as `service_account:<sub>`.** This is the gate
   #1781's provision-shell endpoint uses, and the one you must use here.

**Therefore: new endpoints, gated with `requireResourcePermission` on an
`admin_surface:*` object, authorized by a seeded SA grant.** This mirrors #1781
exactly.

---

## 4. Design — two new BFF endpoints

Use a single admin surface object for the bot's user-directory access. Suggested
id: **`admin_surface:user_directory`** (distinct from #1781's
`admin_surface:user_provisioning`, so read/lookup access is grantable separately
from create access — least privilege). The `admin_surface` OpenFGA type already
lists `service_account` as a valid `reader` and `writer` (confirmed in
`deploy/openfga/model.fga` and `charts/.../openfga/authorization-model.json`), so
**no model change is required** — these are just new object instances.

> Naming decision to confirm with a maintainer: one surface
> (`user_directory`) for both read and write, vs. reusing
> `user_provisioning`. Recommendation: a dedicated `user_directory` surface,
> `reader` for the lookups and `writer` for the attribute merge. Keep it one
> object with two relations rather than two objects.

### 4a. `GET /api/admin/users/resolve` — exact user lookup

**File:** `ui/src/app/api/admin/users/resolve/route.ts`

**Query contract (pick ONE locator):**
- `?attribute=<name>&value=<v>` → exact attribute match (reuses lib
  `findRealmUserIdByAttribute`, then `getRealmUserById` for the full record).
- `?email=<addr>` → exact email match (reuses lib `findUserIdByEmail` +
  `getRealmUserById`).
- `?id=<sub>` → fetch by id (reuses lib `getRealmUserById`).

**SECURITY — whitelist the attribute name.** Do not allow arbitrary attribute
queries. Restrict `attribute` to an allowlist:
`{"slack_user_id", "slack_preauth_prompted", "slack_preauth_prompted_at", "caipe_default_team_id"}`.
Reject anything else with 400. (A generic "resolve any user by any attribute"
surface for a bot SA is more powerful than provision-shell and should be
explicitly bounded.)

**Response:** `{ success, data: { sub, enabled, attributes } | null }`.
Return `data: null` (200) for "no match", NOT 404 — the Python callers treat
"not found" as a normal branch, and 404 would force awkward error handling.
Include `enabled` (the bot drops disabled users) and `attributes` (the bot reads
specific attribute values off the record).

**Auth:**
```ts
const { session } = await getAuthFromBearerOrSession(request);
await requireResourcePermission(
  session,
  { type: "admin_surface", id: "user_directory", action: "read" },
  { bypassForOrgAdmin: true }
);
```

### 4b. `PATCH /api/admin/users/[id]/attributes` — merge attributes

**File:** `ui/src/app/api/admin/users/[id]/attributes/route.ts`

**Body:** `{ attributes: Record<string, string[]> }`. Merge semantics (reuse the
existing lib `mergeUserAttributes(userId, attrs)` — it already does the
Keycloak-26 user-profile round-trip that the Python `set_user_attribute`
replicates, so this is the natural server-side home for that logic).

**SECURITY — whitelist writable attribute keys.** Restrict to
`{"slack_user_id", "slack_preauth_prompted_at"}` (the only ones the bot writes).
Reject other keys with 400 so the SA can't set arbitrary identity attributes.
Also reject the server-owned `created_by` / `created_at` (consistent with
provision-shell).

**Response:** `{ success, data: { ok: true } }`.

**Auth:** same as above but `action: "write"`.

### 4c. Tests for both endpoints

Mirror `ui/src/app/api/admin/users/provision-shell/__tests__/provision-shell-route.test.ts`:
mock `next-auth`, `auth-config`, `config`, `jwt-validation` (return
`{sub, email, name, isServiceAccount:true}`), `openfga`, `audit`, the
`keycloak-admin` lib, and `mongodb`. Cover: SA authorized via the grant; org-admin
bypass; denied without grant (403); the attribute whitelist (400 on disallowed
name/key); "no match" → `data:null`/200 on resolve.

---

## 5. Python migration (`ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py`)

Follow the exact pattern `create_user_from_slack` now uses (post-#1781): build
the URL from `resolve_bff_base_url()`, headers from
`bff_headers(bearer_token=service_account_token(), json_body=...)`, call via
`httpx.AsyncClient`, map non-2xx to typed errors, parse the `{success, data}`
envelope.

Rewrite these four functions to call the new endpoints (keep their **signatures
identical** so `identity_linker.py` and `channel_team_mapper.py` are untouched):

- `get_user_by_attribute(attr, value)` → `GET /api/admin/users/resolve?attribute=&value=`,
  return `data` (the user dict) or `None`.
- `get_user_by_email(email)` → `GET /api/admin/users/resolve?email=`, return `data` or `None`.
- `get_user_attribute(user_id, attr)` → `GET /api/admin/users/resolve?id=`,
  then pull `attributes[attr][0]` from `data`; return `None` if absent.
- `set_user_attribute(user_id, attr, value)` → `PATCH /api/admin/users/{id}/attributes`
  with `{attributes: {attr: [value]}}`.

**Error handling:** these are not JIT paths, so they don't use `JitError`.
Match the *current* behavior: the existing functions call `resp.raise_for_status()`
and let `httpx.HTTPStatusError` propagate. Decide per call site whether callers
want exceptions or graceful `None`:
- `channel_team_mapper.get_effective_team` and `identity_linker` lookups already
  treat `None` as "not found / fall through". For transport/HTTP errors, preserve
  today's semantics (they currently bubble up from `raise_for_status`). Keep it
  simple: raise on unexpected status, return `None` on a clean "no match"
  (`data: null`).

**Remove:**
- `_get_admin_token`, `KeycloakAdminConfig`, `_default_config`,
  `_user_profile_roundtrip`, `_USER_PROFILE_ROUNDTRIP_FIELDS` — once nothing in
  the module uses the direct-Admin path anymore. (Double-check no remaining
  function references them.)
- `remove_user_attribute`, `fetch_user_realm_role_names` — dead code.
- The `config: KeycloakAdminConfig | None = None` parameter on the migrated
  functions (no longer meaningful). `create_user_from_slack` already accepts but
  ignores `config` for signature-compat; you may drop the param there too since
  this is an all-at-once change with no backwards-compat requirement (confirmed
  by the user for #1781). **Update all call sites accordingly.**
- The module docstring's `KEYCLOAK_SLACK_BOT_ADMIN_*` documentation block, and
  the `KeycloakAdminConfig` env-var explanation. Replace with a note that all
  Keycloak access now flows through the BFF via `bff_client`.

> NOTE: after this migration, `keycloak_admin.py` may no longer warrant its name
> (it's now a thin BFF client for user ops). Consider renaming to
> `bff_user_client.py` or folding into an existing client — but that's optional
> polish; do the functional migration first and rename only if cheap.

---

## 6. OpenFGA grant

Add the directory grants to `SA_GRANTS` in **one** file (the deploy path is a
symlink to the chart script — confirmed):
`charts/ai-platform-engineering/charts/keycloak/scripts/init-token-exchange.sh`
(`deploy/keycloak/init-token-exchange.sh` → symlink to it).

The loop splits `SA_GRANTS` on newlines. After #1781 it reads:
```sh
SA_GRANTS="reader system_config:platform_settings
writer admin_surface:user_provisioning"
```
Add:
```sh
SA_GRANTS="reader system_config:platform_settings
writer admin_surface:user_provisioning
reader admin_surface:user_directory
writer admin_surface:user_directory"
```
Update the comment block above `SA_GRANTS` to document the two new grants
(read = lookups, write = attribute merge). No OpenFGA model change needed.

Verify the parse:
```bash
SA_GRANTS="reader system_config:platform_settings
writer admin_surface:user_provisioning
reader admin_surface:user_directory
writer admin_surface:user_directory"
echo "$SA_GRANTS" | while IFS= read -r g; do [ -z "$g" ] && continue; echo "rel=[${g%% *}] obj=[${g##* }]"; done
```

---

## 7. Remove `KEYCLOAK_SLACK_BOT_ADMIN_*` everywhere (the payoff)

Only after the code no longer reads these vars. Full reference list (captured
2026-06-09 — re-grep to confirm before editing):

```bash
grep -rln "KEYCLOAK_SLACK_BOT_ADMIN" --include="*.py" --include="*.ts" \
  --include="*.yaml" --include="*.yml" --include="*.md" --include="*.sh" \
  --include="*.example" . | grep -v node_modules
```

**Code / config to update:**
- `ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py` — remove (see §5).
- `setup-caipe.sh` — drop the var prompts/exports.
- `docker-compose.dev.yaml` — remove the two env entries from the slack-bot service.
- `charts/ai-platform-engineering/values.yaml` — remove the keys.
- `charts/ai-platform-engineering/charts/slack-bot/values.yaml` — remove.
- `charts/ai-platform-engineering/charts/slack-bot/templates/deployment.yaml` — remove the env wiring.

**Tests:**
- `ai_platform_engineering/integrations/slack_bot/tests/test_keycloak_admin_config.py`
  — this entire file tests `KeycloakAdminConfig` env precedence. Once the config
  class is gone, **delete this test file** (its subject no longer exists).
- `ai_platform_engineering/integrations/slack_bot/tests/test_keycloak_admin_jit.py`
  — #1781 already rewrote this to test the BFF call. Update the remaining
  `set_user_attribute` test (currently still uses the direct-Admin
  `KeycloakAdminConfig`/token mock) to instead assert the `PATCH .../attributes`
  BFF call. Add tests for the migrated `get_user_by_*` / `get_user_attribute`
  functions (assert URL, headers, query params, envelope parsing, `None` on
  `data:null`).

**Docs (update prose; these are not load-bearing for code):**
- `docs/docs/security/rbac/{file-map,workflows,architecture}.md` — update any
  description of the Slack bot calling Keycloak Admin directly; point to the BFF
  endpoints + OpenFGA grants instead.
- `docs/docs/specs/098-enterprise-rbac-slack-ui/{operator-guide,quickstart}.md`
  and `docs/docs/specs/103-slack-jit-user-creation/*` — these are historical
  spec docs. Add a short forward-reference note ("superseded by
  <this spec / PR>; the bot no longer uses KEYCLOAK_SLACK_BOT_ADMIN_*") rather
  than rewriting history.
- `docs/releases/2026-05-26-release-0-5-0.md` and
  `scripts/migrations/0.5.0/RUN.md` — historical; leave unless a maintainer wants
  a migration note. Mention the removal in the **current** release notes / a new
  migration note instead (a removed env var is an operator-facing change).

**Operator migration note:** removing an env var that operators may have set is a
deployment-facing change. Add a short note to the release/upgrade docs:
"`KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID/SECRET` are no longer used by the Slack bot
and can be removed from values.yaml/.env; the bot now reaches Keycloak only
through the BFF using its `caipe-slack-bot` service account." Use the
`release-docs` / `update-docs` skills if appropriate.

---

## 8. Webex bot — EXPLICITLY OUT OF SCOPE

Per the user: **do not include Webex.**

- The Webex bot (`ai_platform_engineering/integrations/webex_bot/utils/space_team_resolver.py:242`)
  is the **only** remaining caller of `get_user_by_id`, via its own
  `webex_bot/utils/keycloak_admin.py` (a separate module from the Slack bot's).
- This plan touches **only** the Slack bot's `keycloak_admin.py`. Leave the
  Webex module and its credentials untouched.
- **Guard rail:** do not remove `KEYCLOAK_SLACK_BOT_ADMIN_*` in a way that breaks
  Webex. Confirm Webex uses its own creds (e.g. `KEYCLOAK_WEBEX_BOT_ADMIN_*` or a
  separate config) and is unaffected. If Webex shares any removed var, STOP and
  flag it — do not strand Webex.
  ```bash
  grep -rn "KEYCLOAK_.*ADMIN\|KeycloakAdminConfig\|_get_admin_token" \
    ai_platform_engineering/integrations/webex_bot --include="*.py"
  ```

A parallel "migrate Webex to BFF endpoints" effort can reuse the `resolve`
endpoint built here (it's bot-agnostic — `get_user_by_id` maps to
`?id=`). Note that as a future opportunity; do not implement it.

---

## 9. Testing & quality gates (run all before PR)

```bash
# Python — migrated module + linker + mapper (NOT the dead config test, which is deleted)
PYTHONPATH=<worktree> /Users/kkantesa/ai-platform-engineering/.venv/bin/pytest \
  ai_platform_engineering/integrations/slack_bot/tests/test_keycloak_admin_jit.py \
  ai_platform_engineering/integrations/slack_bot/tests/test_identity_linker_jit.py \
  ai_platform_engineering/integrations/slack_bot/tests/ -q
/Users/kkantesa/ai-platform-engineering/.venv/bin/ruff check ai_platform_engineering/integrations/slack_bot/

# UI (symlink node_modules first)
cd ui
npx jest src/app/api/admin/users           # resolve + [id]/attributes + provision-shell
npx tsc --noEmit -p tsconfig.json
npx eslint src/app/api/admin/users/resolve/route.ts \
           "src/app/api/admin/users/[id]/attributes/route.ts" \
           src/lib/rbac/keycloak-admin.ts

# RBAC matrix validator (resource-permission routes are NOT required in the matrix,
# but run it to confirm nothing regressed)
/Users/kkantesa/ai-platform-engineering/.venv/bin/python scripts/validate-rbac-matrix.py
```

Expected: all green except the 9 pre-existing `slack_sdk` failures (§0).
Remember to **delete the node_modules symlink** before committing.

---

## 10. Risks & decisions to confirm with a maintainer

1. **Attribute whitelist scope.** Recommended: lock both endpoints to the known
   Slack attribute names (§4a/§4b). A generic query/write surface for a bot SA is
   a larger attack surface. Confirm the allowlist is acceptable (it must include
   `caipe_default_team_id` for the channel-team path).
2. **Surface naming.** `admin_surface:user_directory` (new) vs. reusing
   `admin_surface:user_provisioning`. Recommended: new, for least privilege.
3. **`resolve` "not found" = 200 `data:null`** (not 404). Keeps the Python
   callers' control flow clean. Confirm reviewers are OK with that convention.
4. **Error semantics on transport failure.** The current direct-Admin functions
   `raise_for_status()`. Preserve "raise on unexpected, `None` on clean no-match"
   so callers behave identically. Watch `channel_team_mapper` (a failure there
   should degrade gracefully, not crash team resolution).
5. **Module rename** (`keycloak_admin.py` → BFF client) — optional; skip if not cheap.

---

## 11. File-by-file checklist

**New:**
- [ ] `ui/src/app/api/admin/users/resolve/route.ts`
- [ ] `ui/src/app/api/admin/users/resolve/__tests__/resolve-route.test.ts`
- [ ] `ui/src/app/api/admin/users/[id]/attributes/route.ts`
- [ ] `ui/src/app/api/admin/users/[id]/attributes/__tests__/attributes-route.test.ts`

**Modified:**
- [ ] `ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py` (migrate 4 fns, delete dead code + config/token plumbing + docstring)
- [ ] `ai_platform_engineering/integrations/slack_bot/tests/test_keycloak_admin_jit.py` (update `set_user_attribute` test → BFF; add lookup tests)
- [ ] `charts/ai-platform-engineering/charts/keycloak/scripts/init-token-exchange.sh` (two new `SA_GRANTS` rows + comment)
- [ ] `setup-caipe.sh`, `docker-compose.dev.yaml`, `charts/.../values.yaml` (x2), `charts/.../slack-bot/templates/deployment.yaml` (drop env)
- [ ] RBAC + release/migration docs (prose updates per §7)

**Deleted:**
- [ ] `ai_platform_engineering/integrations/slack_bot/tests/test_keycloak_admin_config.py`
- [ ] `KEYCLOAK_SLACK_BOT_ADMIN_*` references everywhere they're set/consumed

**Verify untouched:** `webex_bot/**`, Webex credentials.

---

## 12. Commit / PR

- Conventional commit, e.g.
  `refactor(slack): route all Slack-bot Keycloak access through the BFF; drop direct admin creds`.
- DCO: `git commit -s` only after explicit human sign-off in the session (per
  `CLAUDE.md`). Add `Assisted-by: Claude:<model>`. No `Co-Authored-By`.
- Reference the new tracking issue and note it builds on #1788.
- Use the `pr-caipe` skill to open the PR.

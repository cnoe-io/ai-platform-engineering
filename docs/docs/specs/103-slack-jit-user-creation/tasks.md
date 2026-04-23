# Tasks: Slack JIT Keycloak user creation with web-UI auto-merge

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)
**Branch**: `prebuild/feat/slack-jit-user-creation`

## Format

`[ID] [P?] [Story] [Type] Description`

- **[P]** = can run in parallel with other [P] tasks of the same phase
  (different files, no dependencies)
- **[Story]** = which user story (US1–US5) the task primarily serves;
  `INFRA` = infrastructure shared by all stories
- **[Type]** = `code | test | config | docs | verify`

---

## Phase 1 — Foundational realm changes (blocks every code path)

The slack-bot uses a **single** Keycloak admin client (`caipe-platform`)
for both lookup and JIT creation. Phase 1 ensures its service account
holds exactly `{view-users, query-users, manage-users}` — no more, no
less — and confirms the existing IdP auto-merge flow still works.

- [x] **T001** [INFRA] [config] In
      `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh`,
      add an idempotent function `_ensure_caipe_platform_user_roles()`
      that:
      a) Resolves `service-account-caipe-platform`'s user ID.
      b) Resolves the `realm-management` client's internal ID.
      c) `GET`s the current client-role-mapping for that service account.
      d) `POST`s any of `{view-users, query-users, manage-users}` that are
         missing.
      e) Echoes the final mapping at INFO so the script's logs serve as
         the audit trail.
      The function MUST NOT delete other roles (operators may have added
      legitimate ones); R-9 in `plan.md` is handled by a periodic CI
      assertion, not by destructive cleanup at boot.

- [x] **T002** [INFRA] [config] In `deploy/keycloak/realm-config.json`
      and `charts/ai-platform-engineering/charts/keycloak/realm-config.json`,
      update the `service-account-caipe-platform` user's `clientRoles`
      block to include all three roles:
      ```json
      "clientRoles": {
        "realm-management": [
          "view-users",
          "query-users",
          "manage-users"
        ]
      }
      ```
      This is the source-of-truth for fresh realm imports; T001 handles
      drift correction on already-running clusters.

- [x] **T003** [INFRA] [verify] **The IdP auto-merge flow is already
      configured.** The existing `init-idp.sh` (lines ~328-476) creates
      a "silent broker login" flow with `idp-create-user-if-unique` +
      `idp-auto-link` (both ALTERNATIVE), sets it as the IdP's
      `firstBrokerLoginFlowAlias`, and configures `trustEmail=true` +
      `syncMode=FORCE`. No new code needed; just verify on a fresh
      `make e2e-test-minimal` that:
      a) The flow `silent-broker-login` (or whatever `SILENT_FLOW_ALIAS`
         resolves to) exists and contains both executions ALTERNATIVE.
      b) The IdP entry's `firstBrokerLoginFlowAlias` matches.
      c) `trustEmail=true`, `syncMode=FORCE` on the IdP entry.

- [x] **T004** [INFRA] [verify] Run `make e2e-test-minimal-down && make
      e2e-test-minimal`. Assert:
      a) `service-account-caipe-platform`'s realm-management mapping
         contains all three of `{view-users, query-users, manage-users}`.
      b) No new `caipe-slack-bot-provisioner` client exists (we
         deliberately did not introduce one).
      c) The Duo (or current placeholder) IdP entry has `trustEmail=true`,
         `syncMode=FORCE`, and the broker-login flow has the auto-set step.
      Capture the verification commands inline in this task block for
      future operators:
      ```bash
      KC_TOKEN=$(curl -sf -d "client_id=admin-cli" -d "username=admin" \
        -d "password=admin" -d "grant_type=password" \
        http://localhost:8080/realms/master/protocol/openid-connect/token \
        | jq -r .access_token)
      SA_ID=$(curl -sf -H "Authorization: Bearer $KC_TOKEN" \
        "http://localhost:8080/admin/realms/caipe/users?username=service-account-caipe-platform" \
        | jq -r '.[0].id')
      RM_ID=$(curl -sf -H "Authorization: Bearer $KC_TOKEN" \
        "http://localhost:8080/admin/realms/caipe/clients?clientId=realm-management" \
        | jq -r '.[0].id')
      curl -sf -H "Authorization: Bearer $KC_TOKEN" \
        "http://localhost:8080/admin/realms/caipe/users/$SA_ID/role-mappings/clients/$RM_ID" \
        | jq -r '.[].name' | sort
      # Expected: manage-users, query-users, view-users
      ```

---

## Phase 2 — JIT helper in keycloak_admin (US1, US5 — depends on Phase 1)

- [x] **T006** [US1] [code] In
      `ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py`,
      reuse the existing `KeycloakAdminConfig` (no new dataclass). All
      JIT calls use the same `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID` /
      `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET` credentials already
      consumed by lookups. Document this in the module docstring with a
      pointer to spec FR-004/FR-005 explaining why we deliberately
      avoided a second client.

- [x] **T007** [US1] [code] In the same file, add
      `async def create_user_from_slack(slack_user_id: str, email: str)
      -> str` that:
      a) acquires a token via the existing admin token cache (no new
         token plumbing),
      b) `POST /admin/realms/{realm}/users` with the body specified in
         `spec.md` FR-003,
      c) parses the `Location` header to obtain the new user's UUID,
      d) on `409 Conflict`, re-queries by email and returns the existing
         user's UUID (FR-008),
      e) on `401`/`403`, raises `JitAuthError` / `JitForbiddenError`
         with `error_kind` field for caller to log,
      f) restricts any follow-up `PUT /users/{id}` to the freshly-returned
         UUID only (helper-function-shape mitigation per spec M1) — the
         caller never gets a generic "PUT any user" surface,
      g) returns the `kc_user_id` UUID string on success.

- [x] **T008** [US1, US5] [code] Add a small `email_masking.py` module
      with `mask_email(email: str) -> str` returning
      `"<first_3_chars>***@<domain>"`. Used by FR-010, FR-011 logs.

- [x] **T009** [US1] [test] Create
      `ai_platform_engineering/integrations/slack_bot/tests/test_keycloak_admin_jit.py`
      with the following tests:
      a) `test_create_user_from_slack_uses_admin_credentials`
         (asserts no separate provisioner env var is read)
      b) `test_create_user_from_slack_posts_correct_body` (httpx mock)
      c) `test_create_user_from_slack_handles_409_by_requery`
      d) `test_create_user_from_slack_raises_on_401`
      e) `test_create_user_from_slack_raises_on_403`
      f) `test_create_user_from_slack_secret_never_in_logs` (uses
         `SecretRedactionFilter` and asserts captured log records)
      g) `test_post_users_url_targets_only_freshly_created_id`
         (regression on M1 helper-shape)

---

## Phase 3 — JIT branch in identity_linker (US1, US3, US4, US5)

- [x] **T010** [US1, US3] [code] In
      `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py`,
      add module-level constants:
      `SLACK_JIT_CREATE_USER = os.environ.get("SLACK_JIT_CREATE_USER", "true").lower() == "true"`
      `_JIT_ALLOWED_DOMAINS = [d.strip().lower() for d in
        os.environ.get("SLACK_JIT_ALLOWED_EMAIL_DOMAINS", "").split(",") if d.strip()]`
      Document precedence in module docstring (matches plan.md §7).

- [x] **T011** [US1, US3] [code] In `auto_bootstrap_slack_user`, replace
      the current `if kc_user is None: return None` block with:
      a) If JIT off → return `None` (caller's off-path will send link).
      b) If JIT on but `_JIT_ALLOWED_DOMAINS` is non-empty and email's
         domain is not in the list → log structured WARNING (FR-011,
         `error_kind=domain_excluded`) and return `None`.
      c) If JIT on and the existing admin client config
         (`KeycloakAdminConfig.from_env_or_none()`) is `None` → log one
         WARNING per process startup (suppress repeat), return `None`.
      d) Else call `await create_user_from_slack(slack_user_id, email)`,
         then `await set_user_attribute(...)` to add the
         `slack_user_id` attribute (already in POST body but defensive),
         then log INFO `slack_jit_user_created` per FR-010, return the
         new `kc_user_id`.
      e) On any `JitAuthError`/`JitForbiddenError`/`httpx.HTTPError` in
         (d), log WARNING per FR-011 and return `None` (fall through to
         the off-path linking flow).

- [x] **T012** [US1, US3, US4, US5] [test] Create
      `ai_platform_engineering/integrations/slack_bot/tests/test_identity_linker_jit.py`:
      a) `test_jit_off_returns_none_does_not_call_create_user`
      b) `test_jit_on_lookup_miss_calls_create_user_and_returns_id`
      c) `test_jit_on_lookup_hit_short_circuits` (no regression of
         existing email-match path)
      d) `test_jit_on_admin_unconfigured_warns_once_returns_none`
      e) `test_jit_on_create_user_401_returns_none_logs_warning`
      f) `test_jit_on_create_user_403_returns_none_logs_warning`
      g) `test_jit_on_create_user_409_returns_existing_user_id`
      h) `test_jit_domain_allowlist_excludes_non_listed_domain`
      i) `test_jit_domain_allowlist_empty_means_allow_all`
      j) `test_log_record_event_field_is_slack_jit_user_created`
         (FR-010 stable field)
      k) `test_log_record_does_not_contain_admin_secret`
         (uses `SecretRedactionFilter`)

---

## Phase 4 — Off-path message fix (US3 — independent of Phase 2/3)

- [x] **T013** [US3] [code] In
      `ai_platform_engineering/integrations/slack_bot/app.py`, locate the
      `if rbac_status == "unlinked":` block (around line 395). In the
      `else:` branch (line 410-415, the dead-end "could not be auto-linked"
      message), replace with: `linking_url =
      asyncio.run(generate_linking_url(slack_user_id))` and a `text` that
      tells the user "Click here to link your account before using this
      feature" with the URL. Keep the `_linking_prompt_sent` cooldown
      logic. Now both `SLACK_FORCE_LINK=true` and "JIT failed/unconfigured"
      paths produce the same actionable user experience.

- [x] **T014** [US3] [test] Create
      `ai_platform_engineering/integrations/slack_bot/tests/test_app_offpath_message.py`:
      a) `test_unlinked_with_jit_off_sends_linking_url`
      b) `test_unlinked_with_jit_on_failure_sends_linking_url`
      c) `test_message_does_not_contain_email_match_dead_end_text`
      d) `test_cooldown_still_applies_to_offpath_message`
      Use `mocker.patch` on `chat_postEphemeral` and assert the captured
      `text` arg contains `"/api/auth/slack-link?"`.

---

## Phase 5 — Compose + Helm wiring (US1, US3 — runs after Phase 1–4)

No new Keycloak Secret resources, no new chart values for credentials.
The slack-bot already mounts `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID` and
`KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET`; JIT reuses them. The only
new env vars are the **feature flags** `SLACK_JIT_CREATE_USER` and
`SLACK_JIT_ALLOWED_EMAIL_DOMAINS`.

- [x] **T015** [INFRA] [config] In `docker-compose.dev.yaml`, in the
      `slack-bot` service env block, add:
      ```
      SLACK_JIT_CREATE_USER: ${SLACK_JIT_CREATE_USER:-true}
      # SLACK_JIT_ALLOWED_EMAIL_DOMAINS: ""   # CSV; empty = allow all
      ```
      Add an inline comment that JIT reuses the existing
      `KEYCLOAK_SLACK_BOT_ADMIN_*` credentials (no new secret to wire).

- [x] **T016** [INFRA] [config] In `.env.example`, add a commented
      documentation block for `SLACK_JIT_CREATE_USER` and
      `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`. Do NOT set them in `.env`
      (preserves operator opt-in for any non-default behavior).

- [x] **T017** [INFRA] [config] In
      `charts/ai-platform-engineering/charts/slack-bot/values.yaml`, add:
      ```
      jit:
        createUser: true
        # allowedEmailDomains: []  # list of domains; empty = allow all
      ```

- [x] **T018** [INFRA] [config] In
      `charts/ai-platform-engineering/charts/slack-bot/templates/deployment.yaml`,
      under `env:`, add:
      a) `SLACK_JIT_CREATE_USER` from `.Values.jit.createUser`
      b) `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` from
         `.Values.jit.allowedEmailDomains | join ","` (only if non-empty;
         omit the env var entirely when empty so unit tests see "unset"
         not "empty string")

- [x] **T019** [INFRA] [verify] `helm template
      charts/ai-platform-engineering --show-only
      charts/slack-bot/templates/deployment.yaml`
      (default values; then with `--set slackBot.jit.createUser=false`;
      then with `--set 'slackBot.jit.allowedEmailDomains={corp.com,partner.com}'`)
      — assert all three render without error and the deployment env
      section contains the expected variables in each path.

---

## Phase 6 — Documentation (runs in parallel with Phase 5; required by repo CLAUDE.md rule)

- [x] **T023** [P] [docs] Update
      `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md`:
      a) New row in the env-var table for the slack-bot component
      b) New diagram for the JIT auto-bootstrap flow + auto-merge on web
         sign-in
      c) New entry in the file map for each of the new code/config files

- [x] **T024** [P] [docs] Update
      `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md`:
      add a new section "Enabling JIT user creation" with: when to enable
      it, when not to, how to opt out, how to set
      `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`, how to identify JIT users
      after the fact, how to cleanup, what to expect on Duo first-login
      auto-merge.

- [x] **T025** [P] [docs] Update
      `docs/docs/security/rbac/architecture.md`: add a "Slack JIT
      shell-user creation" subsection under the existing "Slack bot →
      Keycloak Admin REST API" block, documenting privilege separation
      the single-client model (with the R-8 trade-off acknowledgment)
      and the IdP flow change.

- [x] **T026** [P] [docs] Update
      `docs/docs/security/rbac/file-map.md`: entries for
      `keycloak_admin.py:create_user_from_slack`, `email_masking.py`,
      and `init-idp.sh:_ensure_caipe_platform_user_roles`.

- [x] **T027** [P] [docs] Update
      `docs/docs/security/rbac/secrets-bootstrap.md`: in the existing
      slack-bot admin-client subsection, document that the same secret
      now also authorizes JIT user creation (and reference R-8 in
      `plan.md` for the rationale). No new secret-bootstrap section is
      required.

- [x] **T028** [P] [docs] Update
      `docs/docs/specs/098-enterprise-rbac-slack-ui/quickstart.md`:
      add a commented stanza for `SLACK_JIT_CREATE_USER` /
      `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` and a one-line note that JIT
      defaults to ON in dev and reuses the existing slack-bot admin
      credentials.

- [x] **T029** [docs] Create
      `docs/docs/specs/103-slack-jit-user-creation/research.md`
      capturing: decisions and rejected alternatives (single-client
      `caipe-platform` chosen over a dedicated `caipe-slack-bot-provisioner`;
      auto-merge vs confirm; default ON vs OFF), references to
      Keycloak docs sections used.

- [x] **T030** [docs] Create
      `docs/docs/specs/103-slack-jit-user-creation/security-review.md`
      with a STRIDE walkthrough and the threat catalog from spec.md §7
      expanded.

---

## Phase 7 — Live verification (runs last; depends on Phases 1–5)

- [ ] **T031** [US1, US2] [verify] In a clean stack, send a Slack DM
      from a real corporate email that does NOT exist in the realm.
      Assert:
      a) Slack response is the normal bot reply (or a normal RBAC denial
         such as "channel has no agent mapping"), NOT the dead-end
         "could not be auto-linked" message.
      b) Keycloak admin UI shows a new user with `created_by=slack-bot:jit`,
         `slack_user_id=<U…>`, `enabled=true`, `emailVerified=true`,
         no `credentials` array, no `requiredActions`.
      c) `docker logs slack-bot` contains exactly one
         `slack_jit_user_created` log line.

- [ ] **T032** [US2] [verify] Sign in to the web UI as the same person
      via Duo (or simulated equivalent if Duo is not yet wired). Assert:
      a) Keycloak still has exactly one user for that email.
      b) The user now has both the `slack_user_id` attribute (preserved
         from T031) and a `federatedIdentities` entry pointing at the
         upstream IdP.
      c) The web UI did NOT show a "We found an existing account, link?"
         confirmation prompt.

- [ ] **T033** [US3] [verify] Set `SLACK_JIT_CREATE_USER=false` and
      restart slack-bot. Repeat T031's setup with a different unknown
      email. Assert:
      a) The bot's ephemeral message contains `/api/auth/slack-link?`.
      b) No new Keycloak user was created.

- [ ] **T034** [US5] [verify] Temporarily strip `manage-users` from
      `service-account-caipe-platform` (so JIT now hits 403 even though
      lookups still work) and restart slack-bot. Send a Slack DM from a
      third unknown email. Assert:
      a) The bot's ephemeral message contains `/api/auth/slack-link?`
         (fall-through to link flow).
      b) `docker logs slack-bot` contains a single WARNING with
         `event=slack_jit_user_creation_failed` and
         `error_kind=forbidden` (and no `auth_failure`, since the token
         itself is still valid for lookups).
      c) No new Keycloak user was created.
      Then re-add `manage-users` and re-run T031 to confirm the
      happy-path is restored.

- [ ] **T035** [US4] [verify] Run `kc-export` (or curl the admin API)
      to list all users with `q=created_by:slack-bot:jit`. Assert the
      list matches T031 + T034 expectations exactly.

---

## Dependencies

```
T001,T002,T003 ──► T004 (Phase 1 verify)
        │
        ├──► T006,T007,T008 ──► T009 (Phase 2)
        │           │
        │           └──► T010,T011 ──► T012 (Phase 3)
        │
        └──► T013 ──► T014 (Phase 4, independent)

(Phases 2, 3, 4 may interleave on different files; T012 needs T011 done)

T015,T016,T017,T018 ──► T019 (Phase 5 verify, runs after Phase 4)

T023..T028 [P] ──► T029,T030 (Phase 6, parallel docs; can start as soon as plan is fixed)

T004 + T019 + Phase 4 done ──► T031..T035 (Phase 7 live verify)
```

## Parallelization opportunities

- **[P] tasks within Phase 6** — six docs files, six different paths,
  no inter-file dependency. Send to a single doc-update commit at end
  of phase.
- **Phase 4 (T013/T014)** runs independently of Phases 2/3. Can be a
  small standalone PR if you want to ship the dead-end-message fix
  before the rest of JIT lands.
- **Phase 5 chart wiring tasks (T015..T018)** touch different files and
  can be split among reviewers.

## Definition of done (PR-level)

- All tests in T009, T012, T014 pass under `make test-supervisor`.
- `make lint` clean.
- `helm template` renders for default + JIT-off + allowedEmailDomains
  populated paths.
- All five user stories have a verified [verify] task ticked.
- All six doc files updated in the same PR.
- Conventional commit + DCO + `Assisted-by:` trailer present on every
  commit.
- Spec, plan, tasks, research, security-review files all merged together.

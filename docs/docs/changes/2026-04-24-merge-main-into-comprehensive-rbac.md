# 2026-04-24 — Merge `origin/main` (v0.4.1) into `prebuild/feat/comprehensive-rbac`

## Status

Accepted

## Context

The `prebuild/feat/comprehensive-rbac` branch (PR #1257) had diverged
significantly from `origin/main`:

- **233 commits ahead** of main (the comprehensive RBAC rollout: spec 098
  enterprise RBAC, spec 102 PDP cache + decision metrics, spec 103 Slack
  JIT user provisioning, spec 104 team-scoped RBAC with `active_team`
  JWT claim, OBO token exchange, AGW CEL policies, etc.)
- **12 commits behind** main since our last sync via merge commit
  `d4e1255f` ("Merge branch 'release/0.4.0' into
  prebuild/feat/comprehensive-rbac"). Those 12 commits were the v0.4.0
  release squash (`206066c0`) plus a handful of follow-up fixes
  (`5e3fbd34` slack escalation, `5a2aa691` admin feedback, `3498bf7f`
  skills install UX) and version bumps to v0.4.1.

User chose merge over rebase to:

- Preserve the full RBAC commit history for archaeology / blame.
- Keep the recovery story simple (`git reset --hard ORIG_HEAD` if
  anything went sideways).
- Avoid 233 sequential rebase conflict screens.

The merge produced **49 file-level conflicts** plus a few auto-applied
adds/deletes from main that did not conflict.

## Decision

Resolve all 49 conflicts in batches, biased toward preserving the
comprehensive RBAC implementation on HEAD because main's v0.4.0 release
squash (`206066c0`) had stripped many of our RBAC additions.

### Resolution by batch

#### Batch 1 — low-risk (lockfiles, docs, Chart.yaml) — 12 files

| File | Resolution | Why |
|---|---|---|
| `charts/ai-platform-engineering/Chart.yaml` and 3 sub-chart `Chart.yaml` files | took `origin/main` | upstream version bumps to 0.4.1 |
| `scripts/migrations/0.4.0/RUN.md` | took `origin/main` | main has a substantially expanded migration guide (new "Step 4: Migrate slack_meta to flat metadata keys") |
| `docs/docs/specs/shared-conversation-api/plan.md` | took `origin/main` | trivial HTML escaping fix (`<` → `&lt;`) for MDX build |
| `AGENTS.md`, `CLAUDE.md` | kept HEAD initially, then patched (see Batch 3) | needed to remove references to the deleted DCO skill |
| `uv.lock`, `package-lock.json` (3 files) | took `origin/main` | will regenerate via `uv sync` / `npm install` after merge to pick up local-branch deps |

#### Batch 2 — config / infra (Makefile, docker-compose, Helm values) — 6 files

| File | Resolution | Why |
|---|---|---|
| `Makefile` | took HEAD | added `test-rbac-*` targets, `E2E_PROFILES`, `E2E_COMPOSE_ENV` for spec 102 RBAC e2e suite |
| `config/app-config.yaml` | took HEAD | expanded comments + seed config for `models: []` and `mcp_servers: []` |
| `charts/ai-platform-engineering/values.yaml` | manual merge | preserved HEAD content + accepted main's `skills-bootstrap` mount + `SKILLS_BOOTSTRAP_FILE` env var |
| `charts/.../slack-bot/values.yaml` | took HEAD | kept `SLACK_JIT_CREATE_USER`, `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`, `oauth2`, and `keycloakAdmin` blocks |
| `charts/.../slack-bot/templates/deployment.yaml` | took HEAD | conditional `env` block for `OAUTH2_CLIENT_SECRET` and Keycloak admin client secret |
| `docker-compose.dev.yaml` | took HEAD | RBAC env vars on `caipe-ui`, `AGENT_GATEWAY_URL` and `DA_REQUIRE_BEARER` on `dynamic-agents`, watchfiles hot-reload wrapper for `slack-bot`, plus a typo fix (`rag-server` vs main's `ragserver` in `depends_on`) |

#### Batch 3 — modify/delete conflicts — 3 files

| File | Resolution | Why |
|---|---|---|
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/agents.py` | kept HEAD (added file) | this file was authored on our branch and never existed on main; main's "delete" side of the conflict was spurious |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/config.yaml` | kept HEAD (added file) | same as above |
| `skills/dco-ai-attribution/SKILL.md` | honored main's deletion (user decision) | main explicitly removed this skill in `0db78030` ("chore(skills): remove dco-ai-attribution skill, keep simple DCO rule"); user opted to follow main and inline the policy in `AGENTS.md` and `CLAUDE.md`. References to the file in `AGENTS.md`, `CLAUDE.md`, and `docs/docs/specs/103-slack-jit-user-creation/plan.md` were updated to point to `AGENTS.md` instead. |

#### Batch 4 — `dynamic_agents/` + `slack_bot/` Python — 18 files

All resolved with `git checkout --ours`.

**Rationale:** main's only post-`d4e1255f` commits touching these
directories were:

- `206066c0` (v0.4.0 release squash — which had *removed* RBAC code we
  added before submitting upstream)
- `5e3fbd34` (slack humble-followup + escalation policy fix — see
  follow-up note below)

Taking `--ours` preserves:

- spec 102 PDP cache + decision metrics
- JWT-to-AGW forwarding (spec 102 P8)
- spec 103 Slack JIT user provisioning, log redaction, email masking
- spec 104 active-team rollout across all services
- configurable middleware system
- delta thread context + PATCH metadata + Slack permalink in admin UI
- shared conversation API migration

Files (all `--ours`):
`pyproject.toml`, `auth/access.py`, `auth/auth.py`, `config.py`,
`main.py`, `models.py`, `routes/__init__.py`, `services/agent_runtime.py`,
`services/middleware.py`, `services/mongo.py`, `slack_bot/app.py`,
`slack_bot/sse_client.py`, `slack_bot/tests/test_sse_client.py`,
`slack_bot/utils/ai.py`, `slack_bot/utils/config_models.py`,
`slack_bot/utils/escalation.py`, `slack_bot/utils/session_manager.py`,
`slack_bot/utils/utils.py`.

**Follow-up needed:** PR #1277 (`5e3fbd34` — humble-followup prompt fix
and escalation policy field) is **not** in HEAD. Cherry-pick it as a
separate commit after the merge stabilizes.

#### Batch 5 — UI (TypeScript / TSX) — 13 files

All resolved with `git checkout --ours`.

**Rationale:** Same as Batch 4. Main's v0.4.0 squash had removed
RBAC enforcement we added. The clearest example is
`ui/src/app/api/chat/conversations/route.ts`, where main removed
`requireRbacPermission(session, 'supervisor', 'invoke')` and the
explanatory comment block — exactly the call we need for spec 098
enforcement.

Files (all `--ours`):
`api/chat/conversations/route.ts`,
`api/dynamic-agents/assistant/suggest/route.ts`,
`api/mcp-servers/probe/route.ts`,
`components/chat/DynamicAgentChatPanel.tsx`,
`components/dynamic-agents/DynamicAgentEditor.tsx`,
`components/dynamic-agents/MiddlewarePicker.tsx`,
`instrumentation.ts`, `lib/da-proxy.ts`, `lib/seed-config.ts`,
`lib/streaming/agui-adapter.ts`, `lib/streaming/custom-adapter.ts`,
`lib/streaming/index.ts`, `types/dynamic-agent.ts`.

### Auto-applied (no conflict)

Main brought new files / deletions that git applied without conflict:

- **Added** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/metrics/`
  (`__init__.py`, `agent_metrics.py`, `agent_middleware.py`,
  `http_middleware.py`) and `routes/middleware.py`. **Currently orphan**
  in our HEAD (no `import` references). Left in place to avoid lossy
  merge; will be either wired in or removed in a follow-up.
- **Removed** `ai_platform_engineering/integrations/slack_bot/utils/langfuse_client.py`.
  Verified HEAD does not import it.

## Verification

Post-merge smoke checks (all green):

- `make lint` — clean (Ruff: 252 packages, all checks passed)
- `python -c "import dynamic_agents.main; ..."` from
  `ai_platform_engineering/dynamic_agents/` — clean
- `python -c "from utils import ai, escalation, ...; import sse_client"`
  from `ai_platform_engineering/integrations/slack_bot/` — clean
- `npx tsc --noEmit` from `ui/` — clean

Outstanding (run before push):

- `make test` — full Python test suite
- `make caipe-ui-tests` — UI Jest suite
- Rebuild all images + restart containers — runtime smoke

## Consequences

### Positive

- All comprehensive RBAC work preserved.
- Branch is back in sync with `origin/main` (12 absorbed commits).
- Recovery is trivial: backup branch
  `backup/comprehensive-rbac-pre-merge-20260424-091821` points at the
  pre-merge HEAD.
- Conflict resolutions recorded via `rerere` so re-merging origin/main
  later will be cheaper.

### Negative / Follow-ups

- **Lockfiles taken from main.** Run `uv sync` (per-subproject) and
  `npm install` (in `ui/`) to regenerate against our actual deps before
  rebuilding images.
- **Orphan modules from main** (`dynamic_agents/metrics/*`,
  `routes/middleware.py`) are unused. Decision needed: wire in or
  delete.
- **PR #1277 (humble-followup + escalation policy field)** must be
  cherry-picked as a separate commit.
- The merge commit is large (49 conflict resolutions); careful PR
  review needed.

## Recovery procedure

If we discover broken behavior in the merge commit (`e67a3d5e`):

```bash
# 1. Restore HEAD to pre-merge state (drops the merge commit only;
#    keeps everything we did before)
git reset --hard backup/comprehensive-rbac-pre-merge-20260424-091821

# 2. Force-with-lease push to undo the merge on the PR
git push --force-with-lease origin prebuild/feat/comprehensive-rbac
```

Or, more granularly, revert just the merge commit:

```bash
git revert -m 1 e67a3d5e
git push origin prebuild/feat/comprehensive-rbac
```

## References

- PR #1257 — comprehensive RBAC
- Merge commit: `e67a3d5e`
- Backup branch: `backup/comprehensive-rbac-pre-merge-20260424-091821`
- Last upstream sync before this merge: `d4e1255f` (release/0.4.0)
- Spec 098 — Enterprise RBAC + Slack + UI
- Spec 102 — PDP cache + decision metrics
- Spec 103 — Slack JIT user provisioning
- Spec 104 — Team-scoped RBAC with `active_team`

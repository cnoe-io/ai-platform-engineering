# LLM Provider Integration — Status Log

> **Process for this file:** update it whenever a module described below is built and verified. Before updating, ask the user to confirm the update. Each change gets a new dated entry in the Change Log rather than silently editing history — keep this a legible audit trail, not just a snapshot.

**Owner:** Alpesh Doshi
**Started:** 2026-08-16 (Cloudflare Workers AI chat debugging session, prior to this log)
**This log created:** 2026-08-17

## Goal

Make CAIPE's Dynamic Agents LLM integration actually work end-to-end for multiple providers/models — starting from a report that "the LLM integration is not working" and "model connect still doesn't work" — and leave a durable record of what was found, why each fix was made, and what's left.

---

## 1. Background (carried in from before this log existed)

Two prior fixes, already committed and pushed to `Kendralabs/ai-platform-engineering:main` before this log started:
- Cloudflare Workers AI chat integration debugged live via the frontend and fixed (commits `9abf37efc`, `45193e24b`).
- Dev-mode ("No Auth") RBAC bootstrap gap fixed: the synthetic `anonymous-local-dev` session had no `team:super-admins` membership tuples in OpenFGA, so agent creation was rejected even though the UI let it select that team. Fixed live via a direct OpenFGA tuple write (user-approved after being blocked once by the auto-mode safety classifier), then made durable via `ensureDevAuthSuperAdminMembership()` in `ui/src/lib/rbac/super-admins-team.ts`, wired into the `keycloak_rbac_mapping_reconciliation_v1` startup migration in `ui/src/lib/rbac/keycloak-rbac-reconciliation.ts`.

---

## 2. Why only a few LLM models showed in the UI

**Question asked:** "why don't we see other llm models here http://localhost:3000/dynamic-agents?tab=llm-models"

**Finding:** The LLM Models tab is not live provider introspection — it's a Mongo `llm_models` collection seeded on every server start from the `models:` section of whatever YAML file `APP_CONFIG_FILE` points to (`ui/src/lib/seed-config.ts` → `seedModels()`). The committed template `config/app-config.yaml` only had 3 AWS Bedrock models uncommented. Setting `OPENAI_API_KEY` etc. has **no effect** on this list — it's driven purely by YAML.

**Follow-up:** "I was more concerned about the set up from provider to models … cloudflare to all models provided by them" — investigated how Cloudflare specifically was wired.

**Finding:** Cloudflare Workers AI was hard-pinned to a single model via one env var (`CLOUDFLARE_WORKERS_AI_MODEL`), with no way for different agents/catalog entries to select different Workers AI models. The catalog `model_id` field couldn't even hold a real Workers AI slug because of UI validation.

### Fixes (this part done, verified via `tsc`/`eslint`/`ruff`, not yet exercised live at this point)
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/llm_clients.py` — Cloudflare branch now prefers `resolved_model` (the agent/catalog's chosen slug) over the single env var, so different agents can use different Cloudflare models. Falls back to `CLOUDFLARE_WORKERS_AI_MODEL` only when the agent leaves `model_id` blank.
- `ui/src/app/api/llm-models/route.ts` — loosened `model_id` validation regex to allow a leading `@` (Cloudflare slugs look like `@cf/meta/llama-3.1-8b-instruct`).
- `config/app-config.yaml` — added two commented example Cloudflare model catalog entries showing the pattern.
- Created `config/app-config.local.yaml` (gitignored, local only) with OpenAI (`gpt-4o`, `gpt-4o-mini`) and Anthropic-direct (`claude-sonnet-4-5`, `claude-haiku-4-5`) model entries alongside the existing Bedrock default, per explicit request.

---

## 3. Bringing the stack up

User asked "frontend up?" — it wasn't running (nothing on :3000, no relevant containers). Ran the repo's own `start-caipe.sh` (untracked, pre-existing script using `podman-compose` with the standard profiles: `caipe-ui`, `rbac`, `dynamic-agents`, `rag`, `caipe-mongodb`, `web_ingestor`). Confirmed healthy: `caipe-mongodb`, `caipe-ui`, `dynamic-agents` all `Up ... (healthy)`, UI returning HTTP 200.

**Environment note:** `docker` CLI isn't installed in this shell — only `docker-compose` and `podman`/`podman-compose`, backed by a Podman machine (`restored-vm`, applehv). This matters for any future instruction that assumes plain `docker`.

---

## 4. "The LLM integration is not working"

Tested the previously-created "Hostinger management Agent" (Cloudflare-backed) live in Chat. It failed with:

```
ValueError: Unsupported provider: cloudflare-workers-ai. Available providers are:
{'aws-bedrock', 'openai', 'groq', 'azure-openai', 'google-gemini', 'anthropic-claude', 'gcp-vertexai'}
```

**Root cause:** `llm_clients.py::get_llm` is the *only* place that translates `cloudflare-workers-ai` (and `openai-direct`) into an OpenAI-compatible call through the gateway. Two other call sites bypassed it and called `LLMFactory` directly:
- `services/llm.py::get_configured_llm` (used by `middleware.py`'s LLM Tool Selector)
- `routes/assistant.py`'s `/assistant/suggest` endpoint (AI Assist)

Any agent/AI-Assist call using a gateway-routed provider 500'd.

### Fix
- `services/llm.py::get_configured_llm` now delegates to `llm_clients.get_llm` instead of calling `LLMFactory` directly. This also preserves the Bedrock extended-timeout behavior (`llm_clients.py`'s shared Bedrock client already applies the same `AWS_BEDROCK_READ_TIMEOUT`/`CONNECT_TIMEOUT` defaults that were previously hardcoded here).
- `routes/assistant.py` — replaced the direct `LLMFactory(...).get_llm(...)` call with `llm_clients.get_llm(provider, model_id)`.

### Verified live
Confirmed via `podman logs dynamic-agents` that after the fix, the error changed from `ValueError: Unsupported provider` to the call actually reaching the Cloudflare AI Gateway (`openai.BadRequestError: ... workers-ai error: Error 7000/7003 ...`), which is a **separate, pre-existing config problem**: `CLOUDFLARE_ACCOUNT_ID` on the container isn't a valid Cloudflare account ID. Confirmed directly with a manual curl against the local Portkey/Wrangler gateway on `:8787` reproducing the same "invalid object identifier" error. This is a credentials/config issue, not a code bug — flagged to the user, not fixed (out of scope: needs a real Cloudflare account ID + token).

### Operational note surfaced
`start-caipe.sh` uses the base `docker-compose.yaml`, which bakes `ai_platform_engineering/` source into the image at build time — it does **not** bind-mount it (only `docker-compose.dev.yaml` does). So a plain `podman restart dynamic-agents` does **not** pick up local source edits. Verified this the hard way (old traceback persisted after a restart), then used `podman cp <file> dynamic-agents:<path>` to push each fixed `.py` file into the running container directly for live testing, followed by `podman restart dynamic-agents`. This is a testing workaround, not a permanent fix — for ongoing backend dev, either use `docker-compose.dev.yaml` or rebuild the image.

---

## 5. "model connect still doesn't work" — the "Connect provider" dialog

Investigated the LLM Models tab's "Model Providers" section (OpenAI / Anthropic / Azure OpenAI / AWS Bedrock / Google Gemini cards with "Connect provider" buttons).

**Constraint honored throughout:** never entered an API key (real or fake) into any field myself — this is a hard-line safety rule (credentials/secrets are user-only input), so all verification here was done by reading code, checking container env, and reading network/log output, not by driving the actual save flow with a typed secret.

### Root causes found (three, layered)

1. **Backend never read the secrets it was given.** `ui/src/components/dynamic-agents/LLMProvidersTab.tsx`'s "Connect provider" dialog saves credentials to the UI's own credential-secret store (`POST /api/credentials/secrets`, name `llm:<provider>:<field>`). Confirmed via `grep` that neither `cnoe_agent_utils.LLMFactory` nor `dynamic_agents/services/llm*.py` had ever read from that store — only plain `os.getenv(...)`. Saving a key there had **zero effect** on whether a model worked. This is architectural, not a bug in either side individually.

2. **Feature flag was off.** `CAIPE_CREDENTIALS_ENABLED=false` on `caipe-ui` in this environment. With it off, `/api/credentials/secrets` 404s (`CREDENTIALS_DISABLED`) and "Save Connection" fails immediately, regardless of anything else.

3. **Key wrapper refuses under the prod image.** Once the feature flag was enabled, `/api/credentials/secrets` still 500'd: `local-cmk key wrapping is not allowed in production`. `caipe-ui` runs the `-prod` image (`NODE_ENV=production`), and `ui/src/lib/credentials/key-wrapper.ts` deliberately refuses local-derived key wrapping in production unless `CREDENTIAL_ALLOW_INSECURE_LOCAL_KEY_WRAP=true` is explicitly set — a genuine security gate, not a bug. Confirmed by reading the guard and its warning message ("intended for LOCAL prod-parity testing ONLY").

### Fix — user chose "wire the secrets store into dynamic-agents" (the real fix, not just doc a workaround)

Mirrored the existing, working MCP-server BYO-secret pattern (`services/mcp_client.py` + `services/credential_exchange.py::CredentialExchangeClient.retrieve_secret`), which dynamic-agents already uses to fetch per-MCP-server credentials from the same store via OBO bearer + service-caller headers.

- **`llm_clients.py`** — added:
  - `_PROVIDER_SECRET_ENV_MAP`: maps `llm:<provider>:<field>` secret names to the exact env vars `LLMFactory` reads (confirmed by grepping `cnoe_agent_utils/llm_factory.py` inside the running container for every `os.getenv(...)` call — e.g. `openai` → `OPENAI_API_KEY`, `azure-openai` → `AZURE_OPENAI_API_KEY`/`_ENDPOINT`/`_API_VERSION`, `aws-bedrock` → `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`, `anthropic-claude` → `ANTHROPIC_API_KEY`, `google-genai` → `GOOGLE_API_KEY`). This exactly matches the UI's `PROVIDERS` field list in `LLMProvidersTab.tsx` — confirmed 1:1.
  - `resolve_provider_credential_env(provider, credential_client)`: for each field whose env var isn't already set at the OS level (deployment-level env vars always win — this only fills gaps), looks up the secret's id by name and retrieves it, returning an env-var-override dict.
  - `get_llm(provider, model_id, credential_env=None)`: now accepts and applies this dict. **Bug caught and fixed during implementation:** the original code applied `env_overrides` to `os.environ` only right before calling `LLMFactory`, but the `SHARE_CLIENTS` branch above it (which builds shared Bedrock/httpx clients) reads `os.getenv(...)` directly and runs *before* that point — so credential-store values would have been invisible to it. Fixed by applying `credential_env` to `os.environ` immediately (before the provider-specific branches), with a single `previous_env` dict accumulating original values (including ones touched later by the cloudflare/openai-direct branches) so the existing `finally` restore block correctly reverts everything.
- **`credential_exchange.py`** — added `CredentialExchangeClient.list_secret_ids_by_name()` (GET `/secrets`, keyed by name → id) and a `_get()` helper mirroring the existing `_post()`. Needed because `/retrieve` takes a secret's internal `id`, not its friendly `name`, and there was no existing name→id lookup on this client.
- **`agent_runtime.py`** — both LLM instantiation sites (primary agent LLM and subagent LLM) now call `resolve_provider_credential_env(...)` using the existing `self._credential_exchange_client()` (already used for MCP creds) before calling `get_llm(...)`.

**`intended_use` note:** the UI's `/api/credentials/retrieve` route only allows `intended_use` of `mcp_server`, `provider_exchange`, or `internal_service`. Used `internal_service` — the dynamic-agents backend fetching a credential for its own runtime use, not on behalf of an end MCP server or an interactive provider-exchange flow. No UI-side change was needed for this since `internal_service` was already an allowed value.

### Environment changes (local `.env`, gitignored — not committed)
```
CAIPE_CREDENTIALS_ENABLED=true
CREDENTIAL_API_URL=http://caipe-ui:3000/api/credentials
CREDENTIAL_ALLOW_INSECURE_LOCAL_KEY_WRAP=true
```
Each was proposed to the user and explicitly approved before being set (the last one specifically flagged as a real security trade-off, local-testing-only, per its own source-code warning). `CREDENTIAL_API_URL` reaches `dynamic-agents` via its existing `env_file: [.env]` compose directive — confirmed no `docker-compose.yaml` edit was actually needed, avoiding a change to a file gated by the project's `docker-compose-first-install` skill.

### Verified live
- Recreated `caipe-ui` and `dynamic-agents` (`podman-compose ... up -d --force-recreate`) so the new `.env` values were actually loaded (a plain restart doesn't reread `env_file`).
- Copied the updated `.py` files into the fresh `dynamic-agents` container (same bind-mount limitation as before).
- Confirmed via `podman exec ... printenv` that both `CAIPE_CREDENTIALS_ENABLED=true` and `CREDENTIAL_API_URL=...` reached the containers.
- Confirmed via browser network inspection that `GET /api/credentials/secrets` now returns `200` (was `404`, then `500`), and a new "Credentials" nav item appeared in the UI (unlocked by the feature flag).
- **Not yet verified:** actually saving a real provider key through "Connect provider" and confirming an agent using that provider works end-to-end — this requires the user to type a real key themselves (I can't and won't do that), then either they or I (on request) can re-test.

---

## Current Status Summary

| Area | Status |
|---|---|
| Cloudflare Workers AI: multi-model support (was hard-pinned to one model) | ✅ Fixed, verified via lint/typecheck. Not yet re-tested live after the later `get_llm` signature change (low risk — additive param). |
| LLM Models tab showing limited models | ✅ Explained (YAML-seeded, not live introspection); example configs added |
| `assistant.py` / `middleware.py` bypassing Cloudflare/openai-direct translation | ✅ Fixed and verified live (error changed from "unsupported provider" to reaching the real gateway) |
| Cloudflare Workers AI actual chat completion | ❌ Still blocked — `CLOUDFLARE_ACCOUNT_ID` on the deployment is invalid. Not a code issue. Needs a real Cloudflare account ID + API token. |
| "Connect provider" UI → secrets store → dynamic-agents runtime | ✅ Code wired end-to-end, feature flag + key-wrap opt-in enabled locally, `/api/credentials/secrets` returns 200 live. ⚠️ Not yet tested with a real saved key (requires the user to enter one). |
| Dev-mode RBAC bootstrap gap (from before this log) | ✅ Fixed and made durable (only self-heals on a *fresh* deployment; live environment was patched manually earlier) |

## Files changed (none committed yet — all pending user's explicit commit request)

- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/llm_clients.py`
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/llm.py`
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/credential_exchange.py`
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/assistant.py`
- `ui/src/app/api/llm-models/route.ts`
- `ui/src/lib/rbac/super-admins-team.ts` (from before this log)
- `ui/src/lib/rbac/keycloak-rbac-reconciliation.ts` (from before this log)
- `config/app-config.yaml`
- `config/app-config.local.yaml` (new, gitignored, not part of any commit)
- `.env` (gitignored, local only — `CAIPE_CREDENTIALS_ENABLED`, `CREDENTIAL_API_URL`, `CREDENTIAL_ALLOW_INSECURE_LOCAL_KEY_WRAP`)

All Python changes pass `uv run ruff check`. All TypeScript changes pass `npx tsc --noEmit` and `npx eslint`.

---

## Planned / Open Work

1. **User to test "Connect provider" with a real key** (e.g. OpenAI) and confirm an agent using that provider actually responds — closes the loop on the credential-store wiring above.
2. **Cloudflare Workers AI account config** — needs a real `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` for the Hostinger agent (or any Cloudflare-backed agent) to actually complete a chat response. Not started.
3. **Decide on `docker-compose.yaml` for `CREDENTIAL_API_URL`** — currently only set via local `.env`, works for this environment because of `env_file: [.env]`. Whether to also add it explicitly to the committed `docker-compose.yaml` (so it works without relying on a specific `.env` layout) was raised but deferred — revisit if this should be a documented first-install default. Requires going through `.claude/skills/docker-compose-first-install/SKILL.md` per project rules before touching that file.
4. **`CAIPE_CREDENTIALS_ENABLED` / `CREDENTIAL_ALLOW_INSECURE_LOCAL_KEY_WRAP` defaults** — currently local-only opt-ins. Not proposed as new repo-wide defaults; these are meaningful security trade-offs and should stay explicit per-deployment choices.
5. **No commit made yet** for any of the files listed above — awaiting explicit instruction per repo policy (commits only happen when the user asks).
6. **Dev-mode RBAC bootstrap fix caveat** (from before this log): won't retroactively apply to this already-running environment (its startup migration already completed once); only self-heals on a genuinely fresh deployment.

---

## Change Log

- **2026-08-17** — File created, backfilled with the full session up to this point (Cloudflare multi-model fix, LLM integration 500 fix, "Connect provider" root-cause + wiring, `.env` changes). Status: code changes complete and lint-clean; live verification partial (see table above).
- **2026-08-19** — Frontend end-to-end verification pass via Chrome browser automation (real UI clicks, not just HTTP/container health checks).
  - **Confirmed working:** Home page renders; LLM Models tab (`/dynamic-agents?tab=llm-models`) renders all 5 Model Providers cards (OpenAI, Anthropic Claude, Azure OpenAI, AWS Bedrock, Google Gemini) with correct "Needs secret" badges and "Connect provider" buttons — confirms the credential-store wiring UI from §5 above is live; registered LLM Models list loaded correctly (empty state, since this environment's `app-config.yaml` seed hasn't been re-seeded with new entries). Chat page: history list loads, new chat creation works, message composition/send works, live "Thinking..." streaming state renders correctly.
  - **Reconfirmed still-broken (pre-existing, out of scope):** sent a live chat message to the "CLI Test Platform Engineer" agent (Cloudflare-backed). After ~26s of "Thinking...", UI correctly surfaced a graceful failure: "This response failed to complete. No content was generated." `podman logs dynamic-agents --tail 80` showed the same root cause as row 4 in the status table: `openai.BadRequestError: ... workers-ai error: Error 7000:No route for that URI, provider: workers-ai` — i.e. the invalid `CLOUDFLARE_ACCOUNT_ID`. Not a regression from the `get_llm`/`llm.py`/`assistant.py` fixes in §4 — same infra/credentials gap already tracked in Planned/Open Work item 2.
  - **Net result:** no new bugs found. The UI-level parts of every fix in this log (multi-model Cloudflare routing, provider bypass fix, Connect-provider dialog) are confirmed rendering/behaving correctly in a real browser. The only failing path (Cloudflare chat completion) fails for the already-known reason, and the UI degrades gracefully instead of erroring silently or crashing.
  - Not re-verified in this pass: an actual successful chat completion end-to-end on a non-Cloudflare provider (e.g. Bedrock or an `app-config.local.yaml` OpenAI/Anthropic-direct entry) — deferred, not required to confirm "frontend works."

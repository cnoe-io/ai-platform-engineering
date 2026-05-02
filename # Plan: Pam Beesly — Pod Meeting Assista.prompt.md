# Plan: Pam Beesly — Pod Meeting Assistant on CAIPE

**TL;DR.** Build Pam as a **CAIPE Dynamic Agent** (no new platform agent code) backed by **three MCP servers**: (1) a **new** `mcp_webex_meetings` MCP — a thin local server that exposes the same tool surface as Cisco's official Webex Meetings MCP (`webex-list-meetings`, `webex-list-transcripts`, etc.) but hits the **public Webex REST API** (`webexapis.com/v1/...`) directly. Authed via **per-user OAuth** — token resolved from the `vendor_connections` Mongo collection populated by the existing UI OAuth flow. Built deliberately so we can drop in Cisco's official MCP later (just swap one URL) the day Cisco IT enables agentic apps in cisco.com Control Hub. (2) the existing in-house `mcp_webex` (messaging-only, kept untouched, bot-token auth). (3) the existing `mcp-atlassian` Confluence MCP. (4) **a new lightweight MCP — `mcp_pod_meeting`** — containing only the *deterministic* helpers an LLM is bad at: VTT parsing, action/decision extraction, agenda XHTML rendering, Webex `#agenda` topic harvesting, and a pod registry. PgM↔Pam approvals run **in Webex DM via CAIPE's existing Webex bot listener** (`integrations/webex_bot`, already in repo) — no UI-only loop. v1 is chat-triggered with an optional Kubernetes CronJob that POSTs `"Pam, prep <pod>'s next meeting"` to Pam's chat endpoint.

> **Why a separate `mcp_webex_meetings` MCP (not extending `mcp_webex`)?**
> 1. **Auth model**: `mcp_webex` uses a single shared bot token (`WEBEX_TOKEN`) for posting messages as the bot. Meeting/transcript reads need the *requesting user's* OAuth bearer (the bot can't read other people's transcripts; even with Compliance Officer scopes, you want per-user audit trails for transcripts). MCP-level auth is per-server, so mixing strategies in one MCP is wrong.
> 2. **Drop-in swap**: when Cisco enables agentic apps in cisco.com Control Hub, we point the MCP server URL from our local wrapper to `https://mcp.webexapis.com/mcp/webex-meeting` and delete the wrapper — zero changes to agents, prompts, or other tools. If meetings lived inside `mcp_webex`, swapping is impossible.
> 3. **Scope blast radius**: Pam needs meeting/transcript scopes; pure messaging agents shouldn't get them. Different MCPs = different per-agent allow-lists.
> 4. **The original plan extended `mcp_webex` because per-user OAuth didn't exist in CAIPE yet** — it does now (`vendor_connections` + `mcp_client._resolve_user_oauth_headers`). The trade-off has flipped.

---

## Phase 1 — New MCP server: `mcp_webex_meetings`

A thin REST proxy. Located at `ai_platform_engineering/agents/webex-meetings/mcp/`. Built using the same FastMCP + Pydantic + Click template as `mcp_webex`. Streamable-HTTP only (per-user auth requires HTTP).

**Auth model:** the dynamic-agents runtime injects `Authorization: Bearer <user-token>` when calling this MCP (because the MCP server config has `auth.type=user_oauth, provider=webex`). The MCP server reads that header off the incoming request via `fastmcp.server.dependencies.get_http_headers()` and forwards it to `webexapis.com`. No Mongo access from inside the MCP — single source of truth stays in `vendor_connections`.

**Tool surface (mirrors Cisco's official Meetings MCP one-for-one for swap-ability):**

1. **`webex-list-meetings(from_iso?, to_iso?, host_email?, meeting_type?, max=20)`** → `GET /v1/meetings`. Date-range and host filters.
2. **`webex-get-meeting-status(meeting_id, include_participants=false)`** → `GET /v1/meetings/{id}` plus optional `GET /v1/meetingParticipants?meetingId=...`.
3. **`webex-create-meeting(title, start, end, agenda?, invitees?, recurrence?, password?)`** → `POST /v1/meetings`.
4. **`webex-update-meeting(meeting_id, ...patch fields...)`** → `PUT /v1/meetings/{id}`.
5. **`webex-delete-meeting(meeting_id, send_email=true)`** → `DELETE /v1/meetings/{id}?sendEmail=...`.
6. **`webex-list-recordings(meeting_id?, from_iso?, to_iso?, max=20)`** → `GET /v1/recordings`.
7. **`webex-list-transcripts(meeting_id?, from_iso?, to_iso?, max=20, download=false, format="vtt")`** → `GET /v1/meetingTranscripts`. When `download=true`, also fetches `/v1/meetingTranscripts/{id}/download?format=vtt|txt` for each item and inlines the raw body in the response (so `mcp_pod_meeting.parse_webex_vtt` can chain directly).
8. **`webex-get-meeting-summary(meeting_id)`** → AI summary endpoint (best-effort; returns "not available" if Webex AI Assistant isn't enabled — caller should fall back to transcript+`extract_action_items`).

**Explicitly NOT in this MCP:** messaging (rooms, posts, threads) — that stays in `mcp_webex`.

**Auth/config:** Click options + env vars matching the `mcp_webex` pattern. No static `WEBEX_TOKEN` env var. Stdio not supported (per-user requires HTTP).

---

## Phase 1b — New MCP server: `mcp_pod_meeting`

Built using the same FastMCP + Pydantic + Click template as `mcp_webex`. Located at `ai_platform_engineering/agents/pod-meeting/mcp/`.

**Tools (deterministic, no LLM in the path):**

1. **`parse_webex_vtt(vtt_text | url)`** → `{segments: [{speaker, start, end, text}], speakers: [...], duration_s}`. Pure VTT parser; normalizes Cisco's display-name format. Reference input: `ai-platform-engineering-context-id-bug/Mycelium Team-20260424 2031-1.vtt`.
2. **`extract_action_items(segments)`** → `[{owner_hint, text, ts, confidence}]`. Regex/heuristic pass: "I'll …", "X will …", "action item …", "TODO …". Returns raw candidates; final phrasing left to LLM, but extraction is deterministic.
3. **`extract_decisions(segments)`** → `[{text, ts}]`. Heuristic pass on "we agreed", "decision:", "let's go with".
4. **`resolve_owners(owner_hints, pod_id)`** → resolves first-name / mention to `{display_name, email, webex_person_id}` using the pod roster (Mongo). Falls back to "unassigned".
5. **`harvest_webex_topics(room_id, since_iso, tag="#agenda")`** → wraps `mcp_webex.list_messages_in_room`, filters by tag/regex, dedups, returns `[{author, text, message_id, ts, permalink}]`.
6. **`load_agenda_template(template_id_or_url | None)`** → returns the storage-format XHTML skeleton + section markers. If `None`, returns the built-in default schema (Agenda / Discussion / Decisions / Action Items table / Deliverables table). Per the user note: template is configurable per chat session — Pam asks for the link on fresh context and caches it on the session/pod.
7. **`render_agenda_xhtml(template, standing_topics, prior_actions, harvested_topics, meeting_meta)`** → Confluence-storage XHTML body ready for `confluence.create_page`. Idempotent. Stable section anchors so `update_page` patches don't blow away existing edits.
8. **`render_notes_xhtml(template, transcript_summary, decisions, action_items, deliverables, meeting_meta)`** → notes-page XHTML, same idempotency contract.
9. **`get_pod(pod_id)`** / **`list_pods()`** / **`upsert_pod(...)`** → CRUD over the Mongo `pods` collection: `{pod_id, name, webex_room_id, confluence_parent_id, agenda_template_id, notes_template_id, pgm_email, roster: [...], default_meeting_series}`.
10. **`find_prior_meeting_page(pod_id, before_iso)`** → uses `confluence.get_pages` with title pattern (`{pod_name} — YYYY-MM-DD`) to locate last week's page; returns `{page_id, action_items_extracted}` (extraction reuses tool 2/3 over the page body).

**Explicitly NOT in this MCP** (use existing MCPs / LLM):
- Anything Confluence write-side (delegate to `mcp-atlassian`: `create_page`, `update_page`).
- Webex meeting metadata + transcripts (delegate to `mcp_webex_meetings` — Phase 1).
- Webex messaging (delegate to existing `mcp_webex`).
- Approval gating (handled by Pam's system prompt + chat turns + Webex bot listener).

**Auth/config:** Click options + env vars matching the `mcp_webex` pattern. Mongo URI reuses the dynamic-agents Mongo. Stdio + streamable-http transports.

---

## Phase 2 — Register the three MCP servers with dynamic_agents

Edit `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/config.yaml`:

- `mcp_webex` (stdio, existing — now with the Phase 1b additions) — for posting/listing Webex messages **and** meeting/transcript retrieval.
- `mcp_atlassian` / `confluence` (existing) — for `create_page`, `update_page`, `get_pages`.
- `mcp_pod_meeting` (stdio, new, from Phase 1).

No `mcp_client.py` patches needed — all three use auth models CAIPE already supports.

---

## Phase 3 — Define the Pam dynamic agent

Two paths, both supported by CAIPE today:

**A. Seed via `config.yaml`** (recommended for first commit so Pam exists on fresh deploys):
- `id: pam-beesly`, `name: "Pam Beesly"`, `visibility: team`.
- `mcp_servers: [mcp_webex, confluence, webex_meetings, mcp_pod_meeting]`.
- `allowed_tools` filtered to only what Pam needs (e.g. exclude `create_room`, destructive Confluence ops).
- `system_prompt`: encodes the workflow as a state machine with explicit human gates (PgM agenda approval, PgM notes approval). Persona = "warm, concise, slightly apologetic Pam Beesly tone".
- **Per-pod template links are NOT in the prompt** — Pam asks for them on fresh context, then writes them via `upsert_pod` so the next session reuses them.

**B. UI-managed pods.** Per your answer, pod registry lives in **Mongo via the dynamic_agents UI**. Two options for *how* it's managed:
- B1 (lighter): pods live in Pam's dedicated `pods` collection, edited via the new MCP's `upsert_pod` tool from a chat ("Pam, register pod 'mycelium' with room X, parent Y").
- B2 (heavier): extend the dynamic_agents UI with a "Pod Registry" panel. Defer to Phase 5.

Default to **B1** for v1.

---

## Phase 4 — Trigger: chat + optional CronJob, approvals over Webex bot

- **Primary trigger (v1):** PgM types in CAIPE chat (the grid). **No Webex bot listener in v1** — there's no bot integration wired into dynamic-agents today, so all approvals stay in-grid. Cron-triggered prep posts a draft Confluence link into the chat session for the PgM to review.
- **Webex bot listener — Phase 2, post-merge.** After v1 ships, add a Webex bot integration that forwards DMs to Pam's chat session so PgMs can approve from Webex instead of the grid. Tracked separately.
- **Scheduled trigger (v1):** see **Phase 4b — Scheduler service** below. Pam exposes `schedule_prep` / `unschedule_prep` / `list_schedules` tools; the actual cron lives in a separate `scheduler-svc` pod that creates per-schedule k8s `CronJob`s. dynamic-agents itself never gets k8s API perms.
- **Approvals (v1, in Webex):** Pam DMs the PgM via the bot with a Confluence link + summary. PgM replies in the same Webex DM thread → bot forwards to Pam's chat session → Pam treats it as the next user turn. Pam looks for an explicit `approve` token (or PgM-edited content) and only then posts to the pod space. From Pam's perspective the channel is irrelevant — it's just chat.

**Re: "fake CAIPE email" auto-pickup.** Out of scope for v1 because it requires (a) a Microsoft Graph / Exchange integration that doesn't exist anywhere in the repo, (b) a webhook listener service, (c) a calendar-invite parser to extract pod identity. Realistic effort is a separate small service (Graph subscription → webhook → POST to Pam's chat endpoint with parsed metadata) — track as Phase 6.

---

## Phase 4b — Scheduler service (`scheduler-svc`)

**Why a separate service:** Pam (and any other dynamic agent) needs to register cron-style schedules for itself. Granting k8s `cronjobs.*` RBAC to dynamic-agents is unsafe — a compromised LLM tool could schedule arbitrary container workloads. Instead, dynamic-agents talks to a small REST service that owns the k8s perms behind a hard-coded podTemplate. dynamic-agents stays exactly as privileged as it is today (HTTP-out only).

### Trust boundaries

| Component | Can do | Cannot do |
|---|---|---|
| dynamic-agents (Pam) | HTTP POST to `scheduler-svc` only | Touch k8s API, mount secrets, choose image |
| `scheduler-svc` (new pod) | Create/delete `CronJob`s from one **hard-coded** podTemplate; only `schedule`, `timeZone`, and `SCHEDULE_ID` env are user-controlled | Run arbitrary containers (template baked in code) |
| `cron-runner` pod (per scheduled fire) | Read its own chat-API-token Secret; POST to chat endpoint | Talk to Mongo, k8s API, anything else |

### Repo placement

New top-level service: `ai_platform_engineering/services/scheduler/` (parallel to `agents/` and `dynamic_agents/`). Plus a tiny `ai_platform_engineering/services/cron-runner/` image.

### Mongo collection: `schedules`

```
{
  _id: ObjectId,
  schedule_id: "sched_<uuid>",        // public id, used as CronJob name
  owner_user_id: "<caipe user id or email>",
  agent_id: "agent-sunny-webex-meeting-test",
  message_template: "Pam, prep <pod_name>'s next pod meeting",
  pod_id: "mycelium",                  // optional, stored for UI/listing
  cron: "0 9 * * MON",
  tz: "America/Los_Angeles",
  enabled: true,
  created_at, updated_at,
  last_run: { ts, status: "ok"|"error", error?, http_status? }
}
```

### REST API (scheduler-svc)

- `POST   /v1/schedules` — create. Body: `{agent_id, message_template, cron, tz, pod_id?, owner_user_id}`. Returns `{schedule_id, cronjob_name}`.
- `GET    /v1/schedules?owner=&pod_id=&agent_id=` — list.
- `GET    /v1/schedules/{id}` — single.
- `PATCH  /v1/schedules/{id}` — enable/disable, change cron/tz/message.
- `DELETE /v1/schedules/{id}` — removes Mongo doc + CronJob.

**Auth:** shared service token (`X-Scheduler-Token`) between dynamic-agents → scheduler-svc, stored in k8s Secret. Multi-user attribution comes from `owner_user_id` field, not request auth.

### Validation on `POST`

1. `croniter(cron)` parses → 400 if not.
2. `tz` is valid IANA → 400 if not.
3. `agent_id` exists in `dynamic_agents` collection → 404 if not.
4. `message_template` length ≤ 2000 chars.
5. Per-owner cap (e.g. 50 schedules) → 429.

### On `POST /schedules`, scheduler-svc:

1. Insert Mongo doc.
2. Render `CronJob` from baked-in template (below).
3. `kubectl create cronjob` via Python `kubernetes` lib.
4. If k8s create fails → delete Mongo doc, return 500.
5. Set `ownerReferences` → scheduler-svc's own Deployment, so uninstall cascades all CronJobs.

### Hard-coded CronJob podTemplate (in scheduler-svc code)

```yaml
spec:
  schedule: "<user-provided>"
  timeZone: "<user-provided>"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          serviceAccountName: cron-runner       # default SA, no perms
          restartPolicy: OnFailure
          containers:
          - name: runner
            image: ghcr.io/cnoe-io/caipe-cron-runner:<pinned>
            env:
            - name: SCHEDULE_ID
              value: "<sched_id>"
            - name: SCHEDULER_API_URL
              value: "http://scheduler-svc:8080"
            - name: CAIPE_API_URL
              valueFrom: { configMapKeyRef: ... }
            - name: CAIPE_API_TOKEN
              valueFrom: { secretKeyRef: ... }
            resources:
              limits: { cpu: 100m, memory: 128Mi }
```

User input only fills `schedule`, `timeZone`, and `SCHEDULE_ID`. Everything else is fixed.

### `cron-runner` image (separate small image)

One Python file:
1. Read `SCHEDULE_ID` env.
2. `GET scheduler-svc/v1/schedules/{id}` → fetch `agent_id`, `message_template`, `owner_user_id`.
3. POST chat API with `{agent_id, message}` as the owner user.
4. `PATCH scheduler-svc/v1/schedules/{id}` with `last_run`.

No Mongo connection. No k8s API. Only HTTP.

### RBAC

Single `Role` bound to the scheduler-svc ServiceAccount, namespace-scoped:

```yaml
- apiGroups: ["batch"]
  resources: ["cronjobs"]
  verbs: ["create", "get", "list", "update", "delete", "patch"]
```

`cron-runner` SA gets nothing.

### Pam's tools (`mcp_pod_meeting`, new)

- `schedule_prep(pod_id, cron, tz)` → POST scheduler-svc with `agent_id=agent-sunny-webex-meeting-test`, `message="Pam, prep <pod_name>'s next pod meeting"`, `owner_user_id={{user.email}}`.
- `unschedule_prep(pod_id)` → DELETE the matching schedule.
- `list_schedules(pod_id?)` → GET.

User flow: *"Pam, set up auto-prep for mycelium every Monday at 9am Pacific."* → Pam calls `schedule_prep("mycelium", "0 9 * * MON", "America/Los_Angeles")`.

### Helm

New sub-chart: `charts/ai-platform-engineering/charts/scheduler/`. Values:

- `scheduler.enabled` (default `false` — opt in)
- `scheduler.image`
- `scheduler.cronRunner.image`
- `scheduler.token` (mounted into both scheduler-svc and dynamic-agents)
- Namespace pinned to the chart's namespace.

### Open lock-ins (decide before code)

1. Repo location: `ai_platform_engineering/services/scheduler/` ok?
2. Language: **Python** (matches MCP stack) — confirm vs. Go.
3. Image registry: `ghcr.io/cnoe-io/caipe-scheduler` + `ghcr.io/cnoe-io/caipe-cron-runner`?
4. `owner_user_id`: CAIPE user id, or email string?
5. WRITEUP via cron — out of scope (needs host's Webex OAuth; PgM does writeup manually). Confirm.

### Phase 4b deliverables

1. `services/scheduler/` Python service (FastAPI + `kubernetes` + `pymongo` + `croniter`).
2. `services/cron-runner/` tiny Python image.
3. Helm sub-chart with Deployment, Service, Role, RoleBinding, ServiceAccount, Secret.
4. `mcp_pod_meeting`: 3 new tools (`schedule_prep`, `unschedule_prep`, `list_schedules`).
5. Pam's seed `allowed_tools.pod_meeting` extended; system prompt gets a "scheduling" mini-section.
6. Compose: **not shipped** — k8s only. Devs test by `python services/scheduler/main.py` against local Mongo + a kind cluster, or just `python services/cron-runner/main.py` directly with a stubbed `SCHEDULE_ID`.

---

## Phase 5 — Persona content & verification

- **System prompt** explicitly enumerates the workflow: pre-meeting (template+harvest+draft+approve+post), during (n/a in v1, transcript-first), post (parse VTT → render notes → DM PgM → wait for approval → post in pod space).
- **Sample fixtures** in `mcp_pod_meeting/tests/fixtures/`: the `Mycelium Team-20260424 2031-1.vtt` and the linked Mycelium Confluence page exported as XHTML, used to validate the parse+render round-trip.

---

## Phase 6 — Out-of-scope for v1 (tracked for later)

- Outlook / Microsoft Graph integration (calendar invites, "add CAIPE to the series").
- Per-user Webex OAuth (would let us swap to Cisco's official Meetings MCP and remove the Compliance-Officer-token requirement).
- Live during-meeting capture (only transcript-first in v1).
- A "Pod Registry" UI panel in dynamic_agents.
- Email-to-trigger fake address.

---

## Steps (execution order)

1. **Phase 1** — Scaffold `ai_platform_engineering/agents/pod-meeting/mcp/` from the `mcp_webex` template; implement tools 1–4 (transcript parsing) first against the Mycelium VTT fixture. *Parallelizable substeps after scaffold: (1+2+3 transcript pipeline), (5 webex harvester), (9 pod CRUD), (6+7+8 templates+rendering), (10 prior-page lookup).*
2. **Phase 1b** — Extend `mcp_webex` with `list_meetings` / `get_meeting` / `list_transcripts` / `download_transcript`. *Parallel with Phase 1.*
3. **Phase 2** — Add three entries to `dynamic_agents/services/config.yaml`. *Depends on 1 + 1b.*
4. **Phase 3** — Add Pam's seed agent block to `config.yaml` with full system prompt + tool allow-list. *Depends on 2.*
5. **Phase 4** — Verify Webex bot routes DMs to Pam (patch the bot router if needed). Optional: ship a sample `CronWorkflow` manifest under `deploy/cron/pam-pod-prep.yaml`. *Parallel with 3.*
6. **Phase 5** — Write fixtures + integration tests for the round-trip on the Mycelium meeting. *Parallel with 3–4.*

---

## Relevant files

- `ai_platform_engineering/agents/webex/mcp/mcp_webex/mcp_server.py` — MCP-server template to copy (FastMCP + Click + Pydantic models + `@server.tool` decorators + `handle_mcp_errors`).
- `ai_platform_engineering/agents/confluence/mcp/mcp_confluence/server.py` — confirms `update_page`, `update_page_title` already exposed (lines 517, 561). Pam will call these via the Confluence MCP, no wrapper needed.
- `ai_platform_engineering/agents/confluence/agent_confluence/protocol_bindings/a2a_server/agent.py` — confirms deployments use `sooperset/mcp-atlassian` (line 79).
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/config.yaml` — where to register the 4 MCP servers + Pam.
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mcp_client.py` — `build_mcp_connection_config()`; verify bearer-token passthrough for the official Webex Meetings MCP.
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/models.py` — `DynamicAgentConfig`, `MCPServerConfig`, `TransportType` schemas.
- `ai_platform_engineering/dynamic_agents/README.md` + `ARCHITECTURE.md` — confirm seed/Mongo flow and visibility model.
- `Mycelium Team-20260424 2031-1.vtt` — primary test fixture for transcript parsing.
- (new) `ai_platform_engineering/agents/pod-meeting/mcp/mcp_pod_meeting/` — new MCP package.
- (new, optional) `deploy/cron/pam-pod-prep.yaml` — sample cron trigger.

---

## Verification

1. **Unit:** `parse_webex_vtt` round-trips the Mycelium VTT into structured segments; speaker count matches manual inspection.
2. **Unit:** `extract_action_items` + `extract_decisions` produce non-empty plausible candidates from the Mycelium VTT (assert ≥3 actions and ≥1 decision; spot-check).
3. **Unit:** `render_notes_xhtml` produces XHTML that parses as well-formed Confluence storage format and contains the expected anchors.
4. **Integration (manual):** start CAIPE locally with the new config, open chat → "Pam, register pod 'demo' with room <id> and parent <id>" → "Pam, prep next demo meeting" → verify a draft Confluence page appears + Webex DM is sent to PgM.
5. **Integration (manual):** "Pam, write up notes from this transcript:" + paste VTT → verify notes page is created + PgM gets DM with link + summary blurb.
6. **Bearer passthrough:** confirm the official Webex Meetings MCP returns real meetings via `webex-list-meetings` from inside Pam's tool list.
7. **Allow-list:** confirm only Pam's whitelisted tools appear in the dynamic-agents UI tool inspector.

---

## Decisions

- **Webex meetings/transcripts:** extend the in-house `mcp_webex` with REST-backed `list_meetings` / `list_transcripts` / `download_transcript` tools using the existing `WEBEX_TOKEN` model. Cisco's official Meetings MCP is **rejected** because it needs per-user OAuth that CAIPE doesn't support today.
- **New MCP scope:** transcript→notes parser, agenda builder/renderer, Webex topic harvester, pod registry. No Confluence helpers (already covered by `mcp-atlassian`'s `update_page`).
- **Pod config:** Mongo, mutated via the new MCP's `upsert_pod` tool from chat (UI panel deferred).
- **Templates:** asked-for per session on fresh context; default schema is hardcoded fallback.
- **Trigger:** chat-first (CAIPE UI *or* Webex DM via the existing bot); CronJob optional. Email/Outlook ingestion deferred to Phase 6.
- **Approvals:** Webex DM thread with the PgM via the existing bot — same chat session from Pam's perspective.
- **Persona:** single agent `pam-beesly`, visibility=team.

---

## Further considerations

1. **Webex token scopes for transcripts.** The transcripts REST API only returns data the token owner is authorised to see. To pull transcripts for *other people's* meetings (which is what Pam needs in most pods), the token must belong to a Webex user with the **Compliance Officer** role, or be an Integration with `spark-compliance:meetings_read` / `spark-compliance:transcripts_read`. *Recommendation:* document this prerequisite; for orgs without a CO, fall back to having the meeting host paste the VTT into chat (still triggers the same `parse_webex_vtt` → `render_notes_xhtml` path).
2. **Webex bot ↔ dynamic_agents wiring.** The existing bot integration today routes to the **supervisor**. Verify it can address dynamic agents directly (e.g. `@CAIPE pam: ...`) or that we add a small router so DMs to the bot end up in Pam's chat thread. If not, ship a minimal patch — this is the only piece keeping the in-Webex approval loop from working.
3. **Storage-format XHTML vs. ADF.** Atlassian's newer "v2" pages use ADF (JSON), older REST uses storage-format XHTML. *Recommendation:* render storage-format because `mcp-atlassian`'s `create_page` accepts it; revisit if your Cloud instance forces v2.
4. **Idempotency on re-runs.** If Pam is invoked twice for the same meeting, do we update the existing page or create a new one? *Recommendation:* `find_prior_meeting_page` covers lookup; if a page exists with today's title, `update_page` instead of `create_page`. Encode this in the system prompt.

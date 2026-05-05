---
sidebar_position: 1
title: Skills
description: User-facing overview of CAIPE skills — concepts, the Gallery and Gateway UIs, the install one-liner, hubs, scanning, and how it all fits together.
---

# Skills

A **skill** in CAIPE is a single, reusable Markdown file (`SKILL.md`) that
describes one well-scoped capability — "review a GitHub PR", "investigate
a PagerDuty incident", "publish a release", and so on. The same `SKILL.md`
can be:

- **invoked from inside a CAIPE chat** (the supervisor pulls the skill into
  the agent's context as a virtual file via the
  [skills middleware](../../specs/097-skills-middleware-integration/spec.md)),
- **installed onto your laptop** for use as a slash command in Claude Code,
  Cursor, Codex CLI, Gemini CLI, or opencode (via the
  [`/api/skills/install.sh`](#install-on-your-laptop) one-liner), or
- **fetched on demand by an external coding agent** through the
  [Skills API Gateway](#wire-your-coding-agent-to-the-live-catalog) — the agent calls the catalog
  REST API directly rather than copying anything to disk.

This doc is the umbrella reference. For the exhaustive feature contracts,
acceptance criteria, and data-model details, follow the spec links inline
and at the bottom.

> **Two reading paths.** Developers who just want to *use* skills should
> jump to [For developers](#for-developers). Operators deploying CAIPE
> should jump to [For operators](#for-operators). The
> [Architecture](#architecture) section is shared.

## Concepts

| Concept           | What it is                                                               | Lives in / on                                                  |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **`SKILL.md`**    | The single canonical artifact: Markdown body + YAML frontmatter (`name`, `description`, optional `disable-model-invocation`, `allowed-tools`). | Anywhere a file can live: filesystem, Mongo, GitHub, GitLab.   |
| **Catalog**       | The merged, deduplicated, scan-gated list of skills the gateway and the supervisor see. | Built on demand from the sources below.                        |
| **Agent skill**   | A `SKILL.md` persisted in MongoDB and editable in the **Skills Gallery** UI (workspace editor, AI Assist, revision history). | Mongo collection `agent_skills`.                               |
| **Skill hub**     | An external source (GitHub or GitLab repo, with optional `include_paths` filter) crawled on a schedule into a cache of read-only skills. | Mongo collection `skill_hubs`; cached docs in `hub_skills`.    |
| **Scanner**       | An optional sidecar that scores each `SKILL.md` for prompt-injection / unsafe-tool risk. Findings drive the **scan gate**. | `SKILL_SCANNER_URL` sidecar (see [Scan gating](#scan-gating)). |
| **Skills middleware** | The Python library on the supervisor side that turns the catalog into virtual files in the agent's `StateBackend` so the LLM can read skills mid-conversation. | `ai_platform_engineering/skills_middleware/`.                  |
| **Live-skills slash command** | A copy-pasteable `/skills` command users install into their coding agent so the agent can *query the catalog* (not just consume a snapshot). | Rendered from `data/skills/live-skills.md`; see [skills-live-skills](../../ui/skills-live-skills.md). |

## For developers

> Audience: you use CAIPE day-to-day and want to invoke or install skills.

### Two UI surfaces

CAIPE exposes skills under `/skills` in the UI as **two pages with one
shared header**:

| Page                    | URL              | What you do here                                                                                              |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| **Skills Gallery**      | `/skills`        | Browse the merged catalog, open the workspace editor, run **AI Assist** (`POST /api/skills/generate`), import from GitHub / GitLab, manage revisions. |
| **Skills API Gateway**  | `/skills/gateway`| Mint a catalog API key, copy the install one-liner, get the per-agent launch guide, render the `/skills` slash command for your coding agent. |

The Gallery is where skills are **authored and managed**; the Gateway is
where you **wire CAIPE up to your coding agent**. You can use either alone.

### Use a skill from inside CAIPE chat

Nothing to install — when you start a conversation with a dynamic agent
that has skills attached, the supervisor mounts those skills as virtual
files in the agent's working state. The LLM sees them as if they were on
disk. The catalog the supervisor reads is filtered by the configured
[scan gate](#scan-gating), so quarantined skills never reach the model.

### Install on your laptop

The Skills API Gateway page renders a one-line installer. Run it once:

```bash
curl -fsSL "<gateway>/api/skills/install.sh?agent=claude&scope=user" | bash
```

After install, every catalog skill is present in **two universal locations**
on disk:

```
~/.claude/skills/<name>/SKILL.md
~/.agents/skills/<name>/SKILL.md
```

so the same install satisfies Claude Code, Cursor, Codex CLI, Gemini CLI,
and opencode without re-running per agent
(see [`2026-05-04-skills-only-overhaul`](../../specs/2026-05-04-skills-only-overhaul/spec.md),
FR-001 through FR-003).

Common variants the Quick Install dialog can render for you:

| Flag                      | Effect                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `--upgrade`               | Overwrite skills whose hash differs from the catalog. Cleans legacy `commands/` artifacts. |
| `--force`                 | Overwrite unconditionally (every file, regardless of hash).                         |
| `mode=uninstall`          | Walk both user and project manifests with a per-skill `y/N/a/q` prompt loop.        |
| `mode=uninstall&--purge`  | Above, plus delete `~/.config/caipe/config.json` (api key + base url).              |
| `mode=bulk-with-helpers`  | (Default in the Quick Install UI when a key is minted.) Also installs the two CAIPE helper skills `/skills` and `/update-skills`. |

The two helpers, when installed, let you talk to the live catalog from
your editor without re-running the installer:

- **`/skills`** — search, run, and install single skills on demand.
- **`/update-skills`** — fetch latest versions from the catalog.

Both ship as proper `SKILL.md` files with `disable-model-invocation: true`
and an `allowed-tools` allowlist, so they only run when *you* type the
slash command (not when the LLM speculatively decides to use them).
See spec [FR-008 / FR-010](../../specs/2026-05-04-skills-only-overhaul/spec.md#functional-requirements).

### Author and edit a skill

In the **Skills Gallery**:

1. Click **New skill**, or **Import** to pull a `SKILL.md` and its
   ancillary files from a GitHub or GitLab repo path
   (`POST /api/skills/import`; see
   [FR-016 / FR-017](../../specs/2026-05-04-skills-only-overhaul/spec.md#functional-requirements)
   for the request shape).
2. Edit the `SKILL.md` inline. The **AI Assist** panel calls
   `POST /api/skills/generate` to refine the body or frontmatter against
   a dynamic agent.
3. Save. Each save creates a `skill_revisions` row; you can diff and
   restore older revisions from the **History** tab. Retention defaults
   to **10 revisions per skill**.
4. (Optional) Click **Scan** to send the skill to the scanner sidecar.
   Findings show up inline; high-severity findings can quarantine the
   skill from the live catalog (see [Scan gating](#scan-gating)).
5. (Optional) Click **Export ZIP** to download the skill plus its
   ancillaries; **Import ZIP** in the gallery toolbar reverses the flow.

The full editor / revision / scan model is described in
[`2026-04-29-skills-api-unification`](../../specs/2026-04-29-skills-api-unification/spec.md)
(data model: [`data-model.md`](../../specs/2026-04-29-skills-api-unification/data-model.md);
REST surface: [`contracts/rest-api.md`](../../specs/2026-04-29-skills-api-unification/contracts/rest-api.md)).

### Wire your coding agent to the live catalog

If you would rather query the catalog on demand than ship a snapshot to
disk, the Gateway also renders a `/skills` slash command that talks to
the catalog REST API directly (`GET /api/skills`, `GET /api/skills/:id`,
`POST /api/skills/:id/run`).

The slash command body is rendered from a single Markdown template
(`live-skills.md`) and adapted per agent. Operators can override the
template at deploy time without rebuilding the image — see the dedicated
[Live-skills slash command](../../ui/skills-live-skills.md) page for the
override resolution order, the per-agent argument-syntax mapping
(`$ARGUMENTS` for Claude / Cursor / opencode, `$1` for Codex / Gemini),
and the launch-guide UX.

## For operators

> Audience: you deploy CAIPE and run the supervisor, dynamic agents, and UI.

### Where skills come from

Three sources merge into the catalog at request time:

1. **Packaged defaults** — `SKILL.md` files mounted from the
   `caipe-skills` ConfigMap (chart-relative directory
   `charts/ai-platform-engineering/data/skills/`). Use these to ship
   opinionated defaults for your fork.
2. **`agent_skills` collection** — user-authored skills persisted via
   the Skills Gallery. Includes revision history (`skill_revisions`).
3. **Skill hubs** — external repos (`skill_hubs` collection) crawled on
   a schedule into a `hub_skills` cache. Supports GitHub and GitLab,
   with optional `include_paths` to pin ingestion to a subdirectory of
   a monorepo
   (see [FR-020 / FR-021](../../specs/2026-05-04-skills-only-overhaul/spec.md#functional-requirements)).

### Register a skill hub

```http
POST /api/skill-hubs
Content-Type: application/json

{
  "type": "gitlab",
  "location": "mycorp/devops/platform",
  "include_paths": ["skills/", "agents/observability/skills/"],
  "credentials_ref": "GITLAB_TOKEN"
}
```

Notes:

- `location` for GitLab supports **arbitrarily nested subgroups**
  (preserved end-to-end; the legacy two-segment truncation has been
  removed —
  [FR-022](../../specs/2026-05-04-skills-only-overhaul/spec.md#functional-requirements)).
  GitHub stays flat (`owner/repo`).
- `include_paths` is normalized server-side: trim, dedupe, append
  trailing `/` so `skills` does not match `skills-archive/`. Empty or
  absent means "crawl the whole repo" (today's behavior).
- `credentials_ref` looks up an env var on the UI server; never embed
  a token in the request body.
- The hub re-crawls on a schedule and on demand
  (`POST /api/skill-hubs/:id/refresh`). The refresh endpoint is also
  used by the **Refresh** button in the Skill Hubs admin UI.

### Scan gating

The optional skill scanner is a separate microservice; see the
[`097-skills-middleware-integration`](../../specs/097-skills-middleware-integration/spec.md)
spec for its contract. CAIPE does not require it — but if you run it,
the gate decides what the catalog returns.

| `SKILL_SCANNER_GATE` | What is admissible to the live catalog                         | Default? |
| -------------------- | -------------------------------------------------------------- | -------- |
| `off`                | Everything (scan results are still recorded, just not enforced). |          |
| `warn`               | Everything except skills the scanner **explicitly blocked**. Unscanned skills pass. | **yes** |
| `strict`             | Only skills that have a clean scan result. Unscanned skills are excluded. |          |

The default is `warn` so dynamic agents in deployments **without** a
scanner sidecar still see the catalog
(see `ai_platform_engineering/skills_middleware/scan_gate.py`,
`_DEFAULT_GATE`). Tighten to `strict` once you have a sidecar running and
have backfilled scans on every active skill.

The same gate is applied at:

- the supervisor's catalog read (skills middleware loader),
- the Gateway's `GET /api/skills` (so external coding agents see a
  filtered catalog), and
- the install-script renderer (so `curl | bash` never lays down a
  blocked skill).

Quarantined skills **remain visible in the Gallery** (so authors can fix
them) but do **not** appear in the live catalog. This is the explicit
contract from
[`2026-04-29-skills-api-unification` Clarifications](../../specs/2026-04-29-skills-api-unification/spec.md#clarifications).

### Environment variables that matter

| Variable                          | Read by                | Effect                                                                   |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| `SKILL_SCANNER_URL`               | supervisor, scanner    | Sidecar URL. Unset = no scanner.                                         |
| `SKILL_SCANNER_GATE`              | supervisor, UI server  | `off` / `warn` / `strict`. Default `warn`.                               |
| `SKILLS_LIVE_SKILLS_TEMPLATE`     | UI server              | Inline override for the `/skills` slash command body (raw markdown).     |
| `SKILLS_LIVE_SKILLS_FILE`         | UI server              | Path override for the same template (default `/app/data/skills-live-skills/live-skills.md`). |
| `DYNAMIC_AGENTS_URL`              | UI server              | Where `/api/skills/generate` (AI Assist) proxies to.                     |
| `DYNAMIC_AGENTS_INTERNAL_TOKEN`   | UI server              | Optional bearer for service-to-service AI Assist calls.                  |
| `GITHUB_TOKEN`                    | UI server              | Default token for GitHub hub crawls and the per-skill importer.          |
| `GITLAB_TOKEN`                    | UI server              | Same, for GitLab.                                                        |
| `GITLAB_API_URL`                  | UI server              | Override for self-hosted GitLab (default `https://gitlab.com/api/v4`).   |

The UI's `next dev` only sees variables set in `ui/.env.local` —
`NEXT_PUBLIC_*` alone is not enough for any of the above.

### MongoDB collections

| Collection         | What it stores                                                              |
| ------------------ | --------------------------------------------------------------------------- |
| `agent_skills`     | User-authored persisted skills (the Skills Gallery's primary collection).   |
| `skill_revisions`  | Revision history for `agent_skills` (default retention: 10 per skill).      |
| `skill_hubs`       | Hub registrations (GitHub / GitLab, `include_paths`, credentials ref, schedule). |
| `hub_skills`       | Cache of `SKILL.md` files crawled from registered hubs. Read-only.          |
| `skill_scan_findings` | Scanner output keyed by skill content hash. Drives the [scan gate](#scan-gating). |
| `catalog_api_keys` | Hashes + metadata of catalog API keys minted from the Skills API Gateway.   |

For the index strategy and field-by-field types, see
[data-model.md](../../specs/2026-04-29-skills-api-unification/data-model.md)
in the unification spec.

### Catalog API keys

The Skills API Gateway mints **catalog API keys** (`catalog_api_keys`
collection) that the install one-liner and external coding agents send
as `X-Caipe-Catalog-Key`. Key values are stored hashed; the cleartext
token is shown to the user once at mint time.

The Quick Install dialog on the Gateway page can also render a
**bootstrap snippet** that writes the key into `~/.config/caipe/config.json`
before invoking `curl | bash`. This solves the post-`--purge` re-install
case (where the config file was deleted) without leaking the key into
shell history. The snippet uses a single-quoted heredoc and `chmod 600`
so the file lands with safe permissions.

## Architecture

The runtime path from "user types something" to "skill body reaches the
LLM" looks like this:

```text
                      ┌────────────────────────────────────┐
                      │            CAIPE UI                │
                      │  /skills (Gallery)                 │
                      │  /skills/gateway (Gateway)         │
                      └──────────────┬─────────────────────┘
                                     │
              GET /api/skills?...    │       POST /api/skills/configs/...
                                     ▼
              ┌──────────────────────────────────────────┐
              │     UI server (Next.js route handlers)   │
              │   Merges 3 sources, applies scan gate    │
              └──────────────────────────────────────────┘
                  │           │            │
        agent_skills    skill_hubs (via    chart ConfigMap
        (Mongo)         hub_skills cache)  (filesystem)
                  │           │            │
                  └─────┬─────┴─────┬──────┘
                        │           │
                        ▼           ▼
              ┌────────────────────────────────────┐
              │     skill_scan_findings (Mongo)    │
              │     + scanner sidecar (optional)   │
              │     SKILL_SCANNER_GATE drops the   │
              │     blocked / unscanned skills     │
              └────────────────────────────────────┘

──── chat path ──────────────────────────────────┬─── install / fetch path ────
                                                 │
   Supervisor (Python)                           │   GET /api/skills (Gateway)
     ↓ skills_middleware loader                  │     ↓
     ↓ get_scan_gate() / mongo_scan_filter()     │   coding agent renders
     ↓ injects SKILL.md into StateBackend        │   /skills slash command
     ↓ as virtual files                          │     ↓
     ↓                                           │   user runs curl | bash
   LangGraph runtime                             │     ↓
     ↓ deepagents.SkillsMiddleware exposes       │   ~/.claude/skills/<name>/SKILL.md
     ↓ SKILL.md content to the LLM               │   ~/.agents/skills/<name>/SKILL.md
     ↓                                           │
   Tool calls / response                         │   Coding agent slash command
                                                 │   surfaces it to the user
```

### Three retrieval paths, one catalog

A single `SKILL.md` reaches three very different consumers, all reading
the same merged catalog:

1. **Chat (supervisor side)** — Python skills middleware loader queries
   the same Mongo collections + filesystem the UI does, applies the same
   scan gate, mounts `SKILL.md` content as virtual files in the agent's
   `StateBackend` so the LLM sees them as plain files. Implementation
   spec: [`097-skills-middleware-integration`](../../specs/097-skills-middleware-integration/spec.md)
   (in particular [`contracts/catalog-api.md`](../../specs/097-skills-middleware-integration/contracts/catalog-api.md)).
2. **Install one-liner (`/api/skills/install.sh`)** — UI server renders
   a bash script that walks the catalog and writes each `SKILL.md` to
   the two universal paths (per scope). Manifest entry shape:
   `{ "name": ..., "paths": [..., ...] }`
   ([FR-012](../../specs/2026-05-04-skills-only-overhaul/spec.md#functional-requirements)).
3. **External coding agent** — talks to `GET /api/skills` directly via
   the rendered `/skills` slash command, fetches single skills on
   demand. The catalog's response shape is documented in
   [`contracts/rest-api.md`](../../specs/2026-04-29-skills-api-unification/contracts/rest-api.md).

### Why one `SKILL.md` for every agent

Earlier versions of CAIPE shipped per-agent file formats (Claude markdown
+ frontmatter, Gemini TOML, Continue JSON fragment, …) and per-agent
directory layouts (`commands/` vs `skills/`). The major coding agents
have since converged on the open
[agentskills.io `SKILL.md`](https://agentskills.io/) format under
`skills/<name>/SKILL.md`, which means a single file at a single path
is now sufficient for Claude Code, Cursor, Codex CLI, Gemini CLI, and
opencode. The
[`2026-05-04-skills-only-overhaul`](../../specs/2026-05-04-skills-only-overhaul/spec.md)
spec walks through the migration: drop the layout toggle, drop four of
the five per-agent renderers, install once to two universal paths.

### Where the API surface lives

There are two HTTP surfaces, often confused:

- **UI server** (`ui/src/app/api/skills/...`, `ui/src/app/api/skill-hubs/...`)
  — what your browser and the install one-liner talk to. Owns Mongo
  reads/writes, AI Assist proxying, hub crawling, install-script
  rendering, key minting. This is the surface the
  [REST API contract](../../specs/2026-04-29-skills-api-unification/contracts/rest-api.md)
  documents.
- **Skills middleware router** (`ai_platform_engineering/skills_middleware/router.py`)
  — what the **supervisor** exposes for internal coordination.
  Includes `/skills/refresh`,
  `/internal/supervisor/skills-status`, `/skill-hubs/crawl`,
  `/skills/scan-content`, and the `/catalog-api-keys` mint/list/delete
  endpoints. End users typically don't hit these directly.

The two surfaces never duplicate writes — the UI server owns the Mongo
collections; the supervisor reads the same collections through the
shared loader.

## Glossary

- **Agent skill** — a `SKILL.md` persisted in `agent_skills`, editable
  in the Gallery.
- **Hub skill** — a `SKILL.md` cached in `hub_skills` from a registered
  external repo. Read-only.
- **Scope** — `user` (`~/.claude/skills/...`, `~/.agents/skills/...`)
  or `project` (`./.claude/skills/...`, `./.agents/skills/...`).
  The Quick Install UI hides project scope behind an Advanced
  disclosure.
- **Manifest** — `~/.config/caipe/installed.json` (user) or
  `./.caipe/installed.json` (project). Lists every file written by the
  installer so `mode=uninstall` can clean up.
- **`SKILL_SCANNER_GATE`** — env var, `off | warn | strict`. Default
  `warn`. See [Scan gating](#scan-gating).

## See also

- **Live-skills slash command (operator deep-dive)** — [docs/ui/skills-live-skills.md](../../ui/skills-live-skills.md)
- **API unification spec** (data model, REST contracts, MongoDB
  migration notes) — [specs/2026-04-29-skills-api-unification](../../specs/2026-04-29-skills-api-unification/spec.md)
- **Skills-only installer overhaul spec** (single `SKILL.md` layout,
  manifest shape, multi-source crawl with `include_paths`) —
  [specs/2026-05-04-skills-only-overhaul](../../specs/2026-05-04-skills-only-overhaul/spec.md)
- **Skills middleware integration spec** (supervisor side: catalog
  loader, scanner pipeline, hub crawl contract) —
  [specs/097-skills-middleware-integration](../../specs/097-skills-middleware-integration/spec.md)
- **CAIPE UI features overview** — [docs/ui/features.md](../../ui/features.md)

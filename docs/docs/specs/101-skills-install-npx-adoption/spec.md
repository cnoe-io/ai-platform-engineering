# Feature Specification: Adopt `npx skills` / agent-native installers as primary install path for CAIPE skills

**Feature Branch**: `101-skills-install-npx-adoption`
**Created**: 2026-04-22
**Status**: Draft (forward-looking; no code changes in this PR)
**Input**: User description: "How do popular repos do it? Pick your agent. One command. Done. (caveman example using `claude plugin marketplace`, `gemini extensions install`, `npx skills add`). Can we use that mode? This may need rethinking and refactoring."

## Context & Motivation

Today the CAIPE skills gateway (`ui/src/app/api/skills/...`) ships its own installer surface:

- `/api/skills` — authenticated catalog (Mongo + `SKILLS_DIR`, hub aggregation, per-agent projection)
- `/api/skills/install.sh` — generated bash installer (curl + jq, sidecar manifest at `~/.config/caipe/installed.json`)
- `/api/skills/bootstrap` — meta-skill template that teaches an agent to call the catalog
- UI: `ui/src/components/skills/TrySkillsGateway.tsx` shows the per-agent install snippets

Recent PR #1268 already standardized output to the modern `skills/<name>/SKILL.md` layout (`e-skills-layout`) and added a sidecar manifest in place of in-file ownership markers.

In parallel, the broader ecosystem has converged on three install rails that work for **any** skills repo without us writing or maintaining an installer:

| Rail | Owner | Scope |
|---|---|---|
| `claude plugin marketplace add <repo>` + `claude plugin install <name>@<source>` | Anthropic / Claude Code | Claude Code only, native marketplace |
| `gemini extensions install <git-url>` | Google / Gemini CLI | Gemini CLI only, git-URL based |
| `npx skills add <repo> -a <agent>` | [agentskills.io](https://agentskills.io) ([`skillsdotmd/skills`](https://github.com/skillsdotmd/skills)) | 45+ agents (Cursor, Windsurf, Copilot, Cline, opencode, Codex, …); single canonical `skills/<name>/SKILL.md` source layout |

The reference example ([`juliusbrussee/caveman`](https://github.com/juliusbrussee/caveman)) ships **no installer of its own** — it just lays out skills as `skills/<name>/SKILL.md` at the repo root and lets the three rails above do the rest:

```
Pick your agent. One command. Done.

Claude Code   claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman
Codex         Clone repo → /plugins → Search "Caveman" → Install
Gemini CLI    gemini extensions install https://github.com/JuliusBrussee/caveman
Cursor        npx skills add JuliusBrussee/caveman -a cursor
Windsurf      npx skills add JuliusBrussee/caveman -a windsurf
Copilot       npx skills add JuliusBrussee/caveman -a github-copilot
Cline         npx skills add JuliusBrussee/caveman -a cline
Any other     npx skills add JuliusBrussee/caveman
```

This spec captures the rethink/refactor needed so CAIPE can recommend that same model wherever applicable, while keeping `/api/skills` for the things only we can do (authenticated catalog, hub aggregation, dynamic per-tenant projection, bulk install of curated bundles).

### Scope (this repo only)

In scope (`ai-platform-engineering`):

- UI: `ui/src/components/skills/TrySkillsGateway.tsx`
- API: `ui/src/app/api/skills/**` (catalog, `install.sh`, `bootstrap`)
- Bootstrap template: `charts/ai-platform-engineering/data/skills/bootstrap.md`
- Docs in this repo (READMEs, `docs/`)
- Skill source layout for any skills shipped from this repo (already `skills/<name>/SKILL.md` after #1268)

Out of scope:

- `platform-apps-deployment` Helm values (default hubs, etc.)
- Upstream changes to `skillsdotmd/skills`
- New skills repos under `cnoe-io/`
- Claude / Gemini / Cursor product changes

## User Scenarios & Testing *(mandatory)*

### User Story 1 — One-command install for the common case (Priority: P1)

A platform engineer lands on the CAIPE Skills page, picks their coding agent, and copies a single, ecosystem-standard install command that works without any CAIPE-specific tooling, API key, or shell glue.

**Why this priority**: This is the 80% case. Today users are asked to copy a multi-line `curl … | bash` from us; the rest of the industry already offers `npx skills add <repo> -a <agent>` (or the agent-native equivalent). Matching that UX is the single highest-leverage UX win for skills adoption.

**Independent Test**: Open `TrySkillsGateway`, select Cursor, copy the primary command, paste into a clean shell. Skill files materialize in the agent's expected location. No CAIPE binary, no API key, no `install.sh` involvement.

**Acceptance Scenarios**:

1. **Given** a public CAIPE-published skill repo at `cnoe-io/<repo>` with a `skills/<name>/SKILL.md` layout, **When** a user selects Cursor and runs the suggested primary command, **Then** the command is exactly `npx skills add cnoe-io/<repo> -a cursor` (or the documented equivalent for that agent rail).
2. **Given** the user selects Claude Code, **When** they copy the primary command, **Then** the command uses Claude's native marketplace (`claude plugin marketplace add … && claude plugin install …`) rather than our `install.sh`.
3. **Given** the user selects Gemini CLI, **When** they copy the primary command, **Then** the command uses `gemini extensions install <git-url>`.
4. **Given** the user selects an agent that none of the three rails support, **When** they copy the primary command, **Then** they fall back to our `install.sh` flow (today's behavior) and the UI labels this clearly.

---

### User Story 2 — Authenticated catalog & bulk install remain first-class (Priority: P1)

A platform engineer needs to install **every** skill from a private CAIPE hub (e.g. an internal `your-org/your-skills-repo` mirror) into their local agent in one step, with API-key auth and a sidecar manifest for later upgrade/uninstall.

**Why this priority**: This is the capability `npx skills` does **not** offer. It's the actual product differentiator of `/api/skills`: authenticated, hub-aggregated, projected-per-agent, bulk-installable. Losing it would be a regression; we must keep it surfaced clearly even after demoting it from the default.

**Independent Test**: From an authenticated UI session, copy the "Bulk install from hub" command. Run it. All skills in the hub land under the agent's skills directory; `~/.config/caipe/installed.json` is updated; re-running upgrades cleanly.

**Acceptance Scenarios**:

1. **Given** the user belongs to a tenant with private hubs, **When** they expand the "Advanced / Bulk / Authenticated" disclosure on the skills page, **Then** they see today's `install.sh` snippets (single-skill and hub-bulk variants) with API key handled via `~/.config/caipe/config.json`.
2. **Given** a hub contains 12 skills, **When** the user runs the bulk install command, **Then** all 12 skills are installed under the correct per-agent layout (`skills/` or `commands/` per the agent's `defaultLayout` and the user's toggle) with a single sidecar manifest entry per file.
3. **Given** the user later wants to uninstall, **When** they run the documented uninstall command (driven off `~/.config/caipe/installed.json`), **Then** only files this gateway installed are removed — no foreign files are touched.

---

### User Story 3 — `/api/skills` exposes a `skills.json` source so `npx skills` can install **from our catalog** (Priority: P2)

A platform engineer points `npx skills` at a CAIPE catalog URL (instead of a git repo) and `npx skills` resolves and installs from CAIPE the same way it would from GitHub.

**Why this priority**: This is the unification play. If CAIPE serves a spec-compliant `skills.json` manifest (the `agentskills.io` source format) from `/api/skills/<scope>/skills.json`, then **one** command — `npx skills add https://caipe.example.com/api/skills/<scope> -a <agent>` — works for both public OSS skills (via GitHub) and CAIPE-curated catalogs (via our gateway). At that point our `install.sh` becomes truly optional and we ride someone else's translation matrix for free.

It is P2 (not P1) because it depends on `npx skills` supporting (or being upstreamable to support) HTTP sources with `Authorization: Bearer …` for private catalogs. That needs a spike before committing.

**Independent Test**: Run `npx skills add https://<caipe-host>/api/skills/<hub> -a cursor` against a running CAIPE deployment with a single skill in the named hub. Skill lands in `~/.cursor/rules/...` (or current Cursor location). Repeat with `-a gemini-cli` against a Gemini install.

**Acceptance Scenarios**:

1. **Given** a CAIPE deployment serving `/api/skills/<scope>/skills.json` per the agentskills.io source spec, **When** `npx skills add <url> -a <agent>` is invoked, **Then** the manifest, skill bodies, and any per-agent assets are fetched and laid down identically to the equivalent GitHub-source install.
2. **Given** the catalog requires an API key, **When** the user exports `SKILLS_AUTH_BEARER=<key>` (or the upstream-supported env var), **Then** `npx skills add <authenticated-url>` succeeds; **Otherwise** it fails with a clear "401 / catalog requires authentication" error.
3. **Given** `npx skills` does **not** support HTTP sources at all in the current upstream, **When** that is confirmed by the spike, **Then** we either (a) ship a tiny CAIPE shim that produces the manifest a contributor can `git clone` and feed to `npx skills`, or (b) open an upstream PR — but in either case we do **not** silently regress User Story 1.

---

### Edge Cases

- A user selects a layout (`skills` vs `commands`) that an agent rail doesn't support — UI must hide the irrelevant rail or fall back gracefully (already partly addressed by `e-skills-layout`).
- A skills repo doesn't yet follow `skills/<name>/SKILL.md` layout — must be flagged in repo lint; `npx skills` won't install it correctly otherwise.
- An offline / air-gapped user can't reach `npx`, GitHub, or Anthropic's marketplace — `install.sh` against a mirrored catalog stays the only option.
- `npx skills` ships a breaking change to its CLI — we must pin a known-good version in our recommended snippets.
- A user already has skills installed via `install.sh` (with sidecar manifest) and re-installs the same skill via `npx skills` — collision behavior must be defined (likely: `npx skills` wins the file; sidecar manifest is invalidated for that entry on next CAIPE install run).
- A private catalog returns a paginated `skills.json` — spec must define whether `npx skills` follows pagination or whether we serve a flat manifest.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The skills install UI MUST present, for each supported agent, a single primary "one-command" install snippet drawn from the appropriate ecosystem rail (`claude plugin marketplace …`, `gemini extensions install …`, or `npx skills add …`) when one exists for that agent.
- **FR-002**: The skills install UI MUST demote today's `curl … /api/skills/install.sh | bash` snippets to a clearly labeled "Advanced / Bulk / Authenticated" disclosure that is collapsed by default.
- **FR-003**: For agents with no native rail and no `npx skills` adapter, the UI MUST fall back to the `install.sh` flow as the primary command and surface a short "no native installer available for this agent" note.
- **FR-004**: The bootstrap skill template (`charts/ai-platform-engineering/data/skills/bootstrap.md`) MUST lead with the ecosystem-standard install command for the chosen agent and reference `install.sh` only for bulk / authenticated catalog use cases.
- **FR-005**: All CAIPE-shipped skills MUST be authored in the canonical `skills/<name>/SKILL.md` source layout so they are installable by `npx skills` without per-agent rewrites. (Already enforced by #1268 for installs; this requirement extends it to source repos.)
- **FR-006**: `/api/skills/install.sh` MUST continue to work unchanged for: (a) bulk install from a hub, (b) authenticated catalog access, (c) agents with no ecosystem rail, (d) air-gapped mirroring scenarios.
- **FR-007**: The catalog API MUST expose a spec-compliant `skills.json` source manifest at `/api/skills/<scope>/skills.json` (or equivalent) so that `npx skills add <caipe-url> -a <agent>` is a viable install path. *(P2 — gated on FR-008.)*
- **FR-008**: Before implementing FR-007, a spike MUST verify that `npx skills` supports HTTP sources and `Authorization` headers (or document an upstream-PR path or shim alternative).
- **FR-009**: For each agent shown in the UI, the source-of-truth for "which rail is primary" MUST live in `ui/src/app/api/skills/bootstrap/agents.ts` alongside existing `installPaths` / `defaultLayout` so future agents can be added in one place.
- **FR-010**: The recommended `npx skills` invocation MUST pin a known-good version (e.g. `npx -y skills@<pinned>`) to avoid CLI breakage; the pinned version MUST be configurable via Helm.
- **FR-011**: When both a native rail (`claude plugin …`) and `npx skills` work for the same agent (e.g. Claude Code), the UI MUST default to the native rail and offer the `npx skills` form as a secondary tab.
- **FR-012**: Documentation in this repo (README, `docs/`, bootstrap.md) MUST be updated to reflect the new install-rail hierarchy: native → `npx skills` → CAIPE `install.sh`.
- **FR-013**: Telemetry / structured logs in `/api/skills/install.sh/route.ts` MUST continue to record installer usage so we can measure the actual decline of `install.sh` traffic relative to ecosystem rails over time.
- **FR-014**: No regression in the `e-skills-layout` toggle (skills/ vs commands/) — the layout choice must continue to apply to whichever installer the user ultimately runs, including when CAIPE serves `skills.json` to `npx skills` (FR-007).

### Key Entities

- **Install Rail**: A named ecosystem path for getting a skill onto an agent. Attributes: `id` (`claude-marketplace` | `gemini-extensions` | `npx-skills` | `caipe-install-sh`), `agentIds[]` it supports, `commandTemplate`, whether it requires a public git source, whether it supports authenticated remote catalogs.
- **Agent Spec** (existing, in `agents.ts`): extended with `primaryRail`, `secondaryRails[]`, and (for FR-007) optional `caipeSourceUrlTemplate`.
- **Skills Source Manifest** (`skills.json`): the agentskills.io-compliant document CAIPE emits at `/api/skills/<scope>/skills.json` for FR-007. Attributes: list of skills with `name`, `path`, `agents`, `version`, optional `auth` hint.
- **Sidecar Manifest** (existing, `~/.config/caipe/installed.json`): unchanged in scope; just clarified to apply only to the `caipe-install-sh` rail.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every agent currently listed in `agents.ts` that has a native rail or `npx skills` adapter, the primary install snippet shown in the UI is a single line (≤120 chars), with no `curl | bash`, no API key, and no CAIPE-specific tooling required.
- **SC-002**: ≥80% of new skill installs (measured via `/api/skills/install.sh` traffic decline + ecosystem-rail click-throughs in the UI) shift off `install.sh` within one quarter of shipping User Story 1.
- **SC-003**: A user new to CAIPE can install one skill into their preferred agent in **under 30 seconds** from landing on the skills page (copy command, paste, done).
- **SC-004**: No regression in bulk-from-hub install: time-to-install all skills in a 12-skill hub remains ≤ today's baseline, and the sidecar manifest is byte-identical for the install.sh path.
- **SC-005**: The spike for FR-008 (`npx skills` HTTP-source + auth) produces a written go/no-go decision within one engineering week and is linked from this spec.
- **SC-006**: All CAIPE-shipped skill repos pass an `npx skills` dry-run install for at least Cursor and one other agent (proving FR-005 holds in practice).
- **SC-007**: Zero increase in support tickets categorized as "install failed" attributable to the rail change in the four weeks following rollout.

## Open Questions / Decisions Needed

1. **D-1**: Confirm whether `npx skills` supports HTTP/HTTPS sources with bearer auth today, partially, or not at all. (Drives FR-007/FR-008.)
2. **D-2**: For Claude Code, do we publish a Claude marketplace entry for CAIPE-curated skills, or do we only document `npx skills add cnoe-io/<repo> -a claude-code` and skip the marketplace step? (Marketplace publishing has ongoing maintenance cost.)
3. **D-3**: Pinned `npx skills` version policy — pin in Helm, in the bootstrap template, or both?
4. **D-4**: For private/internal hubs, do we rely on `npx skills` HTTP support (if FR-008 passes) or always recommend `install.sh` for those? Most likely the latter, at least initially.
5. **D-5**: Do we keep the `e-skills-layout` UI toggle visible once `npx skills` is the default, or hide it (since `npx skills` makes the layout decision per agent)?

## Non-Goals

- Replacing `/api/skills` itself. The catalog, projection, and hub aggregation stay.
- Building our own marketplace or competing with `agentskills.io`.
- Backfilling old skills repos that don't follow `skills/<name>/SKILL.md` — those stay on `install.sh` until they're migrated.
- Any work in `platform-apps-deployment` (default hubs, Helm values for downstream tenants) — tracked separately.

## Recommended Sequencing

1. **Spike (D-1, FR-008)** — 1 engineering day. Determine `npx skills` HTTP/auth support. Produce written decision.
2. **Phase 1 (User Story 1, P1)** — UI + bootstrap.md + docs. Land as a follow-up PR after #1268. No `/api/skills` changes.
3. **Phase 2 (User Story 2, P1)** — explicit "Advanced / Bulk / Authenticated" disclosure refresh; ensure no regression.
4. **Phase 3 (User Story 3, P2)** — gated on D-1. Ship `skills.json` source endpoint if feasible; otherwise document the workaround.
5. **Phase 4 (FR-005, FR-006 lint)** — repo-level lint job that fails CI on CAIPE skills repos missing `skills/<name>/SKILL.md`.

# Feature Specification: Skills-Only Installer Overhaul

**Feature Branch**: `fix/skills-ai-generate-use-dynamic-agents` (continuing on existing branch)
**Created**: 2026-05-04
**Status**: Draft (Phases 1-5 implemented; Phase 6 — multi-source crawl + path filtering — added 2026-05-04 as a follow-up on the same branch)
**Input**: Refactor the CAIPE skill installer (`/api/skills/install.sh`) to use a single `SKILL.md` layout for every supported coding agent, drop the legacy `commands/` layout toggle and per-agent file-format machinery, install each skill to two universal locations per scope so one install satisfies all five supported agents, and migrate the two CAIPE helper slash commands to the new layout. Phase 6 extends the catalog ingestion side: bring GitLab to feature parity with GitHub in the per-skill ad-hoc importer, and add an `include_paths` filter to both the hub-level crawler and the per-skill importer so admins can pin ingestion to specific subdirectories of large monorepos.

## Background

The CAIPE Skills API Gateway today exposes `/api/skills/install.sh` — a one-line `curl | bash` installer that drops every catalog skill onto a user's machine in a per-agent file format and directory layout. It supports two layouts (`commands` and `skills`) and four file formats (`markdown-frontmatter`, `markdown-plain`, `gemini-toml`, `continue-json-fragment`), driven by the agent registry in `ui/src/app/api/skills/live-skills/agents.ts`.

Since shipping that installer, the four major coding agents that we target (Claude Code, Cursor, Codex CLI, Gemini CLI) plus a fifth (opencode) have **all** standardized on the open `agentskills.io` `SKILL.md` format under a `skills/<name>/SKILL.md` tree (see [Claude Code](https://docs.claude.com/en/docs/claude-code/skills), [Cursor](https://cursor.com/docs/skills), [Codex](https://developers.openai.com/codex/skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/), [opencode](https://opencode.ai/docs/skills/)). All five also auto-discover from a vendor-neutral `~/.agents/skills/` mirror. Continue and Spec Kit, the two outliers we previously had to special-case, are no longer worth carrying.

This means the layout toggle, the four per-agent renderers, the format/extension/fragment plumbing, and the `~/.claude/settings.json` allowlist patch are all dead weight. Every install can write the same `SKILL.md` to the same two universal paths, regardless of which agent the user picked in the UI.

## User Scenarios & Testing

### User Story 1 — One install, every agent (Priority: P1)

A developer runs the default `curl | bash` installer once. They later switch from Claude Code to Cursor (or add Codex CLI alongside). Their CAIPE skills are already discoverable in the new agent — no second install needed.

**Why this priority**: This is the core user-facing simplification of the overhaul. Today the agent picker isn't just cosmetic — picking the wrong one writes to the wrong directory and the user has to re-run install. After this work, the picker only changes the launch guide text shown in the UI; the bytes on disk are identical.

**Independent Test**:

1. Run `curl -fsSL '<gateway>/api/skills/install.sh?agent=claude&scope=user' | bash` against a clean `$HOME`.
2. Inspect `~/.claude/skills/<name>/SKILL.md` and `~/.agents/skills/<name>/SKILL.md` — both exist for every catalog skill.
3. Re-run with `?agent=cursor` against the same `$HOME` — every file is byte-identical (idempotent), no churn in the manifest.

**Acceptance Scenarios**:

1. **Given** a catalog with N non-flagged skills, **When** the user runs install with `agent=claude&scope=user`, **Then** `2*N` files are written (one per skill into `~/.claude/skills/<name>/SKILL.md` and one into `~/.agents/skills/<name>/SKILL.md`), every file is a valid `SKILL.md` with `name:` and `description:` frontmatter, and the manifest records `paths: [<both paths>]` per entry.
2. **Given** install has already been run with `agent=claude`, **When** the user re-runs with `agent=cursor` (same scope), **Then** zero new files are written, the manifest is unchanged, and the launch-guide footer reflects Cursor's slash command syntax.
3. **Given** the user picks `scope=project` from the Advanced disclosure, **When** install runs, **Then** files land in `.claude/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md` under the current working directory, the manifest is `./.caipe/installed.json`, and the success card includes a `.gitignore` reminder for `.caipe/` and `.claude/` and `.agents/`.

---

### User Story 2 — Helpers ship as real Skills (Priority: P1)

The two CAIPE-authored helpers (`/skills` for the live catalog browser, `/update-skills` for in-place upgrades) install as proper `SKILL.md` files alongside the catalog skills, with the right frontmatter so the agent does not nag the user for permission every time the helper shells out to the local Python catalog client.

**Why this priority**: The helpers are how users discover the live catalog and roll forward without re-running `curl | bash`. Today they install as `commands/<name>.md` files plus a special-case allowlist patch in `~/.claude/settings.json`. Moving them into the same `skills/<name>/SKILL.md` tree as everything else removes the special case and makes the install behavior uniform.

**Independent Test**:

1. Install with default flags. Confirm `~/.claude/skills/skills/SKILL.md` and `~/.claude/skills/update-skills/SKILL.md` exist with `disable-model-invocation: true` and an `allowed-tools:` line that pre-approves `Bash(uv run ~/.config/caipe/caipe-skills.py*)` and `Bash(python3 ~/.config/caipe/caipe-skills.py*)`.
2. Inspect `~/.claude/settings.json` — the SessionStart hook entry is present, but the two `Bash(...caipe-skills.py*)` allowlist entries are gone.
3. Run `/skills` inside Claude Code — no permission prompt fires for the Python invocation.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the helper templates are rendered, **Then** their frontmatter contains exactly `name`, `description`, `disable-model-invocation: true`, and an `allowed-tools` array with both the `uv run` and `python3` invocations of the catalog client (so users without `uv` still get pre-approval).
2. **Given** an install that previously wrote helpers in `commands/` layout, **When** the user re-runs install with `--upgrade`, **Then** the legacy `~/.claude/commands/skills.md`, `~/.claude/commands/update-skills.md`, `~/.cursor/commands/...`, `~/.codex/prompts/...`, `~/.gemini/commands/...`, and `~/.config/opencode/command/...` files are removed and replaced with the new `SKILL.md` layout.
3. **Given** a previous install added the two `Bash(...caipe-skills.py*)` allowlist entries to `~/.claude/settings.json`, **When** the user re-runs install, **Then** those two specific entries are removed from `permissions.allow` while the SessionStart hook entry under `hooks` is preserved untouched.

---

### User Story 3 — Sane uninstall across both scopes (Priority: P2)

A developer who installed at both user and project scope runs the uninstall one-liner once and gets prompted to clean each manifest's entries individually with the existing `y/N/a/q` confirmation flow.

**Why this priority**: Today's uninstall walks one manifest per invocation (the scope passed in). Once an install lays down two paths per skill into universal locations, the manifest entry shape has to widen from `path: <string>` to `paths: <string[]>` and the uninstall has to know how to enumerate, prompt for, and remove every file in the array. Walking both manifests in one run also matches user expectations once the project scope is demoted to "advanced".

**Independent Test**:

1. Install at `scope=user`, then `cd` into a project and install at `scope=project`. Verify both manifests exist and both reference `paths: [<2 entries>]` per skill.
2. Run `curl -fsSL '<gateway>/api/skills/install.sh?mode=uninstall' | bash` (no `scope=` param).
3. Confirm the script walks the user manifest first, then the project manifest, prompting per skill in each, and that an `a` (apply-to-all) answer in the user-manifest pass does **not** auto-apply across the project-manifest pass (each manifest's prompt loop is independent — explicit consent per scope).

**Acceptance Scenarios**:

1. **Given** both user and project manifests exist, **When** uninstall runs without `scope=`, **Then** both manifests are walked in deterministic order (user, then project), each with its own y/N/a/q loop, and an empty parent skill directory (`<root>/skills/<name>/`) is removed once its `SKILL.md` is gone.
2. **Given** a manifest entry of the new shape `{ "name": "...", "paths": ["~/.claude/skills/foo/SKILL.md", "~/.agents/skills/foo/SKILL.md"] }`, **When** the user confirms uninstall for that entry, **Then** both files are removed in a single confirmation, and the parent `skills/foo/` directory is rmdir'd in each tree if empty.
3. **Given** a legacy manifest entry of the old shape `{ "name": "...", "path": "~/.claude/commands/foo.md" }`, **When** uninstall runs, **Then** the script handles the legacy shape transparently (treats `path` as a one-element `paths`), removes the file, and the manifest is rewritten in the new shape.
4. **Given** the user passes `--purge` to a full-uninstall flow, **When** the script finishes removing skill files, **Then** `~/.config/caipe/config.json` and `./.caipe/config.json` are also deleted (existing behavior preserved).

---

### User Story 4 — Multi-source crawl with path filtering (Priority: P2)

A platform admin needs to register a **GitLab** monorepo (e.g. `mycorp/platform`) as a skill hub the same way they register a GitHub repo today, **and** they need to point the crawler at one or more specific subdirectories (e.g. `["skills/", "agents/example/skills/"]`) instead of having it walk the entire repo. A skill author also needs to import siblings of an arbitrary path from a GitLab project the same way `import-github` lets them today for GitHub.

**Why this priority**: The existing hub crawler already has a `crawlGitLabRepo` implementation, but the **per-skill ad-hoc importer** (`POST /api/skills/import-github` + the `GithubImportPanel` workspace UI) is GitHub-only — a GitLab user cannot bootstrap a skill from their company repo without copy-paste. Separately, both crawlers walk the **entire** repo tree on every refresh (one `tree?recursive=1` call) and only filter at the `SKILL.md` discovery step. For a large monorepo where SKILL.md files live under a known prefix, this wastes API quota, slows refreshes, and pulls in unrelated `SKILL.md` files (e.g. third-party submodules vendored under `vendor/`). A simple `include_paths: string[]` filter on the hub doc — and a `paths: string[]` array on the per-skill import body — fixes both problems without changing any other surface.

**Independent Test**:

1. Register a GitLab hub via `POST /api/skill-hubs` with `{ "type": "gitlab", "location": "mycorp/platform", "include_paths": ["skills/", "agents/observability/skills/"] }`. Trigger a refresh. Inspect `hub_skills` cache: only SKILL.md files whose path starts with one of the two prefixes are present; everything else is ignored.
2. Re-register the same hub without `include_paths` (or with `[]`) — every SKILL.md in the tree is crawled (current behavior preserved).
3. From the workspace editor, open the import panel and select **GitLab** as the source. Enter `mycorp/platform` and `skills/example`. Confirm the same `Record<string, string>` of imported files lands in the editor as the GitHub case.
4. Use the import panel's "Add another path" affordance to specify two prefixes — `["skills/example", "skills/example-shared"]`. Confirm both directories' files are flattened into the same imported map (with conflict detection: a duplicate filename across two paths surfaces a warning and keeps the first).

**Acceptance Scenarios**:

1. **Given** a hub with `type: "gitlab"` and `include_paths: ["skills/", "agents/foo/skills/"]`, **When** the crawler runs, **Then** it issues the same single `tree?recursive=true` request, but the `SKILL.md` candidate list is filtered to entries whose path starts with one of the prefixes (with a trailing `/` enforced server-side so `skills` does not match `skills-archive/`).
2. **Given** a hub with `include_paths: []` or `include_paths` absent, **When** the crawler runs, **Then** behavior matches today's "walk the whole repo" semantics — full backward compatibility.
3. **Given** a per-skill import request with `{ "source": "gitlab", "repo": "mycorp/platform", "paths": ["skills/example"], "credentials_ref": "GITLAB_TOKEN_FOO" }`, **When** the API resolves it, **Then** the request hits `${GITLAB_API_URL}/projects/mycorp%2Fplatform/repository/tree?recursive=true&per_page=100`, the response is filtered to `paths[0]`'s prefix (excluding `SKILL.md` itself, matching today's GitHub behavior), and each blob is fetched via `repository/files/<encoded>/raw?ref=HEAD`.
4. **Given** a per-skill import request with `paths: ["skills/a", "skills/b"]`, **When** the API resolves it, **Then** files from both prefixes are merged into one `files: Record<string, string>` map; if two prefixes contain the same relative filename, the response includes `conflicts: [{ name, kept_from, dropped_from }]` and the first prefix's content wins.
5. **Given** an admin uses the workspace editor's import panel, **When** they switch the source toggle from GitHub to GitLab, **Then** the placeholder text updates (`mycorp/platform` instead of `anthropics/skills`), the credentials hint updates (`GITLAB_TOKEN` instead of `GITHUB_TOKEN`), and the request body sets `source: "gitlab"`.
6. **Given** a hub registration form, **When** the admin pastes a GitLab subgroup URL like `https://gitlab.com/mycorp/devops/platform`, **Then** the location is normalized to `mycorp/devops/platform` (preserving subgroup nesting — unlike GitHub's flat `owner/repo`, GitLab supports arbitrary group nesting; the existing two-segment normalization is a bug for this case and MUST be widened to keep every path segment).

---

### Edge Cases

- **Mid-flight migration**: A user has a previous CAIPE install that used the `commands/` layout. They re-run install (without `--upgrade`). Behavior: the new install lays down the `SKILL.md` files alongside the legacy `.md` commands. The `--upgrade` path is the only way to clean the legacy artifacts. Document this clearly in the success-card output.
- **GitLab subgroup nesting**: GitLab projects can live arbitrarily deep (`group/subgroup/sub-subgroup/project`). The existing `POST /api/skill-hubs` URL normalizer truncates to two segments, which silently corrupts subgroup hubs. The fix MUST detect a `gitlab.com` URL (or the configured `GITLAB_API_URL` host) and keep every path segment after the host, not just the first two.
- **`include_paths` matches zero `SKILL.md` files**: The crawl succeeds but returns an empty list. The hub's `last_success_at` is set; `last_failure_message` stays null; the admin sees `0 skills` in the hub list with a tooltip ("0 SKILL.md files matched the configured `include_paths`"). This is not an error — empty is a valid configured state.
- **`include_paths` prefix without trailing slash**: The server normalizes `skills` → `skills/` on write so `skills` does not accidentally match `skills-archive/SKILL.md`. The original (un-normalized) input is shown back to the admin in the UI for clarity.
- **GitLab token absent**: Public GitLab projects work without a token. The crawler MUST attempt unauthenticated access first and only error out with `authentication required` if the response is 401 or 403 (the GitLab API returns `404 Not Found` for unauthenticated reads of private projects, which is a misleading error — surface a friendly message).
- **Per-skill import with conflicting paths**: When the user provides multiple `paths[]` and two of them contain the same relative filename, the API returns the merged map with first-wins semantics plus a `conflicts: []` array so the editor can surface a "skipped 2 duplicate files" toast. No data loss, no silent overwrite.
- **GitLab `include_paths` against a path that overlaps a nested SKILL.md owner**: Same nested-skill protection as today (`belongsToNestedSkill` in `hub-crawl.ts`) — once a SKILL.md is found at a deeper level, files belonging to that deeper skill are not duplicated into the parent's `ancillary_files`. This invariant MUST hold across both filtered and unfiltered crawls.
- **Rate-limited or unauthorized catalog fetch**: Existing 401 / 429 error handling in the install script and helpers must keep working unchanged — the overhaul touches layout, not transport.
- **A manifest references a file that no longer exists on disk**: Uninstall reports it as "already removed", proceeds, and rewrites the manifest without that entry (existing behavior; just needs to handle the new array shape).
- **Project install with no `.gitignore`**: Success card still prints the `.gitignore` reminder and a sample snippet covering `.caipe/`, `.claude/`, `.agents/` — but the script does not modify `.gitignore` itself.
- **Helper allowed-tools mismatch**: If the user has Claude Code running in a mode that does not honor `allowed-tools` frontmatter (e.g. headless CI), the helpers still function — they will just prompt for permission. This is not a regression from today.
- **Agent picker selects an agent the user does not actually have installed**: Install still writes both universal paths; the user is unaffected. The launch guide in the UI may suggest a CLI command they cannot run, but the bytes on disk are the same as any other agent's install.

## Requirements

### Functional Requirements

- **FR-001**: The `/api/skills/install.sh?agent=<id>` endpoint MUST emit a script that writes every selected skill to **two** target paths per scope — `~/.claude/skills/<name>/SKILL.md` and `~/.agents/skills/<name>/SKILL.md` for `scope=user`, or `.claude/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md` for `scope=project`.
- **FR-002**: The agent registry (`AGENTS` in `ui/src/app/api/skills/live-skills/agents.ts`) MUST contain exactly five entries: `claude`, `cursor`, `codex`, `gemini`, `opencode`. Continue and Spec Kit MUST be removed.
- **FR-003**: Every entry in the registry MUST share the same `installPaths` (the two universal paths per scope, above). The agent's `id` MUST only affect the launch guide and the `argRef` substitution token (`$ARGUMENTS` for Claude/Cursor/opencode, `$1` for Codex/Gemini — see FR-009).
- **FR-004**: The `AgentSpec` interface MUST drop these fields: `defaultLayout`, `format`, `ext`, `isFragment`, `skillsPaths`. The `installPaths` field's value type MUST change from `Partial<Record<AgentScope, AgentLayout, string>>` (a single path per layout/scope) to `Partial<Record<AgentScope, readonly string[]>>` (an array of universal paths per scope).
- **FR-005**: `renderForAgent` MUST always emit a single `SKILL.md` body whose frontmatter has exactly `name:` and `description:` keys (plus `disable-model-invocation` and `allowed-tools` for the two CAIPE helpers — see FR-008). All per-format branches (markdown-plain, gemini-toml, continue-json-fragment) MUST be removed.
- **FR-006**: The `RenderResult` shape returned by `/api/skills/live-skills` and `/api/skills/update-skills` MUST drop these fields: `file_extension`, `format`, `is_fragment`, `layout`, `layout_requested`, `layout_fallback`, `layouts_available`. The `install_paths` field MUST be a `Partial<Record<AgentScope, readonly string[]>>`. The convenience `install_path` field MUST be the first entry in the resolved scope's array (for display purposes only).
- **FR-007**: The `/api/skills/install.sh` route MUST drop the `layout=` query parameter entirely. Any incoming `layout=...` MUST be silently ignored (not 400'd) so existing one-liners users have copy-pasted continue to work.
- **FR-008**: The two CAIPE helper templates (`charts/ai-platform-engineering/data/skills/live-skills.md`, `charts/ai-platform-engineering/data/skills/update-skills.md`) MUST be updated so their frontmatter contains:
  - `name: skills` / `name: update-skills`
  - `description: <existing>`
  - `disable-model-invocation: true` (so the model never auto-invokes them; only an explicit `/skills` or `/update-skills` from the user does)
  - `allowed-tools: [Bash(uv run ~/.config/caipe/caipe-skills.py*), Bash(python3 ~/.config/caipe/caipe-skills.py*)]` so neither invocation triggers a permission prompt.
- **FR-009**: The install script MUST substitute `$ARGUMENTS` → `$1` in every emitted `SKILL.md` body when `agent=codex` or `agent=gemini` (since their slash-command runtime uses positional `$1` rather than `$ARGUMENTS`). All other agents (`claude`, `cursor`, `opencode`) keep `$ARGUMENTS` as-is.
- **FR-010**: The portion of `install.sh` that mutates `~/.claude/settings.json` MUST stop adding the two `Bash(uv run ~/.config/caipe/caipe-skills.py*)` and `Bash(python3 ~/.config/caipe/caipe-skills.py*)` entries to `permissions.allow`. The SessionStart hook patch (which writes the `~/.config/caipe/caipe-catalog.sh` hook reference into `hooks.SessionStart`) MUST remain untouched.
- **FR-011**: The `--upgrade` legacy-cleanup pass in `install.sh` MUST be extended to remove leftover commands-layout artifacts for **all five** agents:
  - Claude: `~/.claude/commands/<name>.md`
  - Cursor: `~/.cursor/commands/<name>.md`
  - Codex: `~/.codex/prompts/<name>.md`
  - Gemini: `~/.gemini/commands/<name>.toml`
  - opencode: `~/.config/opencode/command/<name>.md`
  
  And the corresponding project-scope paths under `.claude/commands/`, `.cursor/commands/`, `.codex/prompts/`, `.gemini/commands/`, `.opencode/command/`. The cleanup MUST also remove the two specific allowlist entries from `~/.claude/settings.json` (per FR-010) if they were added by a prior install.
- **FR-012**: The manifest entry shape (`~/.config/caipe/installed.json` and `./.caipe/installed.json`) MUST change from `{ "name": "...", "path": "..." }` to `{ "name": "...", "paths": ["...", "..."] }`. `buildUninstallScript` MUST handle both shapes during reads (treating a legacy `path` field as a one-element `paths` array) and only emit the new shape on writes.
- **FR-013**: When invoked without an explicit `scope=` parameter, the uninstall mode (`mode=uninstall`) MUST walk **both** manifests in deterministic order — user manifest (`~/.config/caipe/installed.json`) first, then project manifest (`./.caipe/installed.json`) — each with its own independent y/N/a/q prompt loop. An "apply to all" answer in one manifest's loop MUST NOT carry across to the next.
- **FR-014**: After removing each skill's files, the script MUST `rmdir` the empty parent skill directory (`<root>/<name>/`) in each tree (i.e. both `~/.claude/skills/<name>/` and `~/.agents/skills/<name>/`). It MUST NOT touch the parent `skills/` root directory itself, nor anything outside the manifest's recorded paths.
- **FR-015**: The `TrySkillsGateway` UI panel MUST drop the "Skills layout" toggle entirely. The default (and only visible) install mode is "Bulk install (default)". Project-scope MUST be demoted to an "Advanced" disclosure (collapsed by default). The path preview block MUST display **all** target paths for the chosen scope (a vertical list of two paths), not just one. When project scope is selected, the preview MUST include a `.gitignore` reminder for `.caipe/`, `.claude/`, `.agents/`.
- **FR-016**: The per-skill ad-hoc importer MUST be reachable as `POST /api/skills/import` and MUST accept `{ source: "github" | "gitlab", repo: string, paths: string[], credentials_ref?: string }`. The legacy route `POST /api/skills/import-github` MUST keep working (proxy to `/api/skills/import` with `source: "github"` injected) so any out-of-tree caller does not break; mark the legacy route as deprecated in its source docstring. The legacy single-`path: string` body MUST also be accepted as a one-element `paths: [string]` array.
- **FR-017**: When `source: "gitlab"`, the importer MUST resolve the project via `${process.env.GITLAB_API_URL || "https://gitlab.com/api/v4"}/projects/<encoded-repo>/repository/tree?recursive=true&per_page=100`, filter the tree to entries whose `path` starts with one of the request's `paths[i]` (with each prefix normalized to end in `/`), exclude any path ending in `/SKILL.md` (mirroring the GitHub branch's behavior), and fetch each blob via `repository/files/<encoded-path>/raw?ref=HEAD`. Token resolution MUST go through `validateCredentialsRef` against env vars `GITLAB_TOKEN` (default) or whatever `credentials_ref` resolves to; the token is sent as `PRIVATE-TOKEN: <value>` per `crawlGitLabRepo` precedent.
- **FR-018**: When the importer's `paths[]` has length > 1, the response MUST merge files into one map with **first-wins** conflict resolution and MUST include a top-level `conflicts: Array<{ name, kept_from, dropped_from }>` field listing every dropped duplicate. An empty `conflicts: []` MUST be returned when there are none (so callers can distinguish "no conflicts" from "field missing").
- **FR-019**: `GithubImportPanel.tsx` MUST be renamed to `RepoImportPanel.tsx` (or replaced by an equivalent component) that exposes a **source toggle** (GitHub / GitLab) above the existing `repo` + `path` inputs. The UI MUST allow adding additional path prefixes (a small "+ Add another path" affordance, capped at 5 prefixes per import). Placeholder text and the credentials-hint label MUST switch with the source toggle (GitHub: `anthropics/skills`, `GITHUB_TOKEN`; GitLab: `mycorp/platform`, `GITLAB_TOKEN`). The component MUST POST to `/api/skills/import` with the new body shape.
- **FR-020**: The `SkillHubDoc` MongoDB schema (`skill_hubs` collection) MUST gain an optional `include_paths: string[]` field. `POST /api/skill-hubs` and `PATCH /api/skill-hubs/[id]` MUST accept it; values MUST be normalized server-side (trim, drop empties, dedupe, append a trailing `/` to each entry, cap at 20 entries) before persistence. Absent or empty `include_paths` MUST mean "crawl the whole repo" (today's behavior). The validator MUST reject any prefix containing `..`, leading `/`, or characters outside `[A-Za-z0-9._/\-]`.
- **FR-021**: `crawlGitHubRepo` and `crawlGitLabRepo` (in `ui/src/lib/hub-crawl.ts`) MUST accept an optional `includePaths?: readonly string[]` parameter. When non-empty, the SKILL.md candidate list (`skillMdPaths`) MUST be filtered to entries whose path starts with one of the prefixes (after the same trailing-slash normalization as FR-020). The ancillary-file collection step (`tryAcceptAncillary` loop) is unchanged — siblings of an accepted SKILL.md are still gathered relative to its own directory, regardless of `includePaths`. Both crawler functions MUST forward `includePaths` from `_crawlAndCache` so the value flows through `getHubSkills`.
- **FR-022**: The `POST /api/skill-hubs` URL normalizer MUST be widened to preserve **every** path segment after the host for `gitlab.com` and the configured `GITLAB_API_URL` host. The existing two-segment truncation MUST remain only for `github.com` (which is flat `owner/repo`). A normalized GitLab `location` MUST be the full nested path (e.g. `mycorp/devops/platform`) so subgroup hubs work end-to-end. The PATCH route's normalizer in `ui/src/app/api/skill-hubs/[id]/route.ts` MUST be updated in lockstep.

### Key Entities

- **AgentSpec**: A registry entry describing one supported coding agent. After overhaul: `id`, `label`, `installPaths: Partial<Record<AgentScope, readonly string[]>>`, `argRef: '$ARGUMENTS' | '$1'`, `launchGuide: string`, optional `docsUrl: string`. Five entries total.
- **RenderResult**: The JSON returned by `/api/skills/live-skills` and `/api/skills/update-skills`. After overhaul: `name`, `description`, `body`, `install_paths` (the `Record` above), `install_path` (first entry in resolved scope, for display), `agent_id`, `scope`. All format/layout fields removed.
- **Manifest entry**: One record in `~/.config/caipe/installed.json` (or `./.caipe/installed.json`). After overhaul: `{ "name": string, "paths": string[] }`. Legacy `{ "path": string }` reads handled transparently.
- **SkillHubDoc** (extended): The `skill_hubs` MongoDB document. New optional field `include_paths: string[]` (normalized to trailing-slash prefixes; empty/absent = crawl whole repo). All other fields unchanged.
- **ImportRequest** (new): Body shape for `POST /api/skills/import`: `{ source: "github" | "gitlab", repo: string, paths: string[], credentials_ref?: string }`. Legacy `POST /api/skills/import-github` proxies to this with `source: "github"` injected and accepts the legacy single-`path` shape.
- **ImportResponse** (new): `{ files: Record<string, string>, count: number, conflicts: Array<{ name: string, kept_from: string, dropped_from: string }> }`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A user who installs once at `scope=user` can launch any of the five supported agents and have CAIPE skills appear in their slash-command autocomplete with zero further configuration. Verified by inspecting that `~/.claude/skills/`, `~/.cursor/skills/`, `~/.agents/skills/` (read by Codex, Gemini, opencode), and the universal `~/.agents/skills/` mirror all contain the catalog after one run.
- **SC-002**: The `agents.ts` source file shrinks from 583 lines to under 350 lines, and the agent registry is reduced from 7 entries to 5. The `RenderResult` shape exposed by `/api/skills/live-skills` has 7 fields removed (`file_extension`, `format`, `is_fragment`, `layout`, `layout_requested`, `layout_fallback`, `layouts_available`).
- **SC-003**: Re-running `install.sh` with a different `agent=` value writes zero new bytes (every emitted file is byte-identical to the prior run for the same skill set and scope). Verified by SHA-256 checksums in a CI smoke test.
- **SC-004**: The `--upgrade` legacy cleanup pass removes commands-layout artifacts for **all five** agents (10 paths per scope, 20 total per skill across both scopes). Verified by an integration test that seeds each legacy path, runs `--upgrade`, and asserts every legacy path is gone.
- **SC-005**: After install, the user's `~/.claude/settings.json` does NOT contain `Bash(uv run ~/.config/caipe/caipe-skills.py*)` or `Bash(python3 ~/.config/caipe/caipe-skills.py*)` under `permissions.allow`. The SessionStart hook entry under `hooks` IS still present.
- **SC-006**: Running `/skills` or `/update-skills` inside Claude Code does NOT trigger a permission prompt for the Python catalog invocation, because the helpers' `allowed-tools` frontmatter pre-approves both `uv run` and `python3` forms.
- **SC-007**: Uninstall without `scope=` walks both manifests; the per-manifest y/N/a/q prompt loops are independent (proven by an integration test that answers `a` in the first loop and verifies the second loop still prompts per item).
- **SC-008**: The `TrySkillsGateway` UI ships zero "layout" controls, its path preview shows two paths for default (user) scope, and project scope is hidden behind an Advanced disclosure that includes the `.gitignore` reminder.
- **SC-009**: The full UI Jest suite (`make caipe-ui-tests`) passes after rewriting the four affected test files (`agents.test.ts`, `route.test.ts`, `route.uninstall.test.ts`, `route.uninstall.smoke.test.ts`, plus `TrySkillsGateway.uninstall.test.tsx`).
- **SC-010**: A platform admin can register a GitLab subgroup hub (e.g. `mycorp/devops/platform`) via either the JSON API or the admin UI and the location is persisted with every path segment intact (no two-segment truncation). Verified by a route-level test against `POST /api/skill-hubs` and `PATCH /api/skill-hubs/[id]` with subgroup URLs.
- **SC-011**: A hub configured with `include_paths: ["skills/", "agents/foo/skills/"]` against a 1000-file monorepo crawls in the same wall-clock time as before but caches **only** the SKILL.md files (and their ancillaries) under the configured prefixes. Verified by an integration test that seeds a fixture tree with SKILL.md files inside and outside the prefixes and asserts `hub_skills` contents after `_crawlAndCache`.
- **SC-012**: The workspace import panel can pull files from both GitHub and GitLab using the same UI surface, supports up to 5 path prefixes per import, and surfaces filename conflicts non-destructively. Verified by a component test that toggles source, adds a second path, and asserts the request body shape and the `conflicts: []` round-trip.

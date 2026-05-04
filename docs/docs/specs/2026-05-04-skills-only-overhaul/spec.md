# Feature Specification: Skills-Only Installer Overhaul

**Feature Branch**: `fix/skills-ai-generate-use-dynamic-agents` (continuing on existing branch)
**Created**: 2026-05-04
**Status**: Draft
**Input**: Refactor the CAIPE skill installer (`/api/skills/install.sh`) to use a single `SKILL.md` layout for every supported coding agent, drop the legacy `commands/` layout toggle and per-agent file-format machinery, install each skill to two universal locations per scope so one install satisfies all five supported agents, and migrate the two CAIPE helper slash commands to the new layout.

## Background

The CAIPE Skills API Gateway today exposes `/api/skills/install.sh` — a one-line `curl | bash` installer that drops every catalog skill onto a user's machine in a per-agent file format and directory layout. It supports two layouts (`commands` and `skills`) and four file formats (`markdown-frontmatter`, `markdown-plain`, `gemini-toml`, `continue-json-fragment`), driven by the agent registry in `ui/src/app/api/skills/live-skills/agents.ts`.

Since shipping that installer, the four major coding agents that we target (Claude Code, Cursor, Codex CLI, Gemini CLI) plus a fifth (opencode) have **all** standardized on the open `agentskills.io` `SKILL.md` format under a `skills/<name>/SKILL.md` tree (see <https://docs.claude.com/en/docs/claude-code/skills>, <https://cursor.com/docs/skills>, <https://developers.openai.com/codex/skills>, <https://geminicli.com/docs/cli/skills/>, <https://opencode.ai/docs/skills/>). All five also auto-discover from a vendor-neutral `~/.agents/skills/` mirror. Continue and Spec Kit, the two outliers we previously had to special-case, are no longer worth carrying.

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

### Edge Cases

- **Mid-flight migration**: A user has a previous CAIPE install that used the `commands/` layout. They re-run install (without `--upgrade`). Behavior: the new install lays down the `SKILL.md` files alongside the legacy `.md` commands. The `--upgrade` path is the only way to clean the legacy artifacts. Document this clearly in the success-card output.
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

### Key Entities

- **AgentSpec**: A registry entry describing one supported coding agent. After overhaul: `id`, `label`, `installPaths: Partial<Record<AgentScope, readonly string[]>>`, `argRef: '$ARGUMENTS' | '$1'`, `launchGuide: string`, optional `docsUrl: string`. Five entries total.
- **RenderResult**: The JSON returned by `/api/skills/live-skills` and `/api/skills/update-skills`. After overhaul: `name`, `description`, `body`, `install_paths` (the `Record` above), `install_path` (first entry in resolved scope, for display), `agent_id`, `scope`. All format/layout fields removed.
- **Manifest entry**: One record in `~/.config/caipe/installed.json` (or `./.caipe/installed.json`). After overhaul: `{ "name": string, "paths": string[] }`. Legacy `{ "path": string }` reads handled transparently.

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

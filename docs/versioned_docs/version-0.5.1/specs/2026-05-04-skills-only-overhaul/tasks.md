# Tasks: Skills-Only Installer Overhaul

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files, no inter-task dependencies)
- **[Story]**: User story (US1 = "one install, every agent" P1; US2 = "helpers ship as real Skills" P1; US3 = "sane uninstall across both scopes" P2)

---

## Phase 1: Foundational — Registry & Rendering Core (US1, US2)

**Purpose**: Refactor the data model and rendering pipeline so every downstream consumer can be flipped to the new shape in lockstep. Phase 1 leaves the build temporarily broken (tests reference old types) — Phases 2–4 finish before anything ships.

- [x] **T001** [US1] Rewrite `ui/src/app/api/skills/live-skills/agents.ts`:
  - Drop `defaultLayout`, `format`, `ext`, `isFragment`, `skillsPaths`, `AgentLayout`, `AgentFormat`, `layoutsAvailableFor`, `pathsForLayout`
  - Define `UNIVERSAL_USER_PATHS = ["~/.claude/skills/{name}/SKILL.md", "~/.agents/skills/{name}/SKILL.md"]` and `UNIVERSAL_PROJECT_PATHS = [".claude/skills/{name}/SKILL.md", ".agents/skills/{name}/SKILL.md"]`
  - Reduce `AgentSpec` to `{ id, label, installPaths: Partial<Record<AgentScope, readonly string[]>>, argRef: '$ARGUMENTS' | '$1', launchGuide: string, docsUrl?: string }`
  - Reduce `AGENTS` to 5 entries: `claude`, `cursor`, `codex`, `gemini`, `opencode`. Remove `continue`, `specify`. Codex and Gemini keep `argRef: '$1'`; the other three use `'$ARGUMENTS'`
  - Rewrite `renderForAgent` to always emit a `SKILL.md` body with `name:` + `description:` frontmatter (and `disable-model-invocation` + `allowed-tools` when the source template already declares them)
  - Update the exported `RenderResult` type to drop `file_extension`, `format`, `is_fragment`, `layout`, `layout_requested`, `layout_fallback`, `layouts_available`. `install_paths` is now `Partial<Record<AgentScope, readonly string[]>>`. `install_path` is the first entry of the resolved scope's array (display only).
  - Per FR-001 / FR-002 / FR-003 / FR-004 / FR-005 / FR-006

- [x] **T002** [US1] Rewrite `ui/src/app/api/skills/_lib/template-route.ts`:
  - Drop the `layout` field from `RenderInputs`
  - Stop importing `AgentLayout` / `layoutsAvailableFor`
  - Remove `layout`, `layout_requested`, `layout_fallback`, `layouts_available`, `file_extension`, `format`, `is_fragment` from the response JSON
  - Map `agent.installPaths` directly to `install_paths` in the response
  - Per FR-006

- [x] **T003** [US1] Rewrite `ui/src/app/api/skills/install.sh/route.ts` — Part A (registry/render plumbing):
  - Drop the `layout` query parameter handling (silently ignore if present, per FR-007)
  - Drop the per-agent format `switch` (markdown-frontmatter / markdown-plain / gemini-toml / continue-json-fragment) — every agent now goes through the single `SKILL.md` renderer
  - Replace single-target install path resolution with multi-target: enumerate `agent.installPaths[scope]` and emit one `mkdir -p` + `cat > … << 'EOF'` block per path
  - Per FR-001 / FR-007 / FR-009 ($ARGUMENTS → $1 substitution for codex/gemini)

- [x] **T004** [US1] `install.sh/route.ts` — Part B (`~/.claude/settings.json` patch trim):
  - Remove the two emitted `Bash(uv run ~/.config/caipe/caipe-skills.py*)` and `Bash(python3 ~/.config/caipe/caipe-skills.py*)` entries from `permissions.allow`
  - Keep the SessionStart hook entry under `hooks.SessionStart` untouched
  - Per FR-010

- [x] **T005** [US3] `install.sh/route.ts` — Part C (manifest entries widen to `paths: []`):
  - Change the JSON written to `~/.config/caipe/installed.json` and `./.caipe/installed.json` from `{ "name": "...", "path": "..." }` to `{ "name": "...", "paths": ["...", "..."] }`
  - Manifest read path: treat a legacy `path` field as a one-element `paths` array
  - Per FR-012

- [x] **T006** [US3] `install.sh/route.ts` — Part D (`buildUninstallScript` walks both manifests):
  - When invoked without `scope=`, walk `~/.config/caipe/installed.json` first (independent y/N/a/q loop), then `./.caipe/installed.json` (independent y/N/a/q loop)
  - For each entry, iterate `paths[]` removing each file, then `rmdir` the empty parent skill directory in each tree
  - Handle legacy `path` shape transparently
  - Per FR-013 / FR-014

- [x] **T007** [US2] `install.sh/route.ts` — Part E (extend `--upgrade` legacy cleanup):
  - For each of the 5 agents, remove the legacy commands-layout artifacts at both user and project scope:
    - Claude: `~/.claude/commands/<name>.md` + `.claude/commands/<name>.md`
    - Cursor: `~/.cursor/commands/<name>.md` + `.cursor/commands/<name>.md`
    - Codex: `~/.codex/prompts/<name>.md` + `.codex/prompts/<name>.md`
    - Gemini: `~/.gemini/commands/<name>.toml` + `.gemini/commands/<name>.toml`
    - opencode: `~/.config/opencode/command/<name>.md` + `.opencode/command/<name>.md`
  - Also strip the two `Bash(...caipe-skills.py*)` allowlist entries from `~/.claude/settings.json` if a prior install added them
  - Per FR-011

**Checkpoint**: After Phase 1 the API routes are coherent under the new shape. Tests are still on old shape and will fail until Phase 4. Helpers and UI are still on old shape and will be flipped in Phases 2 and 3.

---

## Phase 2: Helper Templates (US2)

**Purpose**: Update the two CAIPE-authored helper templates so the new install layout treats them as proper Skills with auto-approved tool access.

- [x] **T008** [P] [US2] Update `charts/ai-platform-engineering/data/skills/live-skills.md`:
  - Add `disable-model-invocation: true` to frontmatter
  - Add `allowed-tools:` array with both `Bash(uv run ~/.config/caipe/caipe-skills.py*)` and `Bash(python3 ~/.config/caipe/caipe-skills.py*)`
  - Per FR-008

- [x] **T009** [P] [US2] Update `charts/ai-platform-engineering/data/skills/update-skills.md`:
  - Same frontmatter additions as T008
  - Per FR-008

**Checkpoint**: After Phase 2 the helper templates are valid `SKILL.md` files that will install with the right pre-approval bytes.

---

## Phase 3: UI Simplification (US1, US3)

**Purpose**: Remove the layout toggle and demote project-scope to "Advanced" so the default user flow is one install, one click.

- [x] **T010** [US1] Update `ui/src/components/skills/TrySkillsGateway.tsx`:
  - Remove the entire "Skills layout" toggle (radio group, helper text, label)
  - Move project-scope selection inside an `<details>` (or equivalent collapse component) labeled "Advanced: project scope"
  - When project scope is selected, render a `.gitignore` reminder block listing `.caipe/`, `.claude/`, `.agents/`
  - Update the path preview block to render **all** paths in `install_paths[scope]` as a vertical list (currently shows one)
  - Refresh the curl one-liner preview to drop `&layout=…` (it never appears in the new flow)
  - Per FR-015

**Checkpoint**: After Phase 3 the UI matches the new default-user-scope, multi-target reality.

---

## Phase 4: Test Rewrites (US1, US2, US3)

**Purpose**: Bring the four affected Jest test files into alignment with the new shape so `make caipe-ui-tests` passes.

- [x] **T011** [P] [US1] Rewrite `ui/src/app/api/skills/live-skills/__tests__/agents.test.ts`:
  - Remove all `defaultLayout`, `format`, `ext`, `isFragment`, `layoutsAvailableFor`, `pathsForLayout` assertions
  - Assert the registry has exactly the 5 expected entries
  - Assert each agent's `installPaths.user` and `installPaths.project` contain the two universal paths
  - Assert `renderForAgent` always returns a `SKILL.md` body with `name:` + `description:` frontmatter
  - Assert codex/gemini get `$1` substitution; others keep `$ARGUMENTS`

- [x] **T012** [P] [US1] Rewrite `ui/src/app/api/skills/install.sh/__tests__/route.test.ts`:
  - Drop `?layout=…` from every test URL
  - Add assertions that the emitted bash writes to **both** target paths per skill (grep for both path patterns in the script body)
  - Add an assertion that an incoming `?layout=commands` is silently accepted (no 400) and the emitted script still writes the new layout

- [x] **T013** [P] [US3] Rewrite `ui/src/app/api/skills/install.sh/__tests__/route.uninstall.test.ts`:
  - Update fixture manifests to use the new `paths: []` shape
  - Add a test for legacy `path:` shape (assert it is read transparently and rewritten as `paths:`)
  - Add a test for the no-`scope=` invocation that asserts the emitted script walks both manifests in order and prompts independently

- [x] **T014** [P] [US3] Rewrite `ui/src/app/api/skills/install.sh/__tests__/route.uninstall.smoke.test.ts`:
  - Update bash-syntax smoke test to match the new uninstall script structure (multi-manifest walk, paths[] iteration, parent-dir rmdir)

- [x] **T015** [P] [US1] Update `ui/src/components/skills/__tests__/TrySkillsGateway.uninstall.test.tsx`:
  - Drop assertions that reference the layout toggle DOM
  - Add assertions that project-scope selector is hidden until the Advanced disclosure is opened
  - Add assertion that the path preview lists 2 paths for user scope

**Checkpoint**: After Phase 4, `make caipe-ui-tests` passes end-to-end.

---

## Phase 5: Verification & Commit

- [x] **T016** Run the full UI test suite from the repo root:
  ```bash
  make caipe-ui-tests
  ```
  Investigate and fix any regressions. The expectation is zero failures; if a non-target test breaks, that is a real regression to fix before commit.

- [ ] **T017** Manual smoke against a locally running UI (**owner: human reviewer** — automated suite + bug-fix commit `996fb2a6` cover the regression that prompted this; this task is the optional final hand-validation before merge):
  ```bash
  curl -fsSL 'http://localhost:3000/api/skills/install.sh?scope=user' | bash
  ls ~/.claude/skills/  ~/.agents/skills/  # both populated
  curl -fsSL 'http://localhost:3000/api/skills/install.sh?scope=user' | bash
  # ↑ second run should be a no-op (zero new bytes); manifest unchanged
  curl -fsSL 'http://localhost:3000/api/skills/install.sh?mode=uninstall' | bash
  # ↑ no scope= → walks both manifests, prompts y/N/a/q per skill
  ```

- [x] **T018** Conventional Commits + DCO. One commit per coherent slice on `fix/skills-ai-generate-use-dynamic-agents`:
  - `refactor(skills): collapse agent registry to skills-only universal layout` (T001 + T002)
  - `refactor(skills): rewrite install.sh for multi-target writes and dual-manifest uninstall` (T003–T007)
  - `feat(skills): helper templates ship as real SKILL.md with allowed-tools` (T008–T009)
  - `refactor(ui/skills): drop layout toggle, demote project scope to Advanced` (T010)
  - `test(skills): rewrite installer + UI tests for skills-only layout` (T011–T015)
  
  Use `git commit -s` for every commit (DCO).

---

## Phase 6: Multi-source crawl + path filtering (US4) — added 2026-05-04

**Purpose**: Bring GitLab to feature parity with GitHub on the per-skill ad-hoc importer, add a path-prefix filter to both the hub crawler and the per-skill importer so admins can target specific subdirectories of large monorepos, and fix the GitLab subgroup URL truncation bug. All work continues on `fix/skills-ai-generate-use-dynamic-agents`.

### Phase 6a: Schema + crawler core (US4)

- [x] **T019** [US4] Extend `SkillHubDoc` (in `ui/src/lib/hub-crawl.ts`) with optional `include_paths?: readonly string[]`. Update `crawlGitHubRepo(owner, repo, token, includePaths?)` and `crawlGitLabRepo(projectPath, token, includePaths?)` to accept the new arg. When `includePaths` is non-empty, filter `skillMdPaths` to entries whose path starts with one of the prefixes (after enforcing a trailing `/` on each prefix). Leave `belongsToNestedSkill` and the ancillary-collection loop untouched. Per FR-021.

- [x] **T020** [US4] Update `_crawlAndCache` (same file) to read `hub.include_paths` and forward it to whichever crawler matches `hub.type`. Per FR-021.

### Phase 6b: Hub admin API (US4)

- [x] **T021** [US4] Update `POST /api/skill-hubs` (`ui/src/app/api/skill-hubs/route.ts`):
  - Accept optional `include_paths: string[]` in the request body
  - Validate: each entry MUST match `/^[A-Za-z0-9._\-/]+$/` (no `..`, no leading `/`); trim; drop empties; dedupe; append a trailing `/` if absent; cap at 20 entries
  - Persist the normalized array into the new doc; absent or empty stays absent (so existing docs are untouched)
  - Widen the URL normalizer: when the URL host is `gitlab.com` (or matches the configured `GITLAB_API_URL` host), keep **every** path segment after the host (preserves subgroups). The existing two-segment truncation MUST stay for `github.com` only.
  - Per FR-020, FR-022.

- [x] **T022** [US4] Update `PATCH /api/skill-hubs/[id]` (`ui/src/app/api/skill-hubs/[id]/route.ts`):
  - Accept the same `include_paths` field with the same validation/normalization helper extracted from T021 (share the function — do not duplicate)
  - Apply the same widened GitLab subgroup normalizer
  - Per FR-020, FR-022.

### Phase 6c: Per-skill importer (US4)

- [x] **T023** [US4] Create `ui/src/app/api/skills/import/route.ts` (the new source-agnostic endpoint):
  - `POST` body: `{ source: "github" | "gitlab", repo: string, paths: string[], credentials_ref?: string }`
  - Accept legacy single `path: string` shape transparently (treat as `paths: [path]`)
  - GitHub branch reuses today's `import-github` flow (Git Trees API + contents API) but iterates over every entry in `paths[]`
  - GitLab branch hits `${GITLAB_API_URL || "https://gitlab.com/api/v4"}/projects/<encoded-repo>/repository/tree?recursive=true&per_page=100`, then fetches each blob via `repository/files/<encoded>/raw?ref=HEAD`. Use `PRIVATE-TOKEN` header (matching `crawlGitLabRepo`); resolve token via `validateCredentialsRef` with `GITLAB_TOKEN` fallback.
  - Multi-path merge: first-wins; populate `conflicts: [{ name, kept_from, dropped_from }]` for every dropped duplicate; always return the field (empty array when none).
  - Response: `{ files, count, conflicts }`. Wrapped via `successResponse` like the legacy route.
  - Per FR-016, FR-017, FR-018.

- [x] **T024** [US4] Update `ui/src/app/api/skills/import-github/route.ts` to be a thin proxy to `/api/skills/import` with `source: "github"` injected. Mark the file's docstring as "deprecated — prefer POST /api/skills/import". Keep the legacy behavior of returning just `{ files, count }` (no `conflicts` field) so any existing caller is byte-compatible. Per FR-016.

### Phase 6d: UI surfaces (US4)

- [x] **T025** [US4] Create `ui/src/components/skills/workspace/RepoImportPanel.tsx` based on the existing `GithubImportPanel.tsx` with these additions:
  - **Source toggle** above the inputs (radio or segmented control: GitHub / GitLab) — default GitHub for back-compat
  - **Multi-path** support: render the `path` input as a stack of inputs with a `+ Add another path` button (capped at 5 prefixes)
  - Placeholder + credentials hint switch with the source toggle (GitHub: `anthropics/skills`, `GITHUB_TOKEN`; GitLab: `mycorp/platform`, `GITLAB_TOKEN`)
  - POST to `/api/skills/import` with the new body shape; surface `conflicts.length` as a non-blocking toast (e.g. "Imported N files; skipped M duplicates")
  - Per FR-019.

- [x] **T026** [US4] Replace `ui/src/components/skills/workspace/GithubImportPanel.tsx` with a one-line re-export of `RepoImportPanel` so existing imports (`import { GithubImportPanel } from ...`) keep working without churn. Per FR-019.

- [x] **T027** [US4] Update `ui/src/components/admin/SkillHubsSection.tsx` to add an "Include paths (optional)" input to the hub registration / edit form:
  - Multi-line textarea (one prefix per line) is the simplest UI; show a hint: "Leave empty to crawl the entire repo. Trailing slashes are added automatically."
  - On submit, split on newlines, send as `include_paths: string[]`
  - On display (existing hubs), render any persisted `include_paths` as a wrapped chip list under the location
  - Per FR-020.

### Phase 6e: Tests (US4)

- [x] **T028** [P] [US4] New + updated test files (run in parallel — independent files):
  - **NEW** `ui/src/lib/__tests__/hub-crawl-include-paths.test.ts`: assert both crawlers filter the SKILL.md candidate list to the configured prefixes; assert `belongsToNestedSkill` invariant still holds; assert empty/absent `includePaths` is identical to today's behavior.
  - **NEW** `ui/src/app/api/skills/import/__tests__/route.test.ts`: cover GitHub branch (matches legacy behavior), GitLab branch (PRIVATE-TOKEN header, encoded subgroup paths), multi-path merge with conflicts, and the legacy single-`path` body shape.
  - **UPDATE** `ui/src/app/api/skill-hubs/__tests__/url-validation.test.ts`: add a subgroup-URL case (`https://gitlab.com/mycorp/devops/platform` → `mycorp/devops/platform`); add an `include_paths` validation case (rejects `..`, leading `/`, non-allowed chars; normalizes trailing slashes; caps at 20).
  - **UPDATE** `ui/src/components/skills/workspace/__tests__/import-panels.test.tsx`: assert the source toggle switches placeholders + body `source`; assert "+ Add another path" appends a prefix (capped at 5); assert a `conflicts` payload surfaces a toast.
  - Per FR-016 through FR-022.

### Phase 6f: Verification & commit

- [x] **T029** Run the full UI suite again: `cd ui && npx jest --no-coverage`. Result: **148 suites pass / 2899 tests pass / 1 skipped** (added 2 new suites — `hub-crawl-include-paths` + `import/__tests__/route` — and extended `url-validation` + `import-panels`; baseline was 146).

- [x] **T030** Conventional Commits + DCO. Commit slicing on `fix/skills-ai-generate-use-dynamic-agents`:
  - `feat(skills): add include_paths filter to hub crawler` (T019, T020)
  - `feat(skill-hubs): accept include_paths and fix GitLab subgroup truncation` (T021, T022)
  - `feat(skills): source-agnostic ad-hoc importer with GitLab + multi-path` (T023, T024)
  - `feat(ui/skills): RepoImportPanel + admin hub include_paths input` (T025, T026, T027)
  - `test(skills): cover include_paths + multi-source importer` (T028)

  Use `git commit -s` for every commit (DCO).

---

## Parallelization notes

- **Phase 1 must run sequentially within itself** (T001 → T002 → T003 → T004 → T005 → T006 → T007), because each task touches downstream consumers of the previous one's types.
- **Phase 2 (T008, T009) is parallel** — two independent template files.
- **Phase 3 (T010) is sequential after Phase 1** — the UI's path preview reads from `RenderResult.install_paths`.
- **Phase 4 (T011–T015) is parallel** — five independent test files.
- **Phase 5 is sequential and final.**
- **Phase 6**:
  - 6a (T019, T020) is sequential within itself.
  - 6b (T021, T022) is sequential after T019 (the validator helper is shared) and runs as a pair (POST + PATCH must agree).
  - 6c (T023, T024) is sequential after 6a (the importer reuses no shared types from the hub crawler today, but T024 depends on T023 existing).
  - 6d (T025–T027) can run in parallel with each other once 6c is in (T025 + T026 are coupled by the re-export, so do them together; T027 is independent).
  - 6e (T028) is parallel within itself (four independent test files).

## Estimated effort

- Phase 1: ~3–4 hours (the bulk of the rewrite, dominated by `install.sh/route.ts`)
- Phase 2: ~15 minutes
- Phase 3: ~45 minutes
- Phase 4: ~1.5–2 hours
- Phase 5: ~30 minutes (mostly waiting for `make caipe-ui-tests`)
- Phase 6a–6b: ~1 hour (crawler arg + admin API + normalizer fix)
- Phase 6c: ~1.5 hours (new importer route + GitLab branch + multi-path merge)
- Phase 6d: ~1.5 hours (RepoImportPanel + SkillHubsSection edit)
- Phase 6e–6f: ~1.5 hours (tests + commit slicing)

**Total: ~12–14 hours of focused work** (Phases 1-5: ~6-7h, Phase 6: ~5-6h additional).

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

- [ ] **T003** [US1] Rewrite `ui/src/app/api/skills/install.sh/route.ts` — Part A (registry/render plumbing):
  - Drop the `layout` query parameter handling (silently ignore if present, per FR-007)
  - Drop the per-agent format `switch` (markdown-frontmatter / markdown-plain / gemini-toml / continue-json-fragment) — every agent now goes through the single `SKILL.md` renderer
  - Replace single-target install path resolution with multi-target: enumerate `agent.installPaths[scope]` and emit one `mkdir -p` + `cat > … << 'EOF'` block per path
  - Per FR-001 / FR-007 / FR-009 ($ARGUMENTS → $1 substitution for codex/gemini)

- [ ] **T004** [US1] `install.sh/route.ts` — Part B (`~/.claude/settings.json` patch trim):
  - Remove the two emitted `Bash(uv run ~/.config/caipe/caipe-skills.py*)` and `Bash(python3 ~/.config/caipe/caipe-skills.py*)` entries from `permissions.allow`
  - Keep the SessionStart hook entry under `hooks.SessionStart` untouched
  - Per FR-010

- [ ] **T005** [US3] `install.sh/route.ts` — Part C (manifest entries widen to `paths: []`):
  - Change the JSON written to `~/.config/caipe/installed.json` and `./.caipe/installed.json` from `{ "name": "...", "path": "..." }` to `{ "name": "...", "paths": ["...", "..."] }`
  - Manifest read path: treat a legacy `path` field as a one-element `paths` array
  - Per FR-012

- [ ] **T006** [US3] `install.sh/route.ts` — Part D (`buildUninstallScript` walks both manifests):
  - When invoked without `scope=`, walk `~/.config/caipe/installed.json` first (independent y/N/a/q loop), then `./.caipe/installed.json` (independent y/N/a/q loop)
  - For each entry, iterate `paths[]` removing each file, then `rmdir` the empty parent skill directory in each tree
  - Handle legacy `path` shape transparently
  - Per FR-013 / FR-014

- [ ] **T007** [US2] `install.sh/route.ts` — Part E (extend `--upgrade` legacy cleanup):
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

- [ ] **T008** [P] [US2] Update `charts/ai-platform-engineering/data/skills/live-skills.md`:
  - Add `disable-model-invocation: true` to frontmatter
  - Add `allowed-tools:` array with both `Bash(uv run ~/.config/caipe/caipe-skills.py*)` and `Bash(python3 ~/.config/caipe/caipe-skills.py*)`
  - Per FR-008

- [ ] **T009** [P] [US2] Update `charts/ai-platform-engineering/data/skills/update-skills.md`:
  - Same frontmatter additions as T008
  - Per FR-008

**Checkpoint**: After Phase 2 the helper templates are valid `SKILL.md` files that will install with the right pre-approval bytes.

---

## Phase 3: UI Simplification (US1, US3)

**Purpose**: Remove the layout toggle and demote project-scope to "Advanced" so the default user flow is one install, one click.

- [ ] **T010** [US1] Update `ui/src/components/skills/TrySkillsGateway.tsx`:
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

- [ ] **T011** [P] [US1] Rewrite `ui/src/app/api/skills/live-skills/__tests__/agents.test.ts`:
  - Remove all `defaultLayout`, `format`, `ext`, `isFragment`, `layoutsAvailableFor`, `pathsForLayout` assertions
  - Assert the registry has exactly the 5 expected entries
  - Assert each agent's `installPaths.user` and `installPaths.project` contain the two universal paths
  - Assert `renderForAgent` always returns a `SKILL.md` body with `name:` + `description:` frontmatter
  - Assert codex/gemini get `$1` substitution; others keep `$ARGUMENTS`

- [ ] **T012** [P] [US1] Rewrite `ui/src/app/api/skills/install.sh/__tests__/route.test.ts`:
  - Drop `?layout=…` from every test URL
  - Add assertions that the emitted bash writes to **both** target paths per skill (grep for both path patterns in the script body)
  - Add an assertion that an incoming `?layout=commands` is silently accepted (no 400) and the emitted script still writes the new layout

- [ ] **T013** [P] [US3] Rewrite `ui/src/app/api/skills/install.sh/__tests__/route.uninstall.test.ts`:
  - Update fixture manifests to use the new `paths: []` shape
  - Add a test for legacy `path:` shape (assert it is read transparently and rewritten as `paths:`)
  - Add a test for the no-`scope=` invocation that asserts the emitted script walks both manifests in order and prompts independently

- [ ] **T014** [P] [US3] Rewrite `ui/src/app/api/skills/install.sh/__tests__/route.uninstall.smoke.test.ts`:
  - Update bash-syntax smoke test to match the new uninstall script structure (multi-manifest walk, paths[] iteration, parent-dir rmdir)

- [ ] **T015** [P] [US1] Update `ui/src/components/skills/__tests__/TrySkillsGateway.uninstall.test.tsx`:
  - Drop assertions that reference the layout toggle DOM
  - Add assertions that project-scope selector is hidden until the Advanced disclosure is opened
  - Add assertion that the path preview lists 2 paths for user scope

**Checkpoint**: After Phase 4, `make caipe-ui-tests` passes end-to-end.

---

## Phase 5: Verification & Commit

- [ ] **T016** Run the full UI test suite from the repo root:
  ```bash
  make caipe-ui-tests
  ```
  Investigate and fix any regressions. The expectation is zero failures; if a non-target test breaks, that is a real regression to fix before commit.

- [ ] **T017** Manual smoke against a locally running UI:
  ```bash
  curl -fsSL 'http://localhost:3000/api/skills/install.sh?agent=claude&scope=user' | bash
  ls ~/.claude/skills/  ~/.agents/skills/  # both populated
  curl -fsSL 'http://localhost:3000/api/skills/install.sh?agent=cursor&scope=user' | bash
  # ↑ should be a no-op (zero new bytes); manifest unchanged
  curl -fsSL 'http://localhost:3000/api/skills/install.sh?mode=uninstall' | bash
  # ↑ no scope= → walks both manifests
  ```

- [ ] **T018** Conventional Commits + DCO. One commit per coherent slice on `fix/skills-ai-generate-use-dynamic-agents`:
  - `refactor(skills): collapse agent registry to skills-only universal layout` (T001 + T002)
  - `refactor(skills): rewrite install.sh for multi-target writes and dual-manifest uninstall` (T003–T007)
  - `feat(skills): helper templates ship as real SKILL.md with allowed-tools` (T008–T009)
  - `refactor(ui/skills): drop layout toggle, demote project scope to Advanced` (T010)
  - `test(skills): rewrite installer + UI tests for skills-only layout` (T011–T015)
  
  Use `git commit -s` for every commit (DCO).

---

## Parallelization notes

- **Phase 1 must run sequentially within itself** (T001 → T002 → T003 → T004 → T005 → T006 → T007), because each task touches downstream consumers of the previous one's types.
- **Phase 2 (T008, T009) is parallel** — two independent template files.
- **Phase 3 (T010) is sequential after Phase 1** — the UI's path preview reads from `RenderResult.install_paths`.
- **Phase 4 (T011–T015) is parallel** — five independent test files.
- **Phase 5 is sequential and final.**

## Estimated effort

- Phase 1: ~3–4 hours (the bulk of the rewrite, dominated by `install.sh/route.ts`)
- Phase 2: ~15 minutes
- Phase 3: ~45 minutes
- Phase 4: ~1.5–2 hours
- Phase 5: ~30 minutes (mostly waiting for `make caipe-ui-tests`)

**Total: ~6–7 hours of focused work.**

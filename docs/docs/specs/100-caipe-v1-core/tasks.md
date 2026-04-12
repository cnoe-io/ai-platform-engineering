---
description: "Task list for CAIPE CLI v1 Core implementation"
---

# Tasks: CAIPE CLI — v1 Core

**Input**: `docs/docs/specs/100-caipe-v1-core/`  
**Branch**: `100-caipe-v1-core`  
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/cli-schema.md ✓, quickstart.md ✓

**Organization**: Tasks are grouped by user story. Each phase produces an independently testable increment.

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: User story this task belongs to (US1–US5)
- Tasks without [Story] belong to Setup, Foundational, or Polish phases

---

## Phase 1: Setup

**Purpose**: Scaffold the `cli/` package — build tooling, entry point, and distribution structure.

- [ ] T001 Create `cli/` package scaffold with `package.json` (name: caipe, bin: ./dist/shim.js), `tsconfig.json` (strict, ESNext, bundler resolution), and `bunfig.toml` (build + compile config) — `cli/package.json`, `cli/tsconfig.json`, `cli/bunfig.toml`
- [ ] T002 Initialize Commander.js root program in `cli/src/index.ts` with `--version` (reads package.json), `--help`, `--no-color`, `--json`, `--agent <name>` global options; register placeholder subcommand stubs — `cli/src/index.ts`
- [ ] T003 [P] Configure Biome for linting and formatting with TypeScript + React/JSX support — `cli/biome.json`
- [ ] T004 [P] Set up Bun test runner structure with test entry and import aliases matching `tsconfig.json` — `cli/tests/` directory, `cli/package.json` test script
- [ ] T005 [P] Create npm distribution scaffold: platform `optionalDependencies` packages (darwin-arm64, darwin-x64, linux-arm64, linux-x64) and `dist/shim.js` that resolves and execs the correct platform binary — `cli/dist/shim.js`, `cli/npm/caipe-darwin-arm64/package.json`, `cli/npm/caipe-darwin-x64/package.json`, `cli/npm/caipe-linux-arm64/package.json`, `cli/npm/caipe-linux-x64/package.json`

**Checkpoint**: `bun run cli/src/index.ts --version` prints version; `bun run cli/src/index.ts --help` lists stubs.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Platform infrastructure and authentication — these block every user story.

**⚠️ CRITICAL**: No user story implementation can begin until this phase is complete.

- [ ] T006 Implement XDG config path helpers in `cli/src/platform/config.ts`: `globalConfigDir()` → `~/.config/caipe/`, `globalSkillsDir()`, `sessionsDir()`, `projectClaudeDir(cwd)` (walks up to `.git`, returns `.claude/` if found), `projectSkillsDir(cwd)` — `cli/src/platform/config.ts`
- [ ] T007 [P] Implement git subprocess wrappers in `cli/src/platform/git.ts` via execa: `findRepoRoot(cwd)` (walks up to `.git`), `sampleFileTree(root, maxFiles=150)` (respects `.gitignore`), `recentLog(root, n=20)` (one-line format), `stagedFiles(root)` — `cli/src/platform/git.ts`
- [ ] T008 [P] Implement markdown → ANSI renderer in `cli/src/platform/markdown.ts`: wrap `marked-terminal` with GFM enabled; export `renderMarkdown(text: string): string`; suppress color when `NO_COLOR` or `--no-color` set — `cli/src/platform/markdown.ts`
- [ ] T009 [P] Implement unified diff helper in `cli/src/platform/diff.ts`: `renderDiff(oldText: string, newText: string, label: string): string`; added lines green, removed lines red, context lines grey; uses `diff` npm package — `cli/src/platform/diff.ts`
- [ ] T010 Implement OS keychain adapter in `cli/src/auth/keychain.ts`: `storeTokens(tokens: TokenSet)`, `loadTokens(): TokenSet | null`, `clearTokens()`; uses `keytar` with service name `caipe`; never writes plaintext fallback in v1 — `cli/src/auth/keychain.ts`
- [ ] T011 Implement OAuth 2.0 PKCE flow in `cli/src/auth/oauth.ts`: `generatePKCE()` (verifier + S256 challenge), `startCallbackServer(port: number)` (local HTTP redirect capture), `openBrowser(url: string)`, `exchangeCode(code, verifier, redirectUri)` → `TokenSet`; `--manual` path prints URL and prompts for code — `cli/src/auth/oauth.ts`
- [ ] T012 Implement token lifecycle in `cli/src/auth/tokens.ts`: `getValidToken()` (check expiry → silent refresh → throw if refresh fails), `refreshAccessToken(refreshToken)`, `isExpired(token: TokenSet): boolean`; token shape matches `data-model.md` User entity — `cli/src/auth/tokens.ts`
- [ ] T013 Wire `caipe auth login [--manual]`, `caipe auth logout`, `caipe auth status [--json]` commands in `cli/src/index.ts`; `login` calls oauth.ts + keychain.ts; `logout` prompts confirm then clears keychain; `status` reads tokens + prints identity/expiry; exit codes per cli-schema.md — `cli/src/index.ts`
- [ ] T014 [P] Write unit tests covering PKCE math (verifier→challenge roundtrip), token expiry detection, silent refresh logic, keychain mock (stub keytar) — `cli/tests/auth.test.ts`

**Checkpoint**: `caipe auth login` opens browser → stores token → `caipe auth status` shows identity. `caipe auth logout` clears credential. All T014 tests pass.

---

## Phase 3: User Story 1 — Authenticated Interactive Chat (Priority: P1) 🎯 MVP

**Goal**: `caipe chat` opens a streaming session with repo context; responses stream token-by-token with markdown rendered.

**Independent Test**: Navigate to a git repo, run `caipe chat`, send a message, receive a streamed markdown response — no other feature needed.

- [ ] T015 [US1] Implement memory loader in `cli/src/memory/loader.ts`: `loadMemoryFiles(cwd: string): MemoryFile[]` scans global `CLAUDE.md`, project `.claude/CLAUDE.md`, and `.claude/memory/*.md` (alphabetical); enforces 50k token budget cap with truncation warning to stderr; returns concatenated context string — `cli/src/memory/loader.ts`
- [ ] T016 [US1] Implement session context assembler in `cli/src/chat/context.ts`: `buildSystemContext(cwd: string): Promise<string>` calls `sampleFileTree()` + `recentLog()` from git.ts and `loadMemoryFiles()` from memory/loader.ts; caps total context at 100k tokens; returns formatted system context string — `cli/src/chat/context.ts`
- [ ] T017 [US1] Implement AG-UI SSE stream client in `cli/src/chat/stream.ts`: `streamChat(payload: ChatPayload, onToken: TokenCallback, onEvent: EventCallback)` using `@ag-ui/client`; connects to `POST /api/agui/stream` with Bearer token; handles `TEXT_MESSAGE_CONTENT` (invoke onToken), `RUN_STARTED`, `TEXT_MESSAGE_END`, `TOOL_CALL_START/END`, `STATE_SNAPSHOT/DELTA`, `RUN_ERROR` (surface error + retry), `RUN_FINISHED`; reconnects on drop — `cli/src/chat/stream.ts`
- [ ] T018 [US1] Implement Ink REPL component in `cli/src/chat/Repl.tsx`: input bar (readline-style), scrollable message list (streamed tokens appended), agent + token-budget status header, slash command dispatch (`/clear`, `/compact`, `/exit`); `Ctrl+C` triggers graceful exit — `cli/src/chat/Repl.tsx`
- [ ] T019 [US1] Implement session history serializer in `cli/src/chat/history.ts`: `saveSession(session: ChatSession)` → `~/.config/caipe/sessions/<id>.json`; `loadSession(id: string): ChatSession | null`; `listSessions(): SessionSummary[]`; rolling 100k token window: drops oldest messages when exceeded — `cli/src/chat/history.ts`
- [ ] T020 [US1] Wire `caipe chat [--agent <name>] [--no-context] [--resume <id>]` in `cli/src/index.ts`: call `buildSystemContext()` unless `--no-context`; call `getValidToken()` (prompt re-auth if expired without losing context); instantiate `Repl`; on exit serialize via `history.ts`; exit codes per cli-schema.md — `cli/src/index.ts`
- [ ] T021 [P] [US1] Write unit tests covering git tree sampling (mock execa), memory file loading (fixture CLAUDE.md files), token budget truncation (assert warning emitted at 50k), context string assembly — `cli/tests/context.test.ts`

**Checkpoint**: `caipe chat` streams a response in a git repo. Session header shows agent name. Token budget displayed. History saved on `/exit`. All T021 tests pass.

---

## Phase 4: User Story 2 — Skills Hub: Browse, Preview, Install (Priority: P2)

**Goal**: `caipe skills list/preview/install` let users discover and install skills from the catalog.

**Independent Test**: Run `caipe skills list`, select a skill, run `caipe skills preview <name>`, run `caipe skills install <name>` — skill file appears in `.claude/` with correct frontmatter.

- [ ] T022 [US2] Implement catalog manifest fetcher in `cli/src/skills/catalog.ts`: `fetchCatalog(): Promise<Catalog>` — fetch from `https://github.com/cnoe-io/ai-platform-engineering/releases/latest/download/catalog.json`; cache to `~/.config/caipe/catalog-cache.json` with 1-hour TTL; return stale cache on network error (log warning); verify SHA-256 checksum of each entry before returning — `cli/src/skills/catalog.ts`
- [ ] T023 [P] [US2] Implement installed skills scanner in `cli/src/skills/scan.ts`: `scanInstalledSkills(cwd: string): InstalledSkill[]` — walks `.claude/*.md`, `skills/*.md`, `~/.config/caipe/skills/*.md`; parses YAML frontmatter (name, version, description) per file; returns list with scope (`project` | `global`) and file path — `cli/src/skills/scan.ts`
- [ ] T024 [US2] Implement skill installer in `cli/src/skills/install.ts`: `installSkill(name: string, opts: InstallOpts)` — fetch content from `CatalogEntry.url`; verify SHA-256; resolve target (`.claude/` if exists, else `skills/`, else `--global`); warn + prompt if already installed (skip with `--force`); write file; print confirmation with path; exit codes per cli-schema.md — `cli/src/install.ts` → `cli/src/skills/install.ts`
- [ ] T025 [US2] Implement Ink paginated catalog browser in `cli/src/skills/Browser.tsx`: arrow-key navigation, search bar (filter by name/description), tag filter (`--tag`), preview pane on Enter (renders SKILL.md via markdown.ts), `i` to install from within browser, spinner while fetching — `cli/src/skills/Browser.tsx`
- [ ] T026 [US2] Wire `caipe skills list [--tag] [--installed] [--json]`, `caipe skills preview <name>`, `caipe skills install <name> [--global] [--target] [--force]` commands in `cli/src/index.ts`; add `/skills` slash command handler to `cli/src/chat/Repl.tsx` (opens Browser in-session) — `cli/src/index.ts`, `cli/src/chat/Repl.tsx`
- [ ] T027 [P] [US2] Write unit tests covering catalog fetch mock (nock/MSW), checksum verify (fixture with known SHA), 1-hour cache TTL (mock Date), stale cache on network error, graceful degradation when source unreachable — `cli/tests/catalog.test.ts`
- [ ] T028 [P] [US2] Write unit tests covering install target resolution (no .claude/ → skills/), frontmatter parsing (valid + malformed), overwrite guard (already installed without --force → exit 3), checksum mismatch → exit 2 — `cli/tests/skills.test.ts`

**Checkpoint**: `caipe skills list` renders interactive catalog. `caipe skills install dco-ai-attribution` writes `.claude/dco-ai-attribution.md`. Repeat install without `--force` shows warning. All T027/T028 tests pass.

---

## Phase 5: User Story 3 — Self-Improving Skills (Priority: P3)

**Goal**: `caipe skills update` detects outdated installed skills, shows diffs, and applies with confirmation.

**Independent Test**: Install a skill at version 1.0.0; publish version 1.1.0 to catalog; run `caipe skills update`; confirm; verify `.bak` created and skill updated.

- [ ] T029 [US3] Implement skill update orchestrator in `cli/src/skills/update.ts`: `checkUpdates(cwd: string): UpdateReport` — scan installed skills via scan.ts; compare versions against catalog (semver `>` check); for each outdated skill: fetch new content, render diff via diff.ts, prompt confirm; on confirm: backup `<name>.md.bak`, write new version; on decline: skip; `--dry-run`: report only, no writes; catalog unreachable → clear error, no files modified — `cli/src/skills/update.ts`
- [ ] T030 [US3] Wire `caipe skills update [<name>] [--all] [--dry-run]` command in `cli/src/index.ts` — `cli/src/index.ts`
- [ ] T031 [P] [US3] Extend `cli/tests/skills.test.ts` with update tests: semver comparison (1.0.0 < 1.1.0), backup-and-replace (assert `.bak` created), catalog-unreachable guard (no files modified), dry-run (report without write), user declines (file unchanged) — `cli/tests/skills.test.ts`

**Checkpoint**: `caipe skills update --dry-run` reports available updates. `caipe skills update` shows diff, asks confirm, writes `.bak`, updates file. All T031 tests pass.

---

## Phase 6: User Story 4 — Grid Agent Routing (Priority: P4)

**Goal**: `caipe agents list` shows available grid agents; `caipe chat --agent <name>` pins session to a specific domain agent.

**Independent Test**: Run `caipe agents list` (shows table with ArgoCD, default, etc.), then `caipe chat --agent argocd` — session header shows "argocd", response reflects domain specialisation.

- [ ] T032 [US4] Implement agent registry client in `cli/src/agents/registry.ts`: `fetchAgents(): Promise<Agent[]>` — `GET /api/v1/agents` with Bearer token; cache to `~/.config/caipe/agents-cache.json` with 5-minute TTL; `getAgent(name: string): Agent | null`; `checkAvailability(agent: Agent): boolean`; A2A agent card discovery via `GET /.well-known/agent.json` for endpoint resolution — `cli/src/agents/registry.ts`
- [ ] T033 [P] [US4] Implement Ink agent list component in `cli/src/agents/List.tsx`: table layout with columns name, domain, status dot (green=available, red=unavailable); handles empty state — `cli/src/agents/List.tsx`
- [ ] T034 [US4] Pass `--agent <name>` flag from `caipe chat` through to `stream.ts` endpoint selection; validate agent exists + available before opening session; on unavailable: print error with list of available agents as recovery hint — `cli/src/chat/stream.ts`, `cli/src/index.ts`
- [ ] T035 [US4] Update `cli/src/chat/Repl.tsx` session status header to display active agent `displayName` and availability dot; show "default" when no agent specified — `cli/src/chat/Repl.tsx`
- [ ] T036 [US4] Wire `caipe agents list [--json]`, `caipe agents info <name>` commands in `cli/src/index.ts`; add `/agents` slash command handler in `cli/src/chat/Repl.tsx` (renders agent list in-session, selecting one starts a new session) — `cli/src/index.ts`, `cli/src/chat/Repl.tsx`

**Checkpoint**: `caipe agents list` renders table. `caipe chat --agent argocd` shows agent name in header. Unavailable agent shows error + available list.

---

## Phase 7: User Story 5 — DCO Commit Assistance (Priority: P5)

**Goal**: `caipe commit` assembles a DCO-compliant commit with `Assisted-by` auto-appended and prompts for `Signed-off-by`.

**Independent Test**: Stage changes, run `caipe commit`, provide message — commit carries `Assisted-by: Claude:<model>`, user is prompted for `Signed-off-by`. Proceed without it shows warning. Commit is created.

- [ ] T037 [US5] Implement DCO trailer injection in `cli/src/commit/dco.ts`: `buildCommitMessage(draft: string, modelVersion: string): string` — appends `Assisted-by: Claude:<model-version>` trailer; `promptSignedOffBy(gitUser: GitUser): Promise<string | null>` — pre-fills suggestion from `git config user.name/email`; never generates the line on user's behalf; `applyCommit(message: string)` — calls `git commit` via execa; `installHook(repoRoot: string)` — writes `prepare-commit-msg` hook for `--install-hook` path — `cli/src/commit/dco.ts`
- [ ] T038 [US5] Wire `caipe commit [--install-hook]` command in `cli/src/index.ts`: detect staged changes via git.ts; abort with message if none staged; assemble commit message; prompt for `Signed-off-by`; if declined, show visible warning and confirm before proceeding; call `applyCommit`; exit codes per cli-schema.md — `cli/src/index.ts`
- [ ] T039 [P] [US5] Write unit tests covering `Assisted-by` trailer injection (assert exact format `Assisted-by: Claude:<model>`), sign-off skip path (warning emitted, commit proceeds), hook file generation (assert file written with correct shebang), staged files detection (mock git.ts) — `cli/tests/commit.test.ts`

**Checkpoint**: Stage a file, run `caipe commit`, enter message, decline `Signed-off-by` → warning shown → commit created with `Assisted-by` trailer. All T039 tests pass.

---

## Phase 8: Memory Command (US1 Supporting Capability)

**Goal**: `caipe memory` opens CLAUDE.md in `$EDITOR`; `/memory` slash command allows editing without leaving chat.

**Independent Test**: Run `caipe memory` — creates `.claude/CLAUDE.md` if absent, opens in `$EDITOR`, prints which editor. Run `caipe memory --global` — opens `~/.config/caipe/CLAUDE.md`.

- [ ] T040 Implement memory file editor launcher in `cli/src/memory/editor.ts`: `openMemoryFile(scope: 'project' | 'global', cwd: string)` — resolve path via config.ts; create file with starter comment if absent; spawn `$EDITOR` (fallback `$VISUAL`, then `vi`); print which editor is being used and how to change it; wait for editor exit — `cli/src/memory/editor.ts`
- [ ] T041 Wire `caipe memory [--global]` command in `cli/src/index.ts` — `cli/src/index.ts`
- [ ] T042 Add `/memory` slash command handler in `cli/src/chat/Repl.tsx`: suspend Ink rendering, call `openMemoryFile()`, on editor exit re-run `loadMemoryFiles()` (hot-reload), resume session with updated context — `cli/src/chat/Repl.tsx`

**Checkpoint**: `caipe memory` opens editor. `/memory` in chat session edits file and reloads context without ending the session.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Cross-feature completeness, contract validation, release pipeline.

- [ ] T043 [P] Implement `--json` structured output for `caipe auth status`, `caipe skills list`, `caipe agents list` per cli-schema.md JSON shapes; non-interactive detection (`!process.stdout.isTTY`) switches to JSON mode automatically — `cli/src/index.ts`
- [ ] T044 [P] Implement `--no-color` global flag: set `NO_COLOR=1` env var early in index.ts; propagate to markdown.ts and diff.ts renderers; suppress all ANSI escape codes — `cli/src/index.ts`, `cli/src/platform/markdown.ts`, `cli/src/platform/diff.ts`
- [ ] T045 [P] Write CLI contract tests validating flag parsing, `--json` output shape, and exit codes match `contracts/cli-schema.md` for all five command groups — `cli/tests/cli.contract.test.ts`
- [ ] T046 [P] Configure GitHub Actions release workflow: `bun build --compile --target=bun-<platform>` for all four targets; publish platform packages to npm; trigger on semver tags — `.github/workflows/caipe-release.yml`
- [ ] T047 [P] Run quickstart.md validation end-to-end against a compiled binary (mock grid endpoint): install → auth → chat → skills list → skills install → skills update --dry-run — `cli/tests/quickstart.integration.test.ts`
- [ ] T048 [P] Verify all Bun test suites pass (`bun test cli/tests/`) and binary cold-start under 1s (`time ./caipe --version`) — CI pre-merge gate in `.github/workflows/caipe-ci.yml`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    └── Phase 2 (Foundational — auth + platform)
            ├── Phase 3 (US1 Chat REPL) ← MVP
            │       └── Phase 4 (US2 Skills Hub)
            │               └── Phase 5 (US3 Self-Improving)
            ├── Phase 6 (US4 Grid Agents) — depends on Phase 3 chat
            ├── Phase 7 (US5 DCO Commits) — depends on Phase 2 git.ts only
            └── Phase 8 (Memory Command) — depends on Phase 3 memory/loader.ts
                    └── Phase 9 (Polish)
```

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — blocks US2, US4, Memory Command
- **US2 (P2)**: Requires US1 auth flow; catalog install uses `getValidToken()`
- **US3 (P3)**: Requires US2 — `update.ts` depends on `scan.ts` and `install.ts`
- **US4 (P4)**: Requires US1 — `--agent` flag threads into chat stream
- **US5 (P5)**: Requires Phase 2 `git.ts` only — can be developed independently of US1–US4
- **Memory Command**: Requires US1 `memory/loader.ts`

### Within Each Phase

- Platform infra tasks (T007–T009) are independent and run in parallel
- Auth tasks run sequentially: keychain → oauth → tokens → wire commands
- In each user story: scanner/fetcher → installer/orchestrator → Ink component → wire command

---

## Parallel Execution Examples

### Phase 2 Foundational

```
Parallel batch A (independent platform helpers):
  T007 cli/src/platform/git.ts
  T008 cli/src/platform/markdown.ts
  T009 cli/src/platform/diff.ts

Sequential after A:
  T010 cli/src/auth/keychain.ts
  T011 cli/src/auth/oauth.ts (uses keychain)
  T012 cli/src/auth/tokens.ts (uses oauth + keychain)
  T013 Wire auth commands
  T014 auth.test.ts [P with T010–T012]
```

### Phase 4 US2 Skills Hub

```
Parallel batch:
  T022 cli/src/skills/catalog.ts
  T023 cli/src/skills/scan.ts

Sequential after parallel:
  T024 cli/src/skills/install.ts (needs catalog + scan)
  T025 cli/src/skills/Browser.tsx (needs catalog)
  T026 Wire commands + /skills slash

Tests in parallel with implementation:
  T027 cli/tests/catalog.test.ts [P with T022]
  T028 cli/tests/skills.test.ts [P with T023–T024]
```

---

## Implementation Strategy

### MVP (Phase 1 + Phase 2 + Phase 3 only)

1. Complete Phase 1: Setup scaffold
2. Complete Phase 2: Auth + platform infra
3. Complete Phase 3: Chat REPL (US1)
4. **STOP and VALIDATE**: `caipe auth login` → `caipe chat` → streamed markdown response
5. Ship as alpha — standalone chat value with no skills or agents required

### Incremental Delivery

| Step | Delivers |
|------|----------|
| Phase 1 + 2 + 3 | `npx caipe` → authenticated streaming chat (MVP) |
| + Phase 4 | Skills catalog — browse, preview, install |
| + Phase 5 | Self-updating skills |
| + Phase 6 | Domain agent routing (ArgoCD, security, etc.) |
| + Phase 7 | DCO-compliant commit assistance |
| + Phase 8 | Memory management UX |
| + Phase 9 | Production release pipeline + contract coverage |

---

## Notes

- `[P]` tasks modify different files — safe to assign to different developers or run in parallel agents
- Each phase ends with a named checkpoint — stop and validate before proceeding
- Tests in `cli/tests/` use Bun's built-in test runner (Jest-compatible API)
- Ink components (`Repl.tsx`, `Browser.tsx`, `List.tsx`) are co-located with their feature logic — no global `components/` directory
- `platform/` is shared infrastructure only — add new helpers there only when three or more features need them (Rule of Three)
- Implementation branches: use `prebuild/feat/caipe-cli-<scope>` naming to trigger CI

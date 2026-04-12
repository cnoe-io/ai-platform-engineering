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
- [ ] T002 Initialize Commander.js root program in `cli/src/index.ts` with `--version` (reads package.json), `--help`, `--no-color`, `--json`, `--agent <name>`, and `--url <url>` (per-invocation server URL override) global options; register placeholder subcommand stubs — `cli/src/index.ts`
- [ ] T003 [P] Configure Biome for linting and formatting with TypeScript + React/JSX support — `cli/biome.json`
- [ ] T004 [P] Set up Bun test runner structure with test entry and import aliases matching `tsconfig.json` — `cli/tests/` directory, `cli/package.json` test script
- [ ] T005 [P] Create npm distribution scaffold: platform `optionalDependencies` packages (darwin-arm64, darwin-x64, linux-arm64, linux-x64) and `dist/shim.js` that resolves and execs the correct platform binary — `cli/dist/shim.js`, `cli/npm/caipe-darwin-arm64/package.json`, `cli/npm/caipe-darwin-x64/package.json`, `cli/npm/caipe-linux-arm64/package.json`, `cli/npm/caipe-linux-x64/package.json`

**Checkpoint**: `bun run cli/src/index.ts --version` prints version; `bun run cli/src/index.ts --help` lists stubs.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Platform infrastructure, server URL config, first-run wizard, and authentication — these block every user story.

**⚠️ CRITICAL**: No user story implementation can begin until this phase is complete.

- [ ] T006 Implement XDG config path helpers and settings management in `cli/src/platform/config.ts`: `globalConfigDir()` → `~/.config/caipe/`, `globalSkillsDir()`, `sessionsDir()`, `projectClaudeDir(cwd)` (walks up to `.git`), `projectSkillsDir(cwd)`; `readSettings(): Settings` and `writeSettings(s: Settings)` for `~/.config/caipe/settings.json`; `getServerUrl(flagOverride?: string): string` resolves in priority order: `--url` flag → `CAIPE_SERVER_URL` env → `settings.server.url` → throws `ServerNotConfigured` — `cli/src/platform/config.ts`
- [ ] T007 Implement first-run setup wizard in `cli/src/platform/setup.ts`: `runSetupWizard(): Promise<string>` — Ink prompt asking for CAIPE server URL (validates HTTPS), saves to `settings.json`, returns the URL; called automatically by `getServerUrl()` when `ServerNotConfigured` is thrown in interactive mode (headless mode exits with error instead) — `cli/src/platform/setup.ts`
- [ ] T008 [P] Implement git subprocess wrappers in `cli/src/platform/git.ts` via execa: `findRepoRoot(cwd)` (walks up to `.git`), `sampleFileTree(root, maxFiles=150)` (respects `.gitignore`), `recentLog(root, n=20)` (one-line format), `stagedFiles(root)` — `cli/src/platform/git.ts`
- [ ] T009 [P] Implement markdown → ANSI renderer in `cli/src/platform/markdown.ts`: wrap `marked-terminal` with GFM enabled; export `renderMarkdown(text: string): string`; suppress color when `NO_COLOR` or `--no-color` set — `cli/src/platform/markdown.ts`
- [ ] T010 [P] Implement unified diff helper in `cli/src/platform/diff.ts`: `renderDiff(oldText: string, newText: string, label: string): string`; added lines green, removed lines red, context lines grey; uses `diff` npm package — `cli/src/platform/diff.ts`
- [ ] T011 Implement OS keychain adapter in `cli/src/auth/keychain.ts`: `storeTokens(tokens: TokenSet)`, `loadTokens(): TokenSet | null`, `clearTokens()`; uses `keytar` with service name `caipe`; never writes plaintext fallback in v1 — `cli/src/auth/keychain.ts`
- [ ] T012 Implement OAuth 2.0 PKCE flow in `cli/src/auth/oauth.ts`: `generatePKCE()` (verifier + S256 challenge), `startCallbackServer(port: number)` (local HTTP redirect capture), `openBrowser(url: string)`, `exchangeCode(code, verifier, redirectUri)` → `TokenSet`; derives auth endpoint as `<serverUrl>/oauth`; `--manual` path prints URL and prompts for code — `cli/src/auth/oauth.ts`
- [ ] T013 Implement token lifecycle in `cli/src/auth/tokens.ts`: `getValidToken()` (check expiry → silent refresh → throw if refresh fails), `refreshAccessToken(refreshToken)`, `isExpired(token: TokenSet): boolean`; token shape matches `data-model.md` User entity — `cli/src/auth/tokens.ts`
- [ ] T014 Wire `caipe auth login [--manual]`, `caipe auth logout`, `caipe auth status [--json]`, and `caipe config set/get/unset` commands in `cli/src/index.ts`; `login` triggers setup wizard if no `server.url` then calls oauth.ts + keychain.ts; `logout` prompts confirm then clears keychain; `status` reads tokens + prints identity/expiry; `config set server.url` validates HTTPS before writing to `settings.json`; exit codes per `contracts/cli-schema.md` — `cli/src/index.ts`
- [ ] T015 [P] Write unit tests covering PKCE math (verifier→challenge roundtrip), token expiry detection, silent refresh logic, keychain mock (stub keytar), `getServerUrl()` priority order (flag > env > settings > wizard), `ServerNotConfigured` thrown when no URL and headless — `cli/tests/auth.test.ts`, `cli/tests/config.test.ts`

**Checkpoint**: `caipe config set server.url https://caipe.example.com` saves to `settings.json`. `caipe auth login` opens browser → stores token → `caipe auth status` shows identity. `caipe auth logout` clears credential. First run with no URL triggers wizard. All T015 tests pass.

---

## Phase 3: User Story 1 — Authenticated Interactive Chat (Priority: P1) 🎯 MVP

**Goal**: `caipe chat` opens a streaming session with repo context; responses stream token-by-token with markdown rendered; both A2A and AG-UI protocols supported via `--protocol` flag.

**Independent Test**: Navigate to a git repo, run `caipe chat`, send a message, receive a streamed markdown response — no other feature needed.

- [ ] T016 [US1] Implement dual-protocol stream adapter in `cli/src/chat/stream.ts`: define `StreamEvent` union type (`token | started | done | error | tool | state`); define `StreamAdapter` interface (`connect(payload): AsyncIterable<StreamEvent>`); implement `A2aAdapter` (native `fetch` + `EventSource` to `POST <serverUrl>/tasks/send`, maps A2A task lifecycle events to `StreamEvent`); implement `AguiAdapter` (`@ag-ui/client` to `POST <serverUrl>/api/agui/stream`, maps AG-UI events to `StreamEvent`); export `createAdapter(protocol: "a2a" | "agui", agent: Agent, serverUrl: string): StreamAdapter` factory — `cli/src/chat/stream.ts`
- [ ] T017 [US1] Implement memory loader in `cli/src/memory/loader.ts`: `loadMemoryFiles(cwd: string): MemoryFile[]` scans global `CLAUDE.md`, project `.claude/CLAUDE.md`, and `.claude/memory/*.md` (alphabetical); enforces 50k token budget cap with truncation warning to stderr; returns concatenated context string — `cli/src/memory/loader.ts`
- [ ] T018 [US1] Implement session context assembler in `cli/src/chat/context.ts`: `buildSystemContext(cwd: string): Promise<string>` calls `sampleFileTree()` + `recentLog()` from git.ts and `loadMemoryFiles()` from memory/loader.ts; caps total context at 100k tokens; returns formatted system context string — `cli/src/chat/context.ts`
- [ ] T019 [US1] Implement Ink REPL component in `cli/src/chat/Repl.tsx`: input bar (readline-style), scrollable message list (streamed tokens appended via `StreamAdapter`), agent + protocol + token-budget status header, slash command dispatch (`/clear`, `/compact`, `/exit`); `Ctrl+C` triggers graceful exit; component is fully protocol-agnostic (depends only on `StreamAdapter` interface) — `cli/src/chat/Repl.tsx`
- [ ] T020 [US1] Implement session history serializer in `cli/src/chat/history.ts`: `saveSession(session: ChatSession)` → `~/.config/caipe/sessions/<id>.json` (includes `protocol` and `headless` fields); `loadSession(id: string): ChatSession | null`; `listSessions(): SessionSummary[]`; rolling 100k token window: drops oldest messages when exceeded — `cli/src/chat/history.ts`
- [ ] T021 [US1] Wire `caipe chat [--agent <name>] [--protocol a2a|agui] [--no-context] [--resume <id>]` in `cli/src/index.ts`: derive `serverUrl` via `getServerUrl()`; call `buildSystemContext()` unless `--no-context`; call `getValidToken()` (prompt re-auth if expired without losing context); instantiate `createAdapter(protocol, agent, serverUrl)`; mount `Repl` with adapter; on exit serialize via `history.ts`; exit codes per `contracts/cli-schema.md` — `cli/src/index.ts`
- [ ] T022 [P] [US1] Write unit tests covering git tree sampling (mock execa), memory file loading (fixture CLAUDE.md files), token budget truncation (assert warning emitted at 50k), context string assembly, `A2aAdapter` mock SSE event mapping, `AguiAdapter` mock event mapping, `createAdapter` factory returns correct type — `cli/tests/context.test.ts`, `cli/tests/stream.test.ts`

**Checkpoint**: `caipe chat` streams a response in a git repo. Session header shows agent name and active protocol. `caipe chat --protocol agui` switches to AG-UI. Token budget displayed. History saved on `/exit`. All T022 tests pass.

---

## Phase 4: User Story 2 — Skills Hub: Browse, Preview, Install (Priority: P2)

**Goal**: `caipe skills list/preview/install` let users discover and install skills from the catalog.

**Independent Test**: Run `caipe skills list`, select a skill, run `caipe skills preview <name>`, run `caipe skills install <name>` — skill file appears in `.claude/` with correct frontmatter.

- [ ] T023 [US2] Implement catalog manifest fetcher in `cli/src/skills/catalog.ts`: `fetchCatalog(): Promise<Catalog>` — fetch from `https://github.com/cnoe-io/ai-platform-engineering/releases/latest/download/catalog.json`; cache to `~/.config/caipe/catalog-cache.json` with 1-hour TTL; return stale cache on network error (log warning); verify SHA-256 checksum of each entry before returning — `cli/src/skills/catalog.ts`
- [ ] T024 [P] [US2] Implement installed skills scanner in `cli/src/skills/scan.ts`: `scanInstalledSkills(cwd: string): InstalledSkill[]` — walks `.claude/*.md`, `skills/*.md`, `~/.config/caipe/skills/*.md`; parses YAML frontmatter (name, version, description) per file; returns list with scope (`project` | `global`) and file path — `cli/src/skills/scan.ts`
- [ ] T025 [US2] Implement skill installer in `cli/src/skills/install.ts`: `installSkill(name: string, opts: InstallOpts)` — fetch content from `CatalogEntry.url`; verify SHA-256; resolve target (`.claude/` if exists, else `skills/`, else `--global`); warn + prompt if already installed (skip with `--force`); write file; print confirmation with path; exit codes per `contracts/cli-schema.md` — `cli/src/skills/install.ts`
- [ ] T026 [US2] Implement Ink paginated catalog browser in `cli/src/skills/Browser.tsx`: arrow-key navigation, search bar (filter by name/description), tag filter (`--tag`), preview pane on Enter (renders SKILL.md via markdown.ts), `i` to install from within browser, spinner while fetching — `cli/src/skills/Browser.tsx`
- [ ] T027 [US2] Wire `caipe skills list [--tag] [--installed] [--json]`, `caipe skills preview <name>`, `caipe skills install <name> [--global] [--target] [--force]` commands in `cli/src/index.ts`; add `/skills` slash command handler to `cli/src/chat/Repl.tsx` (opens Browser in-session) — `cli/src/index.ts`, `cli/src/chat/Repl.tsx`
- [ ] T028 [P] [US2] Write unit tests covering catalog fetch mock (nock/MSW), checksum verify (fixture with known SHA), 1-hour cache TTL (mock Date), stale cache on network error, graceful degradation when source unreachable — `cli/tests/catalog.test.ts`
- [ ] T029 [P] [US2] Write unit tests covering install target resolution (no .claude/ → skills/), frontmatter parsing (valid + malformed), overwrite guard (already installed without --force → exit 3), checksum mismatch → exit 2 — `cli/tests/skills.test.ts`

**Checkpoint**: `caipe skills list` renders interactive catalog. `caipe skills install dco-ai-attribution` writes `.claude/dco-ai-attribution.md`. Repeat install without `--force` shows warning. All T028/T029 tests pass.

---

## Phase 5: User Story 3 — Self-Improving Skills (Priority: P3)

**Goal**: `caipe skills update` detects outdated installed skills, shows diffs, and applies with confirmation.

**Independent Test**: Install a skill at version 1.0.0; publish version 1.1.0 to catalog; run `caipe skills update`; confirm; verify `.bak` created and skill updated.

- [ ] T030 [US3] Implement skill update orchestrator in `cli/src/skills/update.ts`: `checkUpdates(cwd: string): UpdateReport` — scan installed skills via scan.ts; compare versions against catalog (semver `>` check); for each outdated skill: fetch new content, render diff via diff.ts, prompt confirm; on confirm: backup `<name>.md.bak`, write new version; on decline: skip; `--dry-run`: report only, no writes; catalog unreachable → clear error, no files modified — `cli/src/skills/update.ts`
- [ ] T031 [US3] Wire `caipe skills update [<name>] [--all] [--dry-run]` command in `cli/src/index.ts` — `cli/src/index.ts`
- [ ] T032 [P] [US3] Extend `cli/tests/skills.test.ts` with update tests: semver comparison (1.0.0 < 1.1.0), backup-and-replace (assert `.bak` created), catalog-unreachable guard (no files modified), dry-run (report without write), user declines (file unchanged) — `cli/tests/skills.test.ts`

**Checkpoint**: `caipe skills update --dry-run` reports available updates. `caipe skills update` shows diff, asks confirm, writes `.bak`, updates file. All T032 tests pass.

---

## Phase 6: User Story 4 — CAIPE Server Agent Routing (Priority: P4)

**Goal**: `caipe agents list` shows available CAIPE server agents; `caipe chat --agent <name>` pins session to a specific domain agent; `--protocol` is validated against the agent's supported protocols before connecting.

**Independent Test**: Run `caipe agents list` (shows table with ArgoCD, default, etc.), then `caipe chat --agent argocd` — session header shows "argocd", response reflects domain specialisation. `caipe chat --agent argocd --protocol agui` with an A2A-only agent prompts to switch.

- [ ] T033 [US4] Implement agent registry client in `cli/src/agents/registry.ts`: `fetchAgents(): Promise<Agent[]>` — `GET <serverUrl>/api/v1/agents` with Bearer token; cache to `~/.config/caipe/agents-cache.json` with 5-minute TTL; `getAgent(name: string): Agent | null`; `checkAvailability(agent: Agent): boolean`; `validateProtocol(agent: Agent, requested: string): ValidationResult` — checks agent's `protocols: string[]` field; if unsupported returns `{ valid: false, supported: string[] }`; if agent has no `protocols` field, assumes A2A and proceeds without warning — `cli/src/agents/registry.ts`
- [ ] T034 [P] [US4] Implement Ink agent list component in `cli/src/agents/List.tsx`: table layout with columns name, domain, protocols (comma-separated), status dot (green=available, red=unavailable); handles empty state — `cli/src/agents/List.tsx`
- [ ] T035 [US4] Integrate protocol validation into `caipe chat` startup: after resolving the agent via registry.ts, call `validateProtocol(agent, requestedProtocol)`; on mismatch: render Ink prompt "Agent `<name>` does not support `<protocol>` (supports: `<list>`) — switch protocol and continue? [y/N]"; on confirm: switch and proceed; on decline: exit 3 — `cli/src/index.ts`, `cli/src/agents/registry.ts`
- [ ] T036 [US4] Update `cli/src/chat/Repl.tsx` session status header to display active agent `displayName`, active protocol, and availability dot; show "default" agent and "a2a" protocol when none specified — `cli/src/chat/Repl.tsx`
- [ ] T037 [US4] Wire `caipe agents list [--json]`, `caipe agents info <name>` commands in `cli/src/index.ts`; add `/agents` slash command handler in `cli/src/chat/Repl.tsx` (renders agent list in-session, selecting one starts new session) — `cli/src/index.ts`, `cli/src/chat/Repl.tsx`

**Checkpoint**: `caipe agents list` renders table with protocols column. `caipe chat --agent argocd` shows agent name + protocol in header. `--protocol agui` with A2A-only agent prompts to switch. Unavailable agent shows error + available list.

---

## Phase 7: User Story 5 — DCO Commit Assistance (Priority: P5)

**Goal**: `caipe commit` assembles a DCO-compliant commit with `Assisted-by` auto-appended and prompts for `Signed-off-by`.

**Independent Test**: Stage changes, run `caipe commit`, provide message — commit carries `Assisted-by: Claude:<model>`, user is prompted for `Signed-off-by`. Proceed without it shows warning. Commit is created.

- [ ] T038 [US5] Implement DCO trailer injection in `cli/src/commit/dco.ts`: `buildCommitMessage(draft: string, modelVersion: string): string` — appends `Assisted-by: Claude:<model-version>` trailer; `promptSignedOffBy(gitUser: GitUser): Promise<string | null>` — pre-fills suggestion from `git config user.name/email`; never generates the line on user's behalf; `applyCommit(message: string)` — calls `git commit` via execa; `installHook(repoRoot: string)` — writes `prepare-commit-msg` hook for `--install-hook` path — `cli/src/commit/dco.ts`
- [ ] T039 [US5] Wire `caipe commit [--install-hook]` command in `cli/src/index.ts`: detect staged changes via git.ts; abort with message if none staged; assemble commit message; prompt for `Signed-off-by`; if declined, show visible warning and confirm before proceeding; call `applyCommit`; exit codes per `contracts/cli-schema.md` — `cli/src/index.ts`
- [ ] T040 [P] [US5] Write unit tests covering `Assisted-by` trailer injection (assert exact format `Assisted-by: Claude:<model>`), sign-off skip path (warning emitted, commit proceeds), hook file generation (assert file written with correct shebang), staged files detection (mock git.ts) — `cli/tests/commit.test.ts`

**Checkpoint**: Stage a file, run `caipe commit`, enter message, decline `Signed-off-by` → warning shown → commit created with `Assisted-by` trailer. All T040 tests pass.

---

## Phase 8: Headless / Non-Interactive Mode (P-CI)

**Goal**: `caipe chat` works end-to-end in CI pipelines — no TTY, no browser, no interactive prompts; three credential types auto-detected; structured output to stdout.

**Independent Test**: Set `CAIPE_API_KEY`, run `caipe chat --prompt "list pods" --output json` in a shell with no TTY — response is a single JSON object on stdout, process exits 0. No credential set → exit 1 with JSON error on stderr.

- [ ] T041 Implement headless credential resolver in `cli/src/headless/auth.ts`: `resolveHeadlessCredentials(): HeadlessCredentials | null` — checks in priority order: (1) `--token <jwt>` flag or `CAIPE_TOKEN` env (JWT pass-through, used as-is); (2) `CAIPE_API_KEY` env or `settings.json auth.apiKey` (API Key, sent as Bearer); (3) `CAIPE_CLIENT_ID` + `CAIPE_CLIENT_SECRET` env (Client Credentials — `POST <serverUrl>/oauth/token` with `grant_type=client_credentials`, returns short-lived access token); returns `null` if no credential found — `cli/src/headless/auth.ts`
- [ ] T042 [P] Implement headless output formatter in `cli/src/headless/output.ts`: `createOutputWriter(format: "text" | "json" | "ndjson"): OutputWriter`; `text`: pipes raw token text to stdout as it arrives; `json`: accumulates all tokens then emits `{"response":"...","agent":"...","protocol":"..."}` on completion; `ndjson`: emits one JSON object per `StreamEvent` as it arrives (`{"type":"token","text":"..."}` / `{"type":"done"}`); errors always written to stderr as `{"error":"..."}` regardless of format — `cli/src/headless/output.ts`
- [ ] T043 Implement headless session orchestrator in `cli/src/headless/runner.ts`: `runHeadless(opts: HeadlessOpts): Promise<void>` — resolve credentials via auth.ts (exit 1 + stderr JSON if null); read prompt (priority: `opts.prompt` → `opts.promptFile` → stdin pipe); invoke `createAdapter` with resolved credentials; pipe `StreamEvent`s to `OutputWriter`; exit 0 on `done`; exit 1 on `error`; `--interactive-stdin` loop: after each response, read next line from stdin, repeat until EOF or line `\exit` — `cli/src/headless/runner.ts`
- [ ] T044 Integrate headless runner into `caipe chat`: at the top of the chat command handler in `cli/src/index.ts`, detect headless mode (`!process.stdout.isTTY || opts.headless`); if headless, call `runHeadless()` and return (Ink REPL never mounted); all interactive prompts (setup wizard, protocol-switch confirm) suppressed in headless mode — missing config exits 1 with JSON error — `cli/src/index.ts`
- [ ] T045 [P] Write unit tests covering credential priority (JWT > API Key > Client Credentials), missing credential exits 1 with JSON to stderr, `text` format streams raw, `json` format emits single blob on done, `ndjson` emits per-event, `--interactive-stdin` reads turns until EOF, `\exit` terminates early — `cli/tests/headless.test.ts`

**Checkpoint**: `CAIPE_API_KEY=x caipe chat --prompt "hello" --output json` (no TTY) outputs `{"response":"...","agent":"...","protocol":"..."}` and exits 0. No credential → exits 1 with `{"error":"no credentials configured"}` on stderr. All T045 tests pass.

---

## Phase 9: Memory Command (US1 Supporting Capability)

**Goal**: `caipe memory` opens CLAUDE.md in `$EDITOR`; `/memory` slash command allows editing without leaving chat.

**Independent Test**: Run `caipe memory` — creates `.claude/CLAUDE.md` if absent, opens in `$EDITOR`, prints which editor. Run `caipe memory --global` — opens `~/.config/caipe/CLAUDE.md`.

- [ ] T046 Implement memory file editor launcher in `cli/src/memory/editor.ts`: `openMemoryFile(scope: 'project' | 'global', cwd: string)` — resolve path via config.ts; create file with starter comment if absent; spawn `$EDITOR` (fallback `$VISUAL`, then `vi`); print which editor is being used and how to change it; wait for editor exit — `cli/src/memory/editor.ts`
- [ ] T047 Wire `caipe memory [--global]` command in `cli/src/index.ts` — `cli/src/index.ts`
- [ ] T048 Add `/memory` slash command handler in `cli/src/chat/Repl.tsx`: suspend Ink rendering, call `openMemoryFile()`, on editor exit re-run `loadMemoryFiles()` (hot-reload), resume session with updated context — `cli/src/chat/Repl.tsx`

**Checkpoint**: `caipe memory` opens editor. `/memory` in chat session edits file and reloads context without ending the session.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Cross-feature completeness, contract validation, release pipeline.

- [ ] T049 [P] Implement `--json` structured output for `caipe auth status`, `caipe skills list`, `caipe agents list` per `contracts/cli-schema.md` JSON shapes; non-interactive detection (`!process.stdout.isTTY`) switches to JSON mode automatically — `cli/src/index.ts`
- [ ] T050 [P] Implement `--no-color` global flag: set `NO_COLOR=1` env var early in index.ts; propagate to markdown.ts and diff.ts renderers; suppress all ANSI escape codes — `cli/src/index.ts`, `cli/src/platform/markdown.ts`, `cli/src/platform/diff.ts`
- [ ] T051 [P] Write CLI contract tests validating flag parsing, `--json` output shape, headless flag set (`--headless`, `--prompt`, `--output`, `--token`, `--interactive-stdin`), and exit codes match `contracts/cli-schema.md` for all command groups — `cli/tests/cli.contract.test.ts`
- [ ] T052 [P] Configure GitHub Actions release workflow: `bun build --compile --target=bun-<platform>` for all four targets; publish platform packages to npm; trigger on semver tags — `.github/workflows/caipe-release.yml`
- [ ] T053 [P] Run quickstart.md validation end-to-end against a compiled binary (mock CAIPE server endpoint): install → config set server.url → auth → chat → skills list → skills install → skills update --dry-run → headless echo test — `cli/tests/quickstart.integration.test.ts`
- [ ] T054 [P] Verify all Bun test suites pass (`bun test cli/tests/`) and binary cold-start under 1s (`time ./caipe --version`) — CI pre-merge gate in `.github/workflows/caipe-ci.yml`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    └── Phase 2 (Foundational — server URL, config, auth, platform)
            ├── Phase 3 (US1 Chat REPL + dual-protocol stream) ← MVP
            │       ├── Phase 4 (US2 Skills Hub)
            │       │       └── Phase 5 (US3 Self-Improving)
            │       ├── Phase 6 (US4 Agent Routing + protocol validation)
            │       ├── Phase 8 (Headless Mode — uses stream adapter from P3)
            │       └── Phase 9 (Memory Command — uses memory/loader.ts from P3)
            ├── Phase 7 (US5 DCO Commits — depends on Phase 2 git.ts only)
            └── Phase 10 (Polish — depends on all prior phases)
```

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — blocks US2, US4, Headless, Memory Command
- **US2 (P2)**: Requires US1 auth flow; catalog install uses `getValidToken()`
- **US3 (P3)**: Requires US2 — `update.ts` depends on `scan.ts` and `install.ts`
- **US4 (P4)**: Requires US1 — `--agent` + protocol validation threads into chat stream; `registry.ts` is built here
- **US5 (P5)**: Requires Phase 2 `git.ts` only — can be developed independently of US1–US4
- **Headless Mode**: Requires US1 stream adapter (`createAdapter`) and Phase 2 `getServerUrl()`
- **Memory Command**: Requires US1 `memory/loader.ts`

### Within Each Phase

- Platform infra tasks (T008–T010) are independent and run in parallel
- Auth tasks run sequentially: keychain → oauth → tokens → wire commands
- In each user story: scanner/fetcher → installer/orchestrator → Ink component → wire command
- Headless phase: auth.ts and output.ts are independent (run in parallel), runner.ts depends on both

---

## Parallel Execution Examples

### Phase 2 Foundational

```
Parallel batch A (independent platform helpers):
  T008 cli/src/platform/git.ts
  T009 cli/src/platform/markdown.ts
  T010 cli/src/platform/diff.ts

Sequential after T006:
  T007 cli/src/platform/setup.ts (depends on T006 config.ts)
  T011 cli/src/auth/keychain.ts
  T012 cli/src/auth/oauth.ts (depends on T011 + T006 serverUrl)
  T013 cli/src/auth/tokens.ts (depends on T012 + T011)
  T014 Wire auth + config commands
  T015 [P] auth.test.ts + config.test.ts (parallel with T011–T013)
```

### Phase 3 US1 Chat REPL

```
Parallel batch:
  T017 cli/src/memory/loader.ts
  T016 cli/src/chat/stream.ts (StreamAdapter + A2aAdapter + AguiAdapter)

Sequential after parallel:
  T018 cli/src/chat/context.ts (needs T017 loader + T008 git.ts)
  T019 cli/src/chat/Repl.tsx (needs T016 StreamAdapter + T018 context)
  T020 cli/src/chat/history.ts (independent)
  T021 Wire caipe chat command

Tests in parallel with implementation:
  T022 context.test.ts + stream.test.ts [P with T016–T018]
```

### Phase 4 US2 Skills Hub

```
Parallel batch:
  T023 cli/src/skills/catalog.ts
  T024 cli/src/skills/scan.ts

Sequential after parallel:
  T025 cli/src/skills/install.ts (needs catalog + scan)
  T026 cli/src/skills/Browser.tsx (needs catalog)
  T027 Wire commands + /skills slash

Tests in parallel with implementation:
  T028 cli/tests/catalog.test.ts [P with T023]
  T029 cli/tests/skills.test.ts [P with T024–T025]
```

### Phase 8 Headless Mode

```
Parallel batch:
  T041 cli/src/headless/auth.ts
  T042 cli/src/headless/output.ts

Sequential after parallel:
  T043 cli/src/headless/runner.ts (needs T041 + T042)
  T044 Integrate into caipe chat in index.ts

Tests in parallel:
  T045 cli/tests/headless.test.ts [P with T041–T043]
```

---

## Implementation Strategy

### MVP (Phase 1 + Phase 2 + Phase 3 only)

1. Complete Phase 1: Setup scaffold
2. Complete Phase 2: Server URL config, first-run wizard, auth + platform infra
3. Complete Phase 3: Dual-protocol chat REPL (US1)
4. **STOP and VALIDATE**: `caipe config set server.url` → `caipe auth login` → `caipe chat` → streamed markdown response
5. Ship as alpha — standalone authenticated chat with A2A + AG-UI, no skills or agents required

### Incremental Delivery

| Step | Delivers |
|------|----------|
| Phase 1 + 2 + 3 | `npx caipe` → server config → auth → streaming chat (MVP) |
| + Phase 4 | Skills catalog — browse, preview, install |
| + Phase 5 | Self-updating skills |
| + Phase 6 | Domain agent routing + protocol validation |
| + Phase 7 | DCO-compliant commit assistance |
| + Phase 8 | Headless / CI mode (API Key, JWT, Client Credentials) |
| + Phase 9 | Memory management UX |
| + Phase 10 | Production release pipeline + contract coverage |

---

## Notes

- `[P]` tasks modify different files — safe to assign to different developers or run in parallel agents
- Each phase ends with a named checkpoint — stop and validate before proceeding
- Tests in `cli/tests/` use Bun's built-in test runner (Jest-compatible API)
- Ink components (`Repl.tsx`, `Browser.tsx`, `List.tsx`) are co-located with their feature logic — no global `components/` directory
- `platform/` is shared infrastructure only — add new helpers there only when three or more features need them (Rule of Three)
- `headless/` is a self-contained vertical slice: auth.ts, output.ts, runner.ts are all headless-specific; nothing in `platform/` is duplicated
- `StreamAdapter` interface in `chat/stream.ts` is the single seam between REPL/headless and protocol — both `Repl.tsx` and `headless/runner.ts` depend only on the interface, never on the concrete adapter
- Implementation branches: use `prebuild/feat/caipe-cli-<scope>` naming to trigger CI

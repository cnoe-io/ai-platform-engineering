# Implementation Plan: CAIPE CLI — v1 Core

> **CAIPE CLI** — AI-assisted coding, workflows, and platform engineering from the terminal.

**Branch**: `100-caipe-v1-core` | **Date**: 2026-04-12 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `docs/docs/specs/100-caipe-v1-core/spec.md`

## Summary

CAIPE CLI is a terminal AI assistant purpose-built for platform engineers. It covers three primary workflows: **coding assistance** (AI chat with repo context, DCO-compliant commits), **skills and automation** (discover, install, and self-update Markdown-based automation routines), and **platform workflows** (route queries to specialised CAIPE server agents — ArgoCD, GitHub, AWS, and others). It ships as a single binary distributed via npm (`npx caipe`).

The v1 implementation is a TypeScript + Bun project using React + Ink for the TUI, OAuth 2.0 PKCE for authentication, and a GitHub Releases static manifest for the skills catalog.

## Technical Context

**Language/Version**: TypeScript 5.x, Bun 1.x  
**Primary Dependencies**: React 19, Ink 5 (TUI), Commander.js (CLI parsing), `@ag-ui/client` (AG-UI SSE streaming), native `fetch` + `EventSource` (A2A SSE — no separate SDK needed), keytar (OS keychain), marked-terminal (Markdown → ANSI), diff (unified diff), execa (git subprocess)  
**Storage**: Local filesystem only — `~/.config/caipe/` (global) + `.claude/` or `skills/` (per-project); `settings.json` holds `server.url` and optional `auth.apiKey`  
**Testing**: Bun test (Jest-compatible API) — unit + contract tests; integration tests require a mock CAIPE server endpoint  
**Target Platform**: macOS (primary), Linux (primary), WSL2 (secondary)  
**Project Type**: CLI — single binary, npx-installable  
**Performance Goals**: First response stream begins within 3s; `npx caipe` cold-start under 60s; skill update check under 10s for 50 skills  
**Constraints**: No prerequisites beyond npm/npx; no plaintext credential storage; offline skill browsing via cache; no hardcoded server URL  
**Scale/Scope**: Single user per install; hundreds of installed skills; sessions up to 100k tokens; headless mode for CI pipelines

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Test-first quality gates | PASS | Acceptance criteria in spec → Bun test scenarios; tests written before implementation |
| Conventional commits + DCO | PASS | dco-ai-attribution skill enforced in AGENTS.md |
| Skills over ad-hoc prompts | PASS | caipe-cli is a skills consumer; bundled skills ship in the binary |
| Technology stack alignment | PASS | TypeScript aligns with `ui/` package; Bun is a tooling choice, not a new agent framework |
| YAGNI / Rule of Three | PASS | No speculative features beyond the 5 user stories |
| Security by default | PASS | Tokens in OS keychain; skill checksum verification; trust warnings |
| Specs as source of truth | PASS | This plan derives from spec.md; no implementation detail added without spec backing |
| Prebuild branch naming | NOTE | Implementation branches should use `prebuild/feat/caipe-cli-<scope>` to trigger CI |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/100-caipe-v1-core/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Entities and storage layout
├── contracts/
│   └── cli-schema.md    # CLI command contract
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

caipe-cli is a feature-centric package. Each CLI feature owns its logic, types, and Ink UI co-located in a single directory. There is no layer-based split (no global `components/`, `services/`, or `utils/` directories — those abstractions are premature at this scale).

```text
cli/
├── package.json          # name: "caipe", bin: { caipe: "./dist/shim.js" }
├── tsconfig.json
├── bunfig.toml           # Bun build + compile config
│
├── src/
│   ├── index.ts          # Commander root; registers subcommands; --version/--help
│   │
│   ├── auth/             # Feature: authentication
│   │   ├── oauth.ts      # PKCE flow + --manual (print URL) + --device (RFC 8628 poll)
│   │   ├── keychain.ts   # OS keychain adapter (keytar); never touches plaintext
│   │   └── tokens.ts     # Token lifecycle: read, refresh, expiry check
│   │
│   ├── chat/             # Feature: interactive streaming chat
│   │   ├── Repl.tsx      # Ink root: input bar, message list, status header
│   │   ├── stream.ts     # A2A SSE client: connect, stream tokens, handle errors
│   │   ├── context.ts    # Assemble git tree + memory files into session context
│   │   └── history.ts    # Serialize / restore session to ~/.config/caipe/sessions/
│   │
│   ├── skills/           # Feature: skills hub
│   │   ├── catalog.ts    # Fetch manifest, 1hr cache, SHA-256 verify
│   │   ├── install.ts    # Write skill file; target resolution; overwrite guard
│   │   ├── update.ts     # Version compare; diff; backup; apply
│   │   ├── scan.ts       # Walk .claude/, skills/, global dir for installed skills
│   │   └── Browser.tsx   # Ink paginated list: search, preview, install in-TUI
│   │
│   ├── agents/           # Feature: grid agent routing
│   │   ├── registry.ts   # GET /api/v1/agents; 5min cache; availability check
│   │   └── List.tsx      # Ink table: name, domain, status dot
│   │
│   ├── memory/           # Feature: persistent context files
│   │   ├── loader.ts     # Scan global + project CLAUDE.md; enforce token budget
│   │   └── editor.ts     # Open file in $EDITOR/$VISUAL; create if absent
│   │
│   ├── commit/           # Feature: DCO commit assistance
│   │   └── dco.ts        # Append Assisted-by; prompt for Signed-off-by
│   │
│   ├── headless/         # Feature: non-interactive / CI mode
│   │   ├── runner.ts     # Headless session orchestration: auth → stream → output → exit
│   │   ├── auth.ts       # Credential resolution: JWT > API Key > Client Credentials
│   │   └── output.ts     # Format response as text | json | ndjson to stdout
│   │
│   └── platform/         # Cross-feature infrastructure (not a catch-all utils)
│       ├── config.ts     # XDG paths: ~/.config/caipe/; settings.json r/w; server.url resolution
│       ├── setup.ts      # First-run setup wizard: URL prompt → save → proceed to auth
│       ├── git.ts        # execa wrappers: repo root, log, file tree sampling
│       ├── markdown.ts   # marked-terminal: GFM → ANSI
│       └── diff.ts       # Unified diff: old/new strings → colored terminal output
│
└── tests/
    ├── auth.test.ts       # PKCE helpers, token refresh, keychain mock
    ├── catalog.test.ts    # Manifest fetch mock, checksum verify, cache TTL
    ├── skills.test.ts     # Install target resolution, version compare, backup
    ├── context.test.ts    # Git sampling, memory loading, token budget cap
    └── cli.contract.test.ts  # Flag parsing, exit codes vs contracts/cli-schema.md
```

**Structure Decision**: Feature-centric layout — each directory is a self-contained vertical slice (logic + types + Ink UI together). `platform/` holds only infrastructure that three or more features depend on (Rule of Three). No premature layer abstractions.

## Implementation Phases

### Phase 1 — Auth + Skeleton (P1 prerequisite)

**Goal**: `caipe auth login` and `caipe auth status` work end-to-end against grid.outshift.io.

Deliverables:
1. `cli/` package scaffold: `package.json`, `tsconfig.json`, `bunfig.toml`
2. `src/index.ts` — Commander root with `--version`, `--help`, global `--url <url>` flag
3. `src/platform/config.ts` — XDG config path helpers; `settings.json` read/write; `getServerUrl()` resolver (flag → env var → settings.json → setup wizard)
4. `src/platform/setup.ts` — First-run setup wizard: Ink prompt for server URL, save to `settings.json`, proceed to auth
5. `src/auth/oauth.ts` — PKCE code verifier/challenge, local HTTP callback server, browser open, token exchange; derives auth endpoint from `server.url`; `--manual` path prints URL and prompts for code; `--device` path implements RFC 8628: `POST <server.url>/oauth/device/code` → display `user_code` + `verification_uri` → poll `<server.url>/oauth/token` at server-specified interval → handle `authorization_pending` (continue), `slow_down` (+5s interval), `access_denied` / `expired_token` (exit with error), `unsupported_grant_type` / 404 (exit, suggest `--manual`)
6. `src/auth/keychain.ts` — keytar adapter; no plaintext fallback in v1
7. `src/auth/tokens.ts` — token read/refresh/expiry; wires into every authenticated command
8. Unit tests: `auth.test.ts` — PKCE math, token expiry logic, keychain mock; Device Auth polling loop (mock: `authorization_pending` → `access_token`), `slow_down` interval increase, `expired_token` exit path, `unsupported_grant_type` → "use --manual" message
9. Unit tests: `config.test.ts` — `getServerUrl()` priority order, setup wizard flow, settings.json r/w

**Acceptance criteria (from spec)**:
- Given a user has not yet configured a server URL, when they run `caipe` or `caipe chat`, they are walked through the setup wizard (URL prompt → auth flow) without separate commands
- Given unauthenticated user runs `caipe auth login`, browser opens CAIPE server OAuth flow, token saved, status reports identity
- Given user on SSH machine runs `caipe auth login --device`, CLI displays short user code + URL, polls until approved, saves token — no browser required on that machine
- Given server does not support RFC 8628, `caipe auth login --device` exits with message directing user to `--manual`
- Given authenticated user runs `caipe auth logout`, credential removed, next login required
- Given token expiry, silent refresh succeeds without user interaction

---

### Phase 2 — Chat REPL (P1)

**Goal**: `caipe chat` opens a streaming chat session with the default CAIPE server agent.

Deliverables:
1. `src/chat/stream.ts` — AG-UI client (`@ag-ui/client`): connect to `POST /api/agui/stream`; handle `TEXT_MESSAGE_CONTENT` token stream; surface `RUN_ERROR`; reconnect on drop
2. `src/chat/stream.ts` — **dual-protocol stream client**: common `StreamAdapter` interface with two implementations:
   - `A2aAdapter` (default): native `fetch` + `EventSource` to `POST /tasks/send`; maps A2A task lifecycle events → `StreamEvent` union type
   - `AguiAdapter` (opt-in): `@ag-ui/client` to `POST /api/agui/stream`; maps AG-UI events → same `StreamEvent` union type
   - `createAdapter(protocol: "a2a" | "agui", agent: Agent): StreamAdapter` factory; `Repl.tsx` only depends on `StreamAdapter`
3. `src/platform/git.ts` — repo root detection via execa; file tree sampling; `git log` excerpt
4. `src/memory/loader.ts` — load global + project CLAUDE.md; 50k token budget cap with truncation warning
5. `src/chat/context.ts` — assemble git tree + memory files into system context string
6. `src/chat/Repl.tsx` — Ink REPL: input bar, streaming message list, agent/token/protocol status header; protocol-agnostic (consumes `StreamAdapter` only)
7. `src/chat/history.ts` — serialize session to `~/.config/caipe/sessions/<id>.json` on exit; includes `protocol` field
8. `src/platform/markdown.ts` — marked-terminal wrapper with GFM support
9. Unit tests: `context.test.ts` — git sampling, memory loading, token budget truncation
10. Unit tests: `stream.test.ts` — A2aAdapter mock SSE, AguiAdapter mock SSE, protocol mismatch prompt flow
11. Integration test: mock CAIPE server endpoint for both protocols → verify streaming render pipeline

**Acceptance criteria (from spec)**:
- Repo context (file structure, recent git log) is sent as system context at session start
- Responses stream to terminal in real-time with markdown rendered
- Session credential expiry mid-session prompts re-auth without losing context

---

### Phase 3 — Skills Hub (P2)

**Goal**: `caipe skills list`, `preview`, `install` work against the GitHub Releases catalog.

Deliverables:
1. `src/skills/catalog.ts` — manifest fetch from GitHub Releases, 1-hour file cache, SHA-256 verify
2. `src/skills/scan.ts` — walk `.claude/`, `skills/`, global dir; parse frontmatter per file
3. `src/skills/install.ts` — target resolution (`.claude/` → `skills/` → `--global`); overwrite guard; trust warning for non-official sources
4. `src/skills/Browser.tsx` — Ink paginated list with search, tag filter, preview pane on Enter
5. `src/platform/diff.ts` — unified diff helper for skill update display
6. Unit tests: `catalog.test.ts` — fetch mock, checksum, cache TTL, graceful degradation
7. Unit tests: `skills.test.ts` — install target resolution, frontmatter parsing
8. Contract test: `cli.contract.test.ts` — `--json` output shape matches `contracts/cli-schema.md`

**Acceptance criteria (from spec)**:
- `caipe skills list` renders searchable list with names and one-line descriptions
- `caipe skills preview <name>` shows full SKILL.md with markdown rendering
- Installing an already-installed skill warns and requires `--force`
- Catalog unreachable → stale cache used; no crash

---

### Phase 4 — Self-Improving Skills (P3)

**Goal**: `caipe skills update` detects outdated skills, shows diffs, applies with confirmation.

Deliverables:
1. `src/skills/update.ts` — version compare (semver); per-skill confirm loop; backup as `<name>.md.bak` before write
2. Diff rendered in terminal via `src/platform/diff.ts` (added lines green, removed lines red)
3. `--dry-run` flag: report what would change without touching any file
4. Unit tests in `skills.test.ts`: semver comparison, backup-and-replace, catalog-unreachable guard

**Acceptance criteria (from spec)**:
- `caipe skills update` reports which skills have newer versions
- Diff shown before any file is modified
- Old version backed up as `.bak` before replacement
- Catalog unreachable → clear error, no files modified

---

### Phase 5 — Grid Agents (P4)

**Goal**: `caipe agents list`, `caipe chat --agent <name>` route to specific CAIPE server agents.

Deliverables:
1. `src/agents/registry.ts` — `GET /api/v1/agents`; 5-minute TTL cache; availability health check
2. `src/agents/List.tsx` — Ink table: name, domain, status dot
3. `--agent <name>` flag in `src/index.ts` passed through to `src/chat/stream.ts` endpoint selection
4. Session header in `src/chat/Repl.tsx` shows active agent name
5. Error path: agent unavailable → list available agents as inline recovery hint
6. Unit tests: registry cache TTL, availability check, unknown agent error path

**Acceptance criteria (from spec)**:
- `caipe agents list` shows all CAIPE server agents with names and capability descriptions
- `caipe chat --agent argocd` pins session to ArgoCD agent
- Default generalist agent used when no `--agent` specified; agent name shown in session header
- Specified agent unavailable → error with list of available agents

---

### Phase 6 — DCO Commit Assistance (P5)

**Goal**: `caipe commit` assembles a DCO-compliant commit message with `Assisted-by` trailer.

Deliverables:
1. `src/commit/dco.ts` — detect staged changes via `src/platform/git.ts`; append `Assisted-by: Claude:<model>` to draft commit message
2. Prompt user for `Signed-off-by`; pre-fill suggestion from `git config user.name` + `git config user.email`; never generate the line on behalf of the user
3. Warning rendered if user skips `Signed-off-by` and proceeds
4. Optional opt-in: `caipe commit --install-hook` writes a `prepare-commit-msg` git hook that reminds the user on bare `git commit`
5. Unit tests: trailer injection, sign-off prompt skip path, hook file generation

**Acceptance criteria (from spec)**:
- AI-assisted commits via CLI carry `Assisted-by: Claude:<model-version>` automatically
- User prompted for `Signed-off-by`; CLI never generates it on user's behalf
- User can override and commit without `Signed-off-by` with a visible warning

---

### Phase 7 — Memory Command + `/memory` Slash Command

**Goal**: `caipe memory` opens CLAUDE.md in `$EDITOR`; `/memory` available in-session.

Deliverables:
1. `src/memory/editor.ts` — create CLAUDE.md if absent; open in `$EDITOR`/`$VISUAL`; report which editor and how to change it
2. `/memory` slash command handler in `src/chat/Repl.tsx` — suspend input, open editor, reload memory context on return
3. Memory hot-reload: `src/memory/loader.ts` re-runs after editor exits; session continues with updated context
4. Unit tests: file creation, `$EDITOR`/`$VISUAL` env detection, path scope selection (global vs project)

---

### Phase 8 — Headless / Non-Interactive Mode (P-CI)

**Goal**: `caipe chat` (and `caipe chat --agent <name>`) work end-to-end in CI pipelines and automation scripts — no TTY, no browser, no interactive prompts.

Deliverables:
1. `src/headless/auth.ts` — credential resolver: JWT pass-through (`CAIPE_TOKEN` / `--token`) → API Key (`CAIPE_API_KEY` / `settings.json auth.apiKey`) → Client Credentials (`CAIPE_CLIENT_ID` + `CAIPE_CLIENT_SECRET` → token exchange via `POST <server.url>/oauth/token`)
2. `src/headless/output.ts` — format writer: `text` (raw stream to stdout), `json` (accumulate → single blob on completion), `ndjson` (one JSON object per `StreamEvent`)
3. `src/headless/runner.ts` — orchestrator: detect headless (no TTY or `--headless` flag), resolve credentials, read prompt (`--prompt` → `--prompt-file` → stdin), invoke `StreamAdapter`, write output, exit with appropriate code; `--interactive-stdin` loop for multi-turn
4. Integration with `src/index.ts` — `caipe chat` and `caipe chat --agent <name>` route through `headless/runner.ts` when no TTY detected; Ink REPL bypassed entirely
5. `src/platform/config.ts` update — expose `getHeadlessCredentials()` reading all three credential types from env + settings
6. Unit tests: `headless.test.ts` — credential priority order, missing credential exit code, `text`/`json`/`ndjson` output format, `--interactive-stdin` loop with EOF and `\exit` termination, prompt resolution priority
7. Contract tests: headless flags in `cli.contract.test.ts` — `--headless`, `--prompt`, `--prompt-file`, `--output`, `--interactive-stdin`, `--token`

**Acceptance criteria (from spec)**:
- Given a CI script sets `CAIPE_API_KEY` and runs `caipe chat --prompt "list pods"`, the response is written to stdout and the process exits 0
- Given `CAIPE_TOKEN` and `CAIPE_API_KEY` are both set, JWT is used (priority order)
- Given no credential is present in headless mode, exit 1 with `{"error":"no credentials configured"}` to stderr; no interactive prompt
- Given `--output ndjson`, one JSON object per token/event is written to stdout as it streams
- Given `--interactive-stdin`, the session reads newline-delimited turns until EOF; each response precedes the next read

---

## Distribution

```
cli/
├── package.json                  # bin.caipe → ./dist/shim.js
├── dist/
│   └── shim.js                   # npm wrapper: detect platform, exec binary
└── npm/
    ├── caipe-darwin-arm64/       # optionalDependency
    │   ├── package.json
    │   └── bin/caipe
    ├── caipe-darwin-x64/
    ├── caipe-linux-arm64/
    └── caipe-linux-x64/
```

The root `caipe` npm package declares `optionalDependencies` for each platform package. The `shim.js` entry resolves the correct installed binary and execs it — `npx caipe` downloads the platform binary once and runs it directly via the npm shim. The target machine needs no Bun or Node.js runtime beyond what resolves the shim.

**CI/CD**: `prebuild/feat/caipe-*` branches trigger the standard pipeline. A dedicated GitHub Actions workflow (`caipe-release.yml`) builds platform binaries via `bun build --compile --target=bun-<platform>` and publishes npm packages on tag.

## Protocol Notes

### Dual-Protocol Architecture

caipe-cli supports **A2A (default) and AG-UI (opt-in)** as full chat protocols. Both are delivered through a common `StreamAdapter` interface — the Ink REPL is protocol-agnostic.

```
caipe chat [--protocol a2a|agui]
    │
    ▼
createAdapter(protocol, agent)
    ├── A2aAdapter  (default) ──► POST /tasks/send  (SSE)
    └── AguiAdapter (--protocol agui) ──► POST /api/agui/stream  (SSE)
    │
    ▼
StreamEvent union type  ──► Repl.tsx (protocol-agnostic render)
```

### A2A (default protocol)

`src/chat/stream.ts` `A2aAdapter` uses native `fetch` + `EventSource`:
- **Session**: `POST /tasks/send` with Bearer token + context payload; SSE response streams task lifecycle events
- **Agent discovery**: `GET /.well-known/agent.json` → `AgentCard` (name, description, capabilities, endpoint)
- **Extended card**: `GET /agent/authenticatedExtendedCard` with Bearer token for private metadata
- **Protocol registry**: `GET /api/v1/agents` returns `protocols: string[]` per agent; used for pre-connect validation
- Session context UUID passed per request to preserve conversation state across turns
- First-party CLI: `caipe-cli` (this project), superseding `cnoe-io/agent-chat-cli`

| A2A event / pattern | StreamEvent emitted |
|---------------------|-------------------|
| SSE task delta (text chunk) | `{ type: "token", text }` |
| `task.status = completed` | `{ type: "done" }` |
| `task.status = failed` | `{ type: "error", message }` |
| Tool call artifact | `{ type: "tool", name, status }` |

### AG-UI (opt-in via `--protocol agui`)

`src/chat/stream.ts` `AguiAdapter` uses `@ag-ui/client` to connect to `POST /api/agui/stream`:

| AG-UI Event | StreamEvent emitted |
|-------------|-------------------|
| `TEXT_MESSAGE_CONTENT` | `{ type: "token", text }` |
| `RUN_STARTED` | `{ type: "started", agentName }` |
| `TEXT_MESSAGE_END` / `RUN_FINISHED` | `{ type: "done" }` |
| `TOOL_CALL_START/END` | `{ type: "tool", name, status }` |
| `STATE_SNAPSHOT/DELTA` | `{ type: "state", snapshot }` |
| `RUN_ERROR` | `{ type: "error", message }` |

### Protocol validation flow

Before opening any session:
1. `src/agents/registry.ts` fetches `GET /api/v1/agents` (5-min cache)
2. If agent has `protocols` field, validate chosen protocol is listed
3. If mismatch: prompt user — "Agent `<name>` does not support `<protocol>` (supports: `<list>`) — switch and continue? [y/N]"
4. On confirm: switch protocol; on decline: exit cleanly

## Complexity Tracking

No constitution violations. All complexity is justified by the spec:

- Bun platform binaries add packaging complexity but are required for SC-001 (`npx caipe` in under 3 minutes including auth) and SC-006 (install under 60s)
- OAuth PKCE with local HTTP server adds implementation complexity but is required for FR-001 and the security gate (no plaintext tokens)
- Three-method headless auth (JWT > API Key > Client Credentials) adds branching but is required by FR-018 to cover federated CI (JWT/OIDC passthrough), simple pipeline (API Key), and service-to-service (Client Credentials) scenarios without forcing callers to obtain a browser token
- First-run setup wizard adds a UX state machine to Phase 1 but is required by FR-016 — there is no sensible default server URL to hardcode, so the wizard is the only safe path
- Device Authorization Grant (`--device`) adds a polling loop to `oauth.ts` but is required by FR-022 — it is the only ergonomic headless one-time auth path for SSH environments where `--manual` requires awkward URL copy-paste; no new files required, contained within `oauth.ts`
- OIDC token federation adds zero CLI complexity — it reuses the existing JWT pass-through path; the CAIPE server owns issuer validation entirely

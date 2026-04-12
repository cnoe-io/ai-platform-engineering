# Implementation Plan: CAIPE CLI — v1 Core

> **CAIPE CLI** — AI-assisted coding, workflows, and platform engineering from the terminal.

**Branch**: `100-caipe-v1-core` | **Date**: 2026-04-12 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `docs/docs/specs/100-caipe-v1-core/spec.md`

## Summary

CAIPE CLI is a terminal AI assistant purpose-built for platform engineers. It covers three primary workflows: **coding assistance** (AI chat with repo context, DCO-compliant commits), **skills and automation** (discover, install, and self-update Markdown-based automation routines), and **platform workflows** (route queries to specialised grid agents — ArgoCD, GitHub, AWS, and others). It ships as a single binary distributed via npm (`npx caipe`).

The v1 implementation is a TypeScript + Bun project using React + Ink for the TUI, OAuth 2.0 PKCE for authentication, and a GitHub Releases static manifest for the skills catalog.

## Technical Context

**Language/Version**: TypeScript 5.x, Bun 1.x  
**Primary Dependencies**: React 19, Ink 5 (TUI), Commander.js (CLI parsing), `@ag-ui/client` (AG-UI SSE streaming), keytar (OS keychain), marked-terminal (Markdown → ANSI), diff (unified diff), execa (git subprocess)  
**Storage**: Local filesystem only — `~/.config/caipe/` (global) + `.claude/` or `skills/` (per-project)  
**Testing**: Bun test (Jest-compatible API) — unit + contract tests; integration tests require a mock grid endpoint  
**Target Platform**: macOS (primary), Linux (primary), WSL2 (secondary)  
**Project Type**: CLI — single binary, npx-installable  
**Performance Goals**: First response stream begins within 3s; `npx caipe` cold-start under 60s; skill update check under 10s for 50 skills  
**Constraints**: No prerequisites beyond npm/npx; no plaintext credential storage; offline skill browsing via cache  
**Scale/Scope**: Single user per install; hundreds of installed skills; sessions up to 100k tokens

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
│   │   ├── oauth.ts      # PKCE flow: code verifier, local HTTP callback, browser open
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
│   └── platform/         # Cross-feature infrastructure (not a catch-all utils)
│       ├── config.ts     # XDG paths: ~/.config/caipe/; per-project .claude/
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
2. `src/index.ts` — Commander root with `--version`, `--help`
3. `src/auth/oauth.ts` — PKCE code verifier/challenge, local HTTP callback server, browser open, token exchange
4. `src/auth/keychain.ts` — keytar adapter; no plaintext fallback in v1
5. `src/auth/tokens.ts` — token read/refresh/expiry; wires into every authenticated command
6. `src/platform/config.ts` — XDG config path helpers
7. Unit tests: `auth.test.ts` — PKCE math, token expiry logic, keychain mock

**Acceptance criteria (from spec)**:
- Given unauthenticated user runs `caipe auth login`, browser opens grid OAuth flow, token saved, status reports identity
- Given authenticated user runs `caipe auth logout`, credential removed, next login required
- Given token expiry, silent refresh succeeds without user interaction

---

### Phase 2 — Chat REPL (P1)

**Goal**: `caipe chat` opens a streaming chat session with the default grid agent.

Deliverables:
1. `src/chat/stream.ts` — AG-UI client (`@ag-ui/client`): connect to `POST /api/agui/stream`; handle `TEXT_MESSAGE_CONTENT` token stream; surface `RUN_ERROR`; reconnect on drop
2. `src/platform/git.ts` — repo root detection via execa; file tree sampling; `git log` excerpt
3. `src/memory/loader.ts` — load global + project CLAUDE.md; 50k token budget cap with truncation warning
4. `src/chat/context.ts` — assemble git tree + memory files into system context string
5. `src/chat/Repl.tsx` — Ink REPL: input bar, streaming message list, agent/token status header
6. `src/chat/history.ts` — serialize session to `~/.config/caipe/sessions/<id>.json` on exit
7. `src/platform/markdown.ts` — marked-terminal wrapper with GFM support
8. Unit tests: `context.test.ts` — git sampling, memory loading, token budget truncation
9. Integration test: mock A2A SSE endpoint → verify streaming render pipeline

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

**Goal**: `caipe agents list`, `caipe chat --agent <name>` route to specific grid agents.

Deliverables:
1. `src/agents/registry.ts` — `GET /api/v1/agents`; 5-minute TTL cache; availability health check
2. `src/agents/List.tsx` — Ink table: name, domain, status dot
3. `--agent <name>` flag in `src/index.ts` passed through to `src/chat/stream.ts` endpoint selection
4. Session header in `src/chat/Repl.tsx` shows active agent name
5. Error path: agent unavailable → list available agents as inline recovery hint
6. Unit tests: registry cache TTL, availability check, unknown agent error path

**Acceptance criteria (from spec)**:
- `caipe agents list` shows all grid agents with names and capability descriptions
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

### AG-UI (interface-to-agent) — primary protocol for caipe-cli

Per the `release/0.4.0` architecture (`098-server-persistence-agui-streaming`), **AG-UI is the unified protocol for all interface clients** (UI, Slack, CLI). A2A is reserved for server-side agent-to-agent communication only.

`src/chat/stream.ts` uses `@ag-ui/client` to connect to `POST /api/agui/stream`:

| AG-UI Event | CLI Response |
|-------------|-------------|
| `RUN_STARTED` | Show agent name in status header; start spinner |
| `TEXT_MESSAGE_START` | Open streaming render pane |
| `TEXT_MESSAGE_CONTENT` | Append token to live display |
| `TEXT_MESSAGE_END` | Finalize message; stop spinner |
| `TOOL_CALL_START` / `TOOL_CALL_END` | Show tool indicator in status bar |
| `STATE_SNAPSHOT` / `STATE_DELTA` | Update local session state (e.g., HITL prompt surfacing) |
| `RUN_ERROR` | Display error with retry prompt |
| `RUN_FINISHED` | Mark turn complete; prompt for next input |

### A2A (agent discovery only)

`src/agents/registry.ts` still uses A2A agent card discovery:
- `GET /.well-known/agent.json` → `AgentCard` (name, description, capabilities, endpoint)
- `GET /agent/authenticatedExtendedCard` with Bearer token for private metadata
- Session context ID (UUID) passed per request to preserve conversation state across turns

The first-party Python reference for A2A patterns is `cnoe-io/agent-chat-cli`.

## Complexity Tracking

No constitution violations. All complexity is justified by the spec:

- Bun platform binaries add packaging complexity but are required for SC-001 (`npx caipe` in under 3 minutes including auth) and SC-006 (install under 60s)
- OAuth PKCE with local HTTP server adds implementation complexity but is required for FR-001 and the security gate (no plaintext tokens)

# Phase 0 Research: caipe-cli v1 Core

**Branch**: `100-caipe-v1-core` | **Date**: 2026-04-12

## How this research was conducted

Analysis of terminal CLI design patterns in the Node.js/TypeScript/Bun ecosystem, cross-referenced with the caipe-cli spec and CAIPE constitution. The A2A protocol patterns are derived from `cnoe-io/agent-chat-cli` — the first-party Python reference implementation for A2A agent communication used in this project. All architectural decisions are original to caipe-cli.

---

## Decision 1 — Runtime: Bun + TypeScript

**Decision**: Build with **TypeScript 5.x** compiled and bundled by **Bun**. Distribute a pre-compiled single binary via npm `optionalDependencies` per platform (same pattern as `esbuild`, `@biomejs/biome`, `tailwindcss`).

**Rationale**:
- Bun's `bun build --compile` produces a self-contained binary with Node.js-compatible runtime built-in — no user Node installation required beyond what resolves the npm wrapper shim
- Single binary eliminates the cold-start npm install overhead; `npx caipe` resolves to a platform binary via the `bin` wrapper in the root package
- TypeScript is native to Bun (zero transpile step in dev)
- Consistent with constitution: TypeScript is in the stack (`ui/` uses Next.js); Bun is a natural evolution for tooling

**Alternatives considered**:
- **Node.js + tsup bundle**: Simpler, but requires Node.js runtime on user's machine; startup ~200ms slower; larger install footprint
- **Rust (cargo)**: Fast binary, no runtime; but higher contributor barrier, no npm ecosystem, weaker streaming/async library story
- **Go**: Good binary story; but TypeScript ecosystem (React + Ink, Anthropic SDK) is far richer for this use case

---

## Decision 2 — Terminal UI: React + Ink

**Decision**: Use **Ink v5** (React for CLIs) as the TUI framework. React components render to terminal via Ink's yoga-flex layout engine.

**Rationale**:
- Confirmed production-grade at massive scale (Claude Code's ~512k line codebase runs on Ink)
- Supports streaming, stateful UI, keyboard navigation, lists, dialogs, spinners natively
- Skills Hub browse/preview/install maps directly to React component state machines
- All team members with UI experience can contribute (same React mental model as the `ui/` package)

**Alternatives considered**:
- **Blessed/neo-blessed**: Lower-level; no React; harder state management; unmaintained
- **Plain readline + chalk**: Works for simple CLIs; inadequate for paginated lists, skill diffs, and streaming chat
- **Enquirer/Prompts**: Good for forms; not designed for persistent chat UX

---

## Decision 3 — Authentication: OAuth 2.0 PKCE + Local HTTP Callback

**Decision**: Implement the **OAuth 2.0 Authorization Code flow with PKCE** (RFC 7636). The CLI starts a local HTTP server on a random port to capture the redirect, then opens the browser. Tokens stored in the **OS keychain** via `keytar` (macOS Keychain, libsecret on Linux, Windows Credential Manager).

**Rationale**:
- PKCE is the modern standard for public clients (no client secret needed)
- Local HTTP callback is the most user-friendly approach — no copy-paste required
- `keytar` uses the OS native secret store: tokens are encrypted at rest without any key management in the app
- Manual fallback (display URL, prompt for code) covers headless/SSH environments

**Credential storage comparison**:

| Approach | Encrypted at rest | Works headless | Implementation |
|----------|-------------------|----------------|----------------|
| keytar (OS keychain) | Yes (OS-managed) | No (fallback needed) | Recommended |
| Encrypted file (~/.config) | Yes (app-managed) | Yes | Fallback for headless |
| Plaintext ~/.config | No | Yes | Rejected — security risk |

**Token lifecycle**:
- Access token stored with expiry; refresh token stored separately
- On each request, check expiry → silent refresh if expired → re-authenticate only if refresh fails

---

## Decision 4 — Skills Catalog: GitHub Releases Static Manifest

**Decision**: The skills catalog is a **versioned static JSON manifest** published as a GitHub Release asset on the `outshift/skills` repository. The CLI fetches it via unauthenticated HTTPS; installation of individual skills may optionally require grid auth for private skills.

**Resolves FR-014** (NEEDS CLARIFICATION).

**Rationale**:
- No server infrastructure required for v1
- Browsable offline using last-cached manifest
- Skills contributed via PR to `outshift/skills` — same workflow the team already uses
- GitHub releases provide per-version permalinks and checksums for provenance verification
- Consistent with how Claude Code's plugin marketplace degrades gracefully when unreachable

**Manifest format** (`catalog.json`):
```json
{
  "version": "1.0.0",
  "generated": "2026-04-12T00:00:00Z",
  "skills": [
    {
      "name": "dco-ai-attribution",
      "version": "1.0.0",
      "description": "DCO compliance and AI attribution for commits",
      "author": "outshift",
      "tags": ["git", "compliance"],
      "url": "https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/skills/dco-ai-attribution/SKILL.md",
      "checksum": "sha256:..."
    }
  ]
}
```

**Alternatives considered**:
- **grid.outshift.io API**: Requires auth to browse; more infrastructure; better for private skills (v2 option)
- **npm registry**: Skills as npm packages adds publishing overhead; npm scoping complicates discovery
- **Hardcoded list in CLI binary**: No update path; rejected

---

## Decision 5 — Agent Routing: Session-Pinned for v1

**Decision**: Selecting an agent pins **the entire chat session** to that agent. Users select an agent at session start (`caipe chat --agent argocd`); switching requires starting a new session.

**Resolves FR-013** (NEEDS CLARIFICATION).

**Rationale**:
- Simpler state machine: one agent endpoint per session; no mid-conversation routing logic
- Consistent with the A2A protocol's task lifecycle model (task is assigned to one agent)
- Matches UX of most terminal chat tools (model/agent selection at session start)
- Per-message routing is a natural v2 enhancement once session context persistence is proven

**Per-message routing (deferred to v2)**:
- Requires the CLI to maintain separate context windows per agent
- Needs session memory compaction strategy when switching agents
- The grid's A2A supervisor already handles multi-agent routing — can delegate to it in v2

---

## Decision 6 — Skills Loading: Multi-Directory Scan

**Decision**: Skills are loaded from three directories in priority order:
1. Project-level: `.claude/` (if exists in cwd or any parent up to home)
2. Project-level: `skills/` (if exists in cwd)
3. Global: `~/.config/caipe/skills/`

All directories are scanned for `*.md` files with valid YAML frontmatter containing at minimum `name` and `description`.

**Rationale**: Mirrors how Claude Code scans for skills/commands from project and global config directories, enabling per-project and shared global skills.

---

## Decision 7 — Memory: Multi-Level CLAUDE.md Files

**Decision**: Memory is implemented as **Markdown files** read at session start:
- Global: `~/.config/caipe/CLAUDE.md` — user preferences, global instructions
- Project: `.claude/CLAUDE.md` — project-specific context (gitignored by default)
- Managed: `.claude/memory/` — agent-written memories from `/remember` skill

Memory files are opened in `$EDITOR`/`$VISUAL` via `caipe memory` command, identical to Claude Code's pattern.

**Rationale**: Files are human-readable, diffable, and versionable. No database needed for v1.

---

## Resolved Clarifications Summary

| FR | Question | Resolution |
|----|----------|-----------|
| FR-013 | Agent routing: session-pinned vs per-message | **Session-pinned** (v1); per-message deferred to v2 |
| FR-014 | Catalog distribution model | **GitHub Releases static manifest** on `outshift/skills` repo |

---

---

## Decision 8 — Interface Protocol: AG-UI (not A2A)

**Decision**: caipe-cli communicates with the grid using the **AG-UI protocol** (`@ag-ui/client` TypeScript SDK). A2A is reserved for server-side agent-to-agent communication only.

**Rationale**:
- `release/0.4.0` introduces AG-UI as the unified interface protocol for all clients (UI, Slack, CLI) per spec `098-server-persistence-agui-streaming`
- AG-UI event types map directly to the streaming chat UX: `TEXT_MESSAGE_START` → begin render, `TEXT_MESSAGE_CONTENT` → token stream, `TEXT_MESSAGE_END` → finalize, `RUN_ERROR` → error state
- `@ag-ui/client` handles the SSE stream, reconnection, and event parsing — caipe-cli does not need to implement raw SSE parsing
- Using the same client library as the UI ensures protocol parity and reduces maintenance burden

**AG-UI endpoint**: `POST /api/agui/stream` (SSE response)

**Relevant event types for CLI**:

| Event | CLI action |
|-------|-----------|
| `RUN_STARTED` | Show agent name in status bar; start spinner |
| `TEXT_MESSAGE_START` | Begin streaming render pane |
| `TEXT_MESSAGE_CONTENT` | Append token to stream display |
| `TEXT_MESSAGE_END` | Finalize message; stop spinner |
| `TOOL_CALL_START/END` | Show tool use indicator in status bar |
| `STATE_SNAPSHOT/DELTA` | Update session state (e.g., HITL prompts) |
| `RUN_ERROR` | Surface error message; offer retry |
| `RUN_FINISHED` | Mark session turn complete |

**Alternatives considered**:
- **Raw A2A SSE** from `agent-chat-cli`: used for agent-to-agent; the platform is migrating away from A2A for interface clients in 0.4.0
- **Custom REST polling**: rejected — no streaming, poor UX for token-by-token display

---

## Technology Stack (v1)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | TypeScript 5.x | Team familiarity, Anthropic SDK available |
| Runtime/Bundler | Bun 1.x | Single binary compile, fast startup, no Node prereq |
| Distribution | npm + platform binaries via optionalDependencies | `npx caipe` works out of the box |
| Terminal UI | React 19 + Ink 5 | Production-proven at Claude Code scale |
| CLI parsing | Commander.js | Mature, used by Claude Code |
| Auth | OAuth 2.0 PKCE + keytar | Secure, browser-based, OS keychain storage |
| Catalog | GitHub Releases JSON manifest | No infra, offline-capable, PR-contributed |
| Markdown render | `marked-terminal` | Terminal ANSI output from GitHub-flavored MD |
| Diff | `diff` npm package | Unified diff for skill updates |
| Git context | `execa` → `git rev-parse` + `git log` | Lightweight, no git binding needed |
| Interface protocol | AG-UI (`@ag-ui/client`) | Unified interface protocol from 0.4.0; handles SSE stream, reconnect, event parsing |
| Testing | Bun test (built-in) | Zero config; compatible with Jest API |

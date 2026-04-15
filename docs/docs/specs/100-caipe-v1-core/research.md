# Phase 0 Research: caipe-cli v1 Core

**Branch**: `100-caipe-v1-core` | **Date**: 2026-04-12

## How this research was conducted

Analysis of terminal CLI design patterns in the Node.js/TypeScript/Bun ecosystem, cross-referenced with the caipe-cli spec and CAIPE constitution. The A2A protocol patterns are derived from the original `cnoe-io/agent-chat-cli` Python reference implementation, now superseded by `caipe-cli` (this TypeScript/Bun CLI). All architectural decisions are original to caipe-cli.

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
| FR-015–016 | Server URL config and first-run | **`server.url` in settings.json**; `--url` override; first-run setup wizard |
| FR-017–021 | Headless mode, auth, I/O, multi-turn | **TTY-less + `--headless` flag**; JWT > API Key > Client Credentials; `--prompt`/`--prompt-file`/stdin; `--output text\|json\|ndjson`; `--interactive-stdin` multi-turn |
| FR-001, FR-022 | Device Authorization Grant for SSH/headless one-time auth | **RFC 8628 `--device` flag** alongside `--manual`; polls until approve/deny/expire; `--manual` fallback for servers without RFC 8628 |
| FR-018 (OIDC) | OIDC token federation for CI zero-credential path | **Passthrough via existing `CAIPE_TOKEN`**; CLI is provider-agnostic; server validates issuer |

---

---

## Decision 8 — Dual Interface Protocol: A2A (default) + AG-UI (opt-in)

**Decision**: caipe-cli supports **both A2A and AG-UI** as full chat protocols. **A2A is the v1 default** — it covers today's grid agents broadly. AG-UI is available via `--protocol agui` for agents that have migrated to the newer interface. Both are exposed through a common `StreamAdapter` interface in `src/chat/stream.ts` so the REPL is protocol-agnostic.

**Protocol selection**:
1. User specifies `--protocol agui|a2a` (or omits → defaults to `a2a`)
2. CLI fetches per-agent protocol list from `GET /api/v1/agents` registry before connecting
3. If requested protocol not in agent's `protocols` list → prompt user to switch; proceed only on confirmation

**Rationale**:
- A2A is the default because all current grid agents support it; AG-UI adoption is in progress
- AG-UI support future-proofs the CLI for agents migrating to the newer interface
- Common `StreamAdapter` interface means zero REPL changes when switching protocols — only the adapter changes
- `caipe-cli` (this project) is the first-party A2A CLI, superseding `cnoe-io/agent-chat-cli`

**A2A protocol (default)**:

| A2A event / pattern | CLI action |
|---------------------|-----------|
| `POST /tasks/send` (SSE) | Open session; stream task updates |
| `tasks/updates` delta | Append token to live display |
| `task.status = completed` | Finalize message; stop spinner |
| `task.status = failed` | Surface error; offer retry |
| `GET /api/v1/agents` | Registry fetch; protocol + availability check |
| `GET /.well-known/agent.json` | AgentCard discovery for endpoint URL |

**AG-UI protocol (opt-in via `--protocol agui`)**:

| AG-UI event | CLI action |
|-------------|-----------|
| `RUN_STARTED` | Show agent name in status bar; start spinner |
| `TEXT_MESSAGE_START` | Begin streaming render pane |
| `TEXT_MESSAGE_CONTENT` | Append token to stream display |
| `TEXT_MESSAGE_END` | Finalize message; stop spinner |
| `TOOL_CALL_START/END` | Show tool use indicator in status bar |
| `STATE_SNAPSHOT/DELTA` | Update session state (e.g., HITL prompts) |
| `RUN_ERROR` | Surface error message; offer retry |
| `RUN_FINISHED` | Mark session turn complete |

**AG-UI endpoint**: `POST /api/agui/stream` (SSE response) via `@ag-ui/client`

**Alternatives considered**:
- **AG-UI only**: rejected — not all grid agents support AG-UI yet; would block users with A2A-only agents
- **A2A only**: rejected — locks out AG-UI-capable agents and doesn't future-proof for the migration
- **Custom REST polling**: rejected — no streaming, poor UX for token-by-token display

---

## Decision 11 — Device Authorization Grant (RFC 8628) for Headless One-Time Setup

**Decision**: Implement `caipe auth login --device` using **OAuth 2.0 Device Authorization Grant (RFC 8628)**. The flow runs alongside the existing browser PKCE path and `--manual` fallback — it is not a replacement.

**Resolves FR-022**.

**Rationale**:
- Device Auth eliminates the primary pain point of `--manual`: no long URL to copy-paste and no authorization code to paste back; the user just types a short 8-character code on any device
- The flow is fully CLI-driven: `POST <server.url>/oauth/device/code` → display `user_code` + `verification_uri` → poll `<server.url>/oauth/token` at server-specified interval → save tokens on success
- Tokens are stored identically to the PKCE flow (OS keychain via keytar) — no downstream changes
- `--manual` is preserved as fallback for CAIPE server deployments that do not implement RFC 8628 (detected via `unsupported_grant_type` or 404 on the device endpoint)
- RFC 8628 is supported by all major OAuth 2.0 servers (Keycloak, Okta, Auth0, Dex) — adoption risk is low

**Device Auth flow**:
```
CLI                          CAIPE server
 │  POST /oauth/device/code      │
 │─────────────────────────────► │
 │  ◄─ device_code, user_code,   │
 │       verification_uri,       │
 │       expires_in, interval    │
 │                               │
 │  Display to user:             │
 │  "Go to: https://...          │
 │   Enter code: ABCD-EFGH"      │
 │                               │
 │  [User approves in browser]   │
 │                               │
 │  POST /oauth/token            │
 │  (poll every interval secs)   │
 │─────────────────────────────► │
 │  ◄─ access_token (on approve) │
 │  ◄─ authorization_pending     │
 │       (continue polling)      │
 │  ◄─ access_denied / expired   │
 │       (exit with error)       │
```

**Error handling**:
- `authorization_pending`: continue polling (no log output)
- `slow_down`: increase poll interval by 5s, continue
- `access_denied`: exit 1 with "Authorization denied by user"
- `expired_token`: exit 1 with "Device code expired — re-run to start a new request"
- Server returns 404 or `unsupported_grant_type`: exit 1 with "Server does not support device auth — use `--manual` instead"

**Alternatives considered**:
- **`--manual` only**: retained as fallback; inferior UX (long URL, code paste-back)
- **Browser PKCE on SSH**: requires browser on the same machine; not viable
- **Headless Chrome for PKCE**: fragile, heavyweight, rejected

---

## Decision 9 — Server URL Configuration: Single `server.url` in settings.json

**Decision**: The CAIPE server base URL is stored in `~/.config/caipe/settings.json` under the key `server.url`. A `--url <url>` CLI flag overrides it for a single invocation. All API endpoints (agents registry, task submission, OAuth/auth) are derived from this single base URL — no separate auth URL configuration is required.

**Resolves FR-015 and FR-016**.

**Rationale**:
- Single source of truth eliminates URL drift between auth and API endpoints (e.g., mismatched proxy configs)
- Config file pattern is idiomatic for CLI tools — consistent with `~/.config/gh/config.yml`, `~/.kube/config`, etc.
- `--url` per-invocation override covers multi-server scenarios (dev vs prod) without persisting the change
- On first run with no `server.url`, a setup wizard prompts once, saves the URL, and immediately proceeds to auth — zero extra commands
- Derives all endpoints as `<server.url>/path` (e.g., `<server.url>/oauth`, `<server.url>/api/v1/agents`, `<server.url>/tasks/send`) — avoids endpoint proliferation in config

**Settings file layout**:
```json
{
  "server": {
    "url": "https://caipe.example.com"
  },
  "auth": {
    "apiKey": "<optional, for headless>"
  }
}
```

**Endpoint derivation table**:

| Endpoint purpose | Derived path |
|-----------------|-------------|
| OAuth / OIDC discovery | `<server.url>/oauth` |
| Agents registry | `<server.url>/api/v1/agents` |
| A2A task submission | `<server.url>/tasks/send` |
| AG-UI stream | `<server.url>/api/agui/stream` |
| AgentCard discovery | `<server.url>/.well-known/agent.json` |

**Alternatives considered**:
- **Separate `--auth-url` flag**: rejected — two URLs to configure increases cognitive load and error surface
- **Hardcoded default URL**: rejected — there is no sensible default; every deployment has a different URL
- **Environment variable only (`CAIPE_SERVER_URL`)**: rejected — env vars don't persist across shell sessions; config file is the durable mechanism; env var still accepted as a last-resort override

---

## Decision 10 — Headless Mode Auth: Three Methods, Presence-Based Priority

**Decision**: In headless/non-interactive mode, the CLI supports three credential types detected automatically by which is present. Priority order (first match wins): **(1) JWT pass-through** (`CAIPE_TOKEN` env var or `--token <jwt>` flag) → **(2) API Key** (`CAIPE_API_KEY` env var or `auth.apiKey` in `settings.json`) → **(3) OAuth2 Client Credentials** (`CAIPE_CLIENT_ID` + `CAIPE_CLIENT_SECRET` env vars, exchanged for a short-lived access token before the session).

**Resolves FR-017, FR-018, FR-019, FR-020, FR-021**.

**Rationale**:
- JWT pass-through is the highest priority because it is the most explicit — the caller already has a validated token, no additional exchange needed; lowest latency
- API Key is simplest to configure for automated pipelines and covers the majority of CI use cases; stored in `settings.json` so it persists across invocations without env var management
- Client Credentials is the most powerful (auto-rotates, scope-limited) but adds one extra network round-trip for the token exchange; used when neither JWT nor API Key is provided

**Headless activation**:
- Automatic: no TTY detected (`!process.stdout.isTTY`)
- Explicit: `--headless` flag (for scripts that redirect stdout but still have a PTY)

**Input priority**:
1. `--prompt <text>` — inline text, suitable for short one-liners
2. `--prompt-file <path>` — file path, suitable for long/structured prompts
3. stdin pipe — fallback when neither flag is present

**Output formats**:
- `text` (default): raw response text streamed to stdout
- `json`: full response accumulated, then a single object emitted on completion: `{"response":"...","agent":"...","protocol":"..."}`
- `ndjson`: one JSON object per token/event as it arrives: `{"type":"token","text":"..."}` / `{"type":"done"}`

**Session types**:
- Default: single-shot (one prompt → full response → exit 0)
- `--interactive-stdin`: multi-turn mode; newline-delimited prompts read from stdin until EOF or `\exit` line; `--output` format applied per turn

**OIDC token federation (zero-credential CI path)**: CI providers (GitHub Actions, GitLab CI, etc.) issue short-lived OIDC JWTs natively. These are carried via the existing JWT pass-through path (`CAIPE_TOKEN` / `--token`). The CLI passes them as an opaque Bearer token — no issuer-specific logic, no new env vars, no `settings.json` fields. The CAIPE server validates the issuer against its trusted OIDC providers. This is strictly a server-side concern; the CLI is provider-agnostic.

**Missing credential behavior**: non-zero exit + `{"error":"no credentials configured"}` to stderr; no interactive prompt.

**Alternatives considered**:
- **Single method (API Key only)**: rejected — JWT pass-through is needed for federated CI systems that already issue tokens; Client Credentials is needed for service-to-service automation where distributing static API keys is undesirable
- **Browser redirect in headless**: rejected — no TTY, no browser; would silently hang in CI
- **Prompt for credentials in headless**: rejected — breaks unattended pipelines; FR-020 explicitly requires silent failure

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
| Interface protocol | A2A (default) + AG-UI (`@ag-ui/client`, opt-in) | A2A covers all current agents; AG-UI future-proofs for migrating agents; common StreamAdapter interface |
| Server URL config | `settings.json` `server.url` + `--url` override | Single URL drives all endpoints; first-run wizard; no hardcoded default |
| Headless auth | JWT > API Key > Client Credentials (presence-based) | Covers federated CI (JWT/OIDC passthrough), simple pipelines (API Key), service-to-service (Client Credentials) |
| SSH/headless one-time auth | Device Authorization Grant (RFC 8628) via `--device` | Short code UX; no browser on same machine; `--manual` fallback |
| Testing | Bun test (built-in) | Zero config; compatible with Jest API |

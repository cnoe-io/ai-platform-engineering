# CLI Contract: caipe-cli v1

**Branch**: `100-caipe-v1-core` | **Date**: 2026-04-12

This document defines the public interface contract for the caipe-cli tool — the commands, flags, exit codes, and stdout/stderr conventions that users and scripts can depend on.

---

## Top-Level Command

```
caipe [command] [options]
```

Running `caipe` with no arguments opens the interactive chat REPL using the default agent.

---

## Global Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--version`, `-v` | boolean | — | Print version and exit |
| `--help`, `-h` | boolean | — | Print help and exit |
| `--agent <name>` | string | `default` | CAIPE server agent to use for this session |
| `--url <url>` | string | — | Override `server.url` from settings.json for this invocation only |
| `--no-color` | boolean | false | Disable ANSI color output |
| `--json` | boolean | false | Machine-readable JSON output (non-interactive commands only) |

---

## Commands

### `caipe chat`

Open an interactive streaming chat session (or headless session when no TTY / `--headless`).

```
caipe chat [options]
```

**Interactive mode flags**:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--agent <name>` | string | last-used or `default` | Pin session to this CAIPE server agent |
| `--protocol <a2a\|agui>` | string | `a2a` | Streaming protocol to use for this session |
| `--no-context` | boolean | false | Skip git/repo context gathering |
| `--resume <sessionId>` | string | — | Resume a previous session by ID |

**Headless / non-interactive flags**:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--headless` | boolean | false | Force headless mode even when TTY is present |
| `--token <jwt>` | string | — | JWT to use directly; highest auth priority |
| `--prompt <text>` | string | — | Inline prompt text; headless only |
| `--prompt-file <path>` | path | — | Read prompt from file; headless only |
| `--output <format>` | `text\|json\|ndjson` | `text` | Headless response format |
| `--interactive-stdin` | boolean | false | Multi-turn headless mode; reads newline-delimited turns from stdin until EOF or `\exit` |

**Behavior (interactive)**:
- Loads memory files (global → project → managed) before first message
- If no `server.url` configured: launches setup wizard (URL prompt → auth) before proceeding
- Validates `--protocol` against agent's supported protocols (from `GET /api/v1/agents`); if unsupported, prompts user to switch before connecting
- Connects to CAIPE server via selected protocol: A2A (`POST /tasks/send` SSE, default) or AG-UI (`POST /api/agui/stream` SSE, `--protocol agui`)
- Active protocol shown in session status header alongside agent name
- Renders markdown in terminal with ANSI formatting
- `/skills`, `/agents`, `/memory` slash commands available within session
- `Ctrl+C` or `/exit` ends session; history saved to `~/.config/caipe/sessions/<id>.json`

**Behavior (headless — no TTY or `--headless`)**:
- Activated automatically when `process.stdout.isTTY` is false, or explicitly via `--headless`
- All interactive prompts suppressed; missing config causes non-zero exit + stderr JSON error
- Credential resolution order: `--token <jwt>` / `CAIPE_TOKEN` (also accepts OIDC JWTs from CI providers — server validates issuer) → `CAIPE_API_KEY` / `settings.json auth.apiKey` → `CAIPE_CLIENT_ID` + `CAIPE_CLIENT_SECRET` (Client Credentials exchange)
- Prompt resolution order: `--prompt <text>` → `--prompt-file <path>` → stdin pipe
- Writes response to stdout in `--output` format; exits when response is complete
- `--interactive-stdin` keeps session open for multi-turn: reads next prompt from stdin after each response

**Exit codes**: `0` = clean exit, `1` = auth failure, `2` = agent unavailable, `3` = protocol unsupported and user declined switch, `4` = internal error

---

### `caipe auth`

Manage authentication.

#### `caipe auth login`

```
caipe auth login [--manual | --device]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--manual` | boolean | false | Print auth URL only; wait for user to paste authorization code back |
| `--device` | boolean | false | Device Authorization Grant (RFC 8628): display short user code + URL, poll until approved — no browser required on this machine |

**Behavior**:
- Default: open browser to CAIPE server OAuth flow (derived from `server.url`); start local HTTP server on random port to capture redirect
- `--manual`: print the auth URL and a prompt for the authorization code; use when `--device` is unsupported or unavailable
- `--device`: `POST <server.url>/oauth/device/code`; display `user_code` and `verification_uri` prominently; poll `<server.url>/oauth/token` at server-specified interval; handle responses:
  - `authorization_pending` → continue polling silently
  - `slow_down` → increase poll interval by 5s, continue
  - `access_denied` → exit 1 with "Authorization denied by user"
  - `expired_token` → exit 1 with "Device code expired — re-run to start a new request"
  - `unsupported_grant_type` or 404 → exit 1 with "Server does not support device auth — use `--manual` instead"
- Stores tokens in OS keychain on success (all three paths)
- Idempotent: if already authenticated, reports current identity and exits 0
- If `server.url` is not configured, runs setup wizard first (prompts for URL, saves it, then proceeds to auth)

**Exit codes**: `0` = authenticated, `1` = auth failure or server doesn't support device flow, `2` = server unreachable

#### `caipe auth logout`

```
caipe auth logout
```

Removes stored tokens from OS keychain. Prompts for confirmation.

#### `caipe auth status`

```
caipe auth status [--json]
```

Prints current auth state. With `--json`:
```json
{ "authenticated": true, "identity": "user@example.com", "expiresAt": "2026-04-12T18:00:00Z" }
```

---

### `caipe skills`

Manage the skills catalog and installed skills.

#### `caipe skills list`

```
caipe skills list [--tag <tag>] [--json]
```

| Flag | Type | Description |
|------|------|-------------|
| `--tag <tag>` | string | Filter by tag |
| `--installed` | boolean | Show only installed skills |
| `--json` | boolean | Output JSON array of CatalogEntry objects |

**Behavior**: Fetches catalog manifest (or uses cache); renders paginated interactive list via Ink. Arrow keys navigate; Enter previews.

#### `caipe skills preview <name>`

```
caipe skills preview <name>
```

Displays the full SKILL.md content for `<name>` in the terminal with markdown rendering. Does not install.

#### `caipe skills install <name> [--global] [--target <dir>]`

```
caipe skills install <name> [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--global` | boolean | false | Install to `~/.config/caipe/skills/` |
| `--target <dir>` | path | auto | Override install directory |
| `--force` | boolean | false | Overwrite if already installed |

**Behavior**:
1. Fetch skill content from `CatalogEntry.url`
2. Verify `sha256` checksum
3. Determine target: `.claude/` if exists, else `skills/`, else error unless `--global`
4. Warn and prompt if skill already installed (skip with `--force`)
5. Write file; print confirmation with path

**Exit codes**: `0` = installed, `1` = not found in catalog, `2` = checksum mismatch, `3` = already installed (without `--force`)

#### `caipe skills update [<name>] [--all] [--dry-run]`

```
caipe skills update [<name>] [options]
```

| Flag | Type | Description |
|------|------|-------------|
| `--all` | boolean | Check and update all installed skills |
| `--dry-run` | boolean | Report available updates; do not apply |

**Behavior**:
1. Scan installed skill files; read frontmatter versions
2. Compare against catalog manifest versions
3. For each outdated skill: show unified diff; prompt for confirmation
4. On confirm: backup existing file (`<name>.md.bak`); write new version
5. On decline: skip that skill; continue to next

---

### `caipe agents`

List and inspect grid agents.

#### `caipe agents list`

```
caipe agents list [--json]
```

Fetches agents from CAIPE server API (`GET /api/v1/agents`); renders table with name, domain, availability status.

With `--json`:
```json
[{ "name": "argocd", "displayName": "ArgoCD Agent", "domain": "gitops", "available": true }]
```

#### `caipe agents info <name>`

```
caipe agents info <name>
```

Shows full capability description and endpoint for a specific agent.

---

### `caipe config`

Manage CLI configuration stored in `~/.config/caipe/settings.json`.

#### `caipe config set <key> <value>`

```
caipe config set <key> <value>
```

Supported keys:

| Key | Description |
|-----|-------------|
| `server.url` | CAIPE server base URL (HTTPS required) |
| `auth.apiKey` | API key for headless mode (stored in settings.json) |

**Behavior**: Validates value format before writing; HTTPS required for `server.url`; prints confirmation.

#### `caipe config get <key>`

```
caipe config get <key> [--json]
```

Print the current value of a config key. With `--json`:
```json
{ "key": "server.url", "value": "https://caipe.example.com", "source": "settings.json" }
```

`source` may be `settings.json`, `--url flag`, or `CAIPE_SERVER_URL env var` to indicate override precedence.

#### `caipe config unset <key>`

```
caipe config unset <key>
```

Remove a config key from `settings.json`. Prompts for confirmation.

---

### `caipe memory`

Manage memory files that provide persistent context to chat sessions.

```
caipe memory [--global]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--global` | boolean | false | Open global `~/.config/caipe/CLAUDE.md` instead of project |

**Behavior**: Opens the appropriate CLAUDE.md in `$EDITOR` (or `$VISUAL`). Creates the file if it does not exist. Reports which editor is being used.

---

## Slash Commands (in-session)

Available within an active `caipe chat` session:

| Command | Description |
|---------|-------------|
| `/skills` | Open interactive skills browser; install from within session |
| `/agents` | Switch session to a different agent (starts new session) |
| `/memory` | Open memory file in $EDITOR without leaving session |
| `/clear` | Clear current conversation context (keep session open) |
| `/compact` | Summarize and compress conversation history to free token budget |
| `/exit` | End session and save history |

---

## Stdout / Stderr Conventions

- **Interactive mode** (TTY detected): TUI rendered via Ink to stdout
- **Non-interactive mode** (`--json` or no TTY): structured JSON to stdout; human messages to stderr
- **Errors**: always to stderr; format `[ERROR] <message>` in plain mode, `{"error":"<message>"}` in JSON mode
- **Streaming chat (interactive)**: token stream to stdout; ANSI escape codes for formatting; suppressed with `--no-color`
- **Headless `--output text`**: raw response text streamed to stdout; no ANSI codes
- **Headless `--output json`**: full response accumulated, then single JSON blob emitted on completion: `{"response":"...","agent":"...","protocol":"..."}`
- **Headless `--output ndjson`**: one JSON object per token/event as it arrives: `{"type":"token","text":"..."}` / `{"type":"done"}`
- **Headless errors**: always to stderr as `{"error":"<message>"}` regardless of `--output` format

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Authentication failure |
| 2 | Network error (agent unreachable, catalog unavailable) |
| 3 | User-facing validation error (skill not found, invalid args) |
| 4 | Internal / unexpected error |

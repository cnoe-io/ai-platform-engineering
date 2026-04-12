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
| `--agent <name>` | string | `default` | Grid agent to use for this session |
| `--no-color` | boolean | false | Disable ANSI color output |
| `--json` | boolean | false | Machine-readable JSON output (non-interactive commands only) |

---

## Commands

### `caipe chat`

Open an interactive streaming chat session.

```
caipe chat [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--agent <name>` | string | last-used or `default` | Pin session to this grid agent |
| `--protocol <a2a\|agui>` | string | `a2a` | Streaming protocol to use for this session |
| `--no-context` | boolean | false | Skip git/repo context gathering |
| `--resume <sessionId>` | string | — | Resume a previous session by ID |

**Behavior**:
- Loads memory files (global → project → managed) before first message
- Validates `--protocol` against agent's supported protocols (from `GET /api/v1/agents`); if unsupported, prompts user to switch before connecting
- Connects to grid via selected protocol: A2A (`POST /tasks/send` SSE, default) or AG-UI (`POST /api/agui/stream` SSE, `--protocol agui`)
- Active protocol shown in session status header alongside agent name
- Renders markdown in terminal with ANSI formatting
- `/skills`, `/agents`, `/memory` slash commands available within session
- `Ctrl+C` or `/exit` ends session; history saved to `~/.config/caipe/sessions/<id>.json`

**Exit codes**: `0` = clean exit, `1` = auth failure, `2` = agent unavailable, `3` = protocol unsupported and user declined switch

---

### `caipe auth`

Manage authentication.

#### `caipe auth login`

```
caipe auth login [--manual]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--manual` | boolean | false | Show auth URL only; wait for user to paste code |

**Behavior**:
- Default: open browser to grid OAuth flow; start local HTTP server on random port to capture redirect
- `--manual`: print the auth URL and a prompt for the authorization code
- Stores tokens in OS keychain on success
- Idempotent: if already authenticated, reports current identity and exits 0

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

Fetches agents from grid API; renders table with name, domain, availability status.

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
- **Streaming chat**: token stream to stdout; ANSI escape codes for formatting; suppressed with `--no-color`

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Authentication failure |
| 2 | Network error (agent unreachable, catalog unavailable) |
| 3 | User-facing validation error (skill not found, invalid args) |
| 4 | Internal / unexpected error |

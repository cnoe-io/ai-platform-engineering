# Quickstart: CAIPE CLI v1

> **CAIPE CLI** — AI-assisted coding, workflows, and platform engineering from the terminal.

**Branch**: `100-caipe-v1-core` | **Date**: 2026-04-12

---

## Prerequisites

- npm / npx (Node.js ≥ 18)
- A CAIPE server URL and an account on that server
- macOS or Linux (WSL2 supported)

No other dependencies — the binary is self-contained.

---

## Install

```bash
npx caipe
```

First run downloads the platform binary (~30 MB). Subsequent runs start in under 1 second.

To install permanently:

```bash
npm install -g caipe
```

---

## Step 0 — Configure your CAIPE server

On first run, CAIPE automatically asks for your server URL. You can also set it manually:

```bash
caipe config set server.url https://caipe.example.com
```

To verify:

```bash
caipe config get server.url
```

All API and OAuth endpoints are derived from this single URL — you only need to set it once.

---

## Step 1 — Authenticate

```bash
caipe auth login
```

- Opens your browser to the CAIPE server OAuth flow (derived from your configured `server.url`)
- Tokens are saved to the OS keychain — no re-login until the credential expires
- On headless/SSH machines: `caipe auth login --manual` prints the URL for copy-paste

Check your auth status at any time:

```bash
caipe auth status
```

---

## Step 2 — Start a Chat Session

Navigate to any git repository and run:

```bash
caipe chat
```

CAIPE automatically gathers your repo's file tree and recent git history as context. The session streams responses token-by-token using the AG-UI protocol.

### Chat with a specific CAIPE server agent

```bash
caipe chat --agent argocd    # GitOps / ArgoCD specialist
caipe chat --agent github    # GitHub workflows specialist
caipe chat --agent security  # Security / CVE triage specialist
```

### Choose streaming protocol

A2A is the default. Switch to AG-UI for agents that support it:

```bash
caipe chat --protocol agui              # Use AG-UI streaming
caipe chat --agent argocd --protocol agui
```

If the agent doesn't support the requested protocol, you'll be prompted to switch. The active protocol is shown in the session status header.

See all available agents:

```bash
caipe agents list
```

---

## Step 2b — Run in Headless / CI Mode

For automation scripts, CI pipelines, and non-interactive environments:

### API Key (simplest for CI)

```bash
export CAIPE_API_KEY=<your-api-key>
echo "list all ArgoCD applications" | caipe chat --output json
```

### JWT pass-through (federated CI systems)

```bash
caipe chat --token "$CI_TOKEN" --prompt "summarize recent failures" --output ndjson
```

### Client Credentials (service-to-service)

```bash
export CAIPE_CLIENT_ID=<client-id>
export CAIPE_CLIENT_SECRET=<client-secret>
caipe chat --prompt "check cluster health" --output text
```

### Multi-turn headless session

```bash
printf "list pods\nwhich are failing?\n\\exit\n" | \
  caipe chat --interactive-stdin --output ndjson
```

Headless mode auto-detects when no TTY is present. Force it explicitly with `--headless`.

---

## Step 3 — Install a Skill

Skills are reusable AI automation routines stored as Markdown files in your project.

```bash
# Browse the catalog
caipe skills list

# Preview before installing
caipe skills preview dco-ai-attribution

# Install into your project
caipe skills install dco-ai-attribution
```

Skills are written to `.claude/` if that directory exists, otherwise `skills/`.

---

## Step 4 — Keep Skills Up to Date

```bash
# Check for updates (shows diff before applying)
caipe skills update

# Check without changing any files
caipe skills update --dry-run

# Update all installed skills
caipe skills update --all
```

---

## Step 5 — Manage Memory

CAIPE reads Markdown memory files at session start to personalize context:

| File | Scope |
|------|-------|
| `~/.config/caipe/CLAUDE.md` | Global — applies to all projects |
| `.claude/CLAUDE.md` | Project — checked into the repo |
| `.claude/memory/*.md` | Managed — written by agents via `/remember` |

Open the project memory file in your `$EDITOR`:

```bash
caipe memory
```

Open global memory:

```bash
caipe memory --global
```

---

## In-Session Slash Commands

While in a `caipe chat` session:

| Command | Action |
|---------|--------|
| `/skills` | Browse and install skills without leaving the session |
| `/agents` | Switch to a different agent (starts new session) |
| `/memory` | Edit memory file; context reloads on return |
| `/clear` | Clear conversation context, keep session open |
| `/compact` | Summarize history to free token budget |
| `/exit` | End session and save history |

---

## DCO Commit Assistance

When committing AI-assisted code:

```bash
caipe commit
```

- Automatically appends `Assisted-by: Claude:<model-version>` to the commit message
- Prompts you for your own `Signed-off-by` (the CLI never generates this on your behalf)
- Proceed with a warning if you skip `Signed-off-by`

---

## Sign Out

```bash
caipe auth logout
```

Removes stored tokens from the OS keychain.

---

## Key Paths

| Path | Contents |
|------|----------|
| `~/.config/caipe/settings.json` | Server URL (`server.url`) and optional API key (`auth.apiKey`) |
| `~/.config/caipe/config.json` | User preferences, last-used agent |
| `~/.config/caipe/CLAUDE.md` | Global memory |
| `~/.config/caipe/skills/` | Globally installed skills |
| `~/.config/caipe/sessions/` | Chat session history |
| `.claude/` | Project skills + memory (preferred) |
| `skills/` | Project skills (fallback) |

---

## Troubleshooting

**`caipe chat` hangs at connection**: Check network access to `grid.outshift.io`. Run `caipe auth status` to verify token validity.

**Skill install fails with checksum error**: The downloaded skill content did not match the catalog's SHA-256. This may indicate a network interception (corporate proxy). Try `caipe skills install <name> --force` only if you trust the source.

**Auth fails on headless machine**: Use `caipe auth login --manual` to get the URL and complete auth in a browser elsewhere.

**Context feels truncated**: Memory files are capped at 50k tokens. Run `caipe memory` to review and trim your CLAUDE.md. Use `/compact` in-session to compress conversation history.

---
sidebar_position: 4
---

# CAIPE CLI

AI-assisted coding, workflows, and platform engineering from the terminal.

CAIPE CLI is a TypeScript/Bun program in the [`cli/`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/cli) directory. It connects to a CAIPE server via AG-UI streaming on the UI BFF, with OAuth PKCE login, an Ink chat REPL, headless mode, skills, and session history.

## Installation

### Quick install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh
```

Installs the correct binary for your platform (macOS/Linux, arm64/x64) to `/usr/local/bin/caipe`.

**Options:**
- `CAIPE_INSTALL_DIR` — override install directory (default: `/usr/local/bin`)
- `CAIPE_VERSION` — pin a specific version (default: latest)

### npm

After a release is published to npm (tag `caipe/v*.*.*` on GitHub):

```bash
npm install -g caipe@1.0.0
```

Use a **pinned version** in automation. If `npm install` returns 404, the release publish step has not completed yet — use the curl installer or a GitHub Release binary instead.

### Build from source

```bash
git clone https://github.com/cnoe-io/ai-platform-engineering.git
cd ai-platform-engineering/cli
bun install
npm run compile   # produces dist/caipe (Bun single-file binary)
./dist/caipe --version
```

## Quick Start

```bash
# 1. Point to your CAIPE server (BFF / UI)
caipe config set server.url https://your-caipe-server.example.com

# 2. Authenticate (opens browser for OAuth)
caipe auth login

# 3. List agents you are allowed to use, then chat
caipe agents list
caipe chat --agent '<agent-id>'
```

### Grid preview (split BFF and IdP)

```bash
caipe config set server.url https://grid.preview.outshift.io
caipe config set auth.url https://idp.grid.preview.outshift.io/realms/caipe
caipe auth login
```

Set `auth.url` **after** `server.url` when the IdP is on a different host than the UI.

## Commands

| Command | Description |
|---------|-------------|
| `caipe` | Open interactive chat REPL |
| `caipe chat` | Open chat (explicit). Options: `--agent`, `--protocol`, `--headless`, `--resume` |
| `caipe auth login` | Authenticate via OAuth (browser or `--device` flow) |
| `caipe auth logout` | Remove stored credentials |
| `caipe auth status` | Print current auth state |
| `caipe config set <key> <value>` | Set a configuration key |
| `caipe config get <key>` | Print the current value of a key |
| `caipe config unset <key>` | Remove a configuration key |
| `caipe skills list` | List available skills from catalog |
| `caipe skills install <name>` | Install a skill |
| `caipe skills preview <name>` | Display full SKILL.md content |
| `caipe skills update [name]` | Check and update installed skills |
| `caipe agents list` | List available server agents |
| `caipe agents info <name>` | Show agent capabilities |
| `caipe doctor` | Check auth, BFF health, and agent access |
| `caipe init` | Create project or global memory template |
| `caipe sessions list` | List saved chat sessions |
| `caipe sessions resume <id>` | Resume a saved session |
| `caipe mcp list` | List OAuth MCP connectors (BFF) |
| `caipe mcp connect <provider>` | Open browser to connect a provider |
| `caipe diff` | Git diff summary in current repo |
| `caipe local` | Local model mode (`ANTHROPIC_API_KEY`) |
| `caipe memory` | Manage persistent context files |
| `caipe commit` | DCO-compliant commit with AI attribution |

### Global Options

```
--agent <name>    CAIPE server agent to use (default: "default")
--url <url>       Override server.url from settings.json
--no-color        Disable ANSI color output
--json            Machine-readable JSON output
-v, --version     Print version and exit
```

## Interactive Chat

The chat REPL provides:

- **Streaming responses** via A2A or AG-UI Server-Sent Events
- **Slash commands** — type `/` for a picker: `/clear`, `/compact`, `/delegate`, `/sessions`, `/login`, `/skills`, `/agents`, `/help`, `/exit`
- **Readline keybindings** — `Ctrl+A/E`, `Ctrl+B/F`, `Alt+B/F`, `Ctrl+U/K/W`, `Ctrl+D`
- **Input history** — `Up/Down` or `Ctrl+P/N`
- **Shell pipes** — `!command` runs a shell command and injects output
- **Tool call visualization** — active tool calls shown in the status footer

## Headless Mode

For CI/CD pipelines and scripting:

```bash
# Single prompt
caipe chat --headless --prompt "Explain the deployment architecture"

# From file
caipe chat --headless --prompt-file question.txt --output json

# Multi-turn via stdin
echo -e "Hello\nWhat is A2A?" | caipe chat --headless --interactive-stdin

# With explicit token
caipe chat --headless --token "$JWT" --prompt "status check"
```

## Configuration

Settings are stored in `~/.config/caipe/settings.json`.

| Key | Description | Example |
|-----|-------------|---------|
| `server.url` | CAIPE BFF / UI base URL | `https://caipe.example.com` |
| `auth.url` | OAuth base URL (required when IdP is separate) | `https://idp.example.com/realms/caipe` |
| `auth.apiKey` | Static API key (alternative to OAuth) | `sk-...` |
| `auth.credential-storage` | Credential backend: `encrypted-file` or `keychain` | `encrypted-file` |
| `chat.default-agent` | Default dynamic agent id | `my-agent` |
| `chat.plain-markdown` | Disable terminal markdown rendering | `true` |
| `chat.tool-approval` | Tool notice mode: `auto`, `prompt`, `deny` | `prompt` |

## Source

[`cli/` directory in ai-platform-engineering](https://github.com/cnoe-io/ai-platform-engineering/tree/main/cli)

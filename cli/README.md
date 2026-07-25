# CAIPE CLI

Terminal client for [CAIPE](https://github.com/cnoe-io/ai-platform-engineering). **Source of truth:** [`cli/`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/cli) in the monorepo.

Docs: [CAIPE CLI integration guide](https://cnoe-io.github.io/ai-platform-engineering/docs/integrations/cli).

## TL;DR

```bash
# Install (binary from GitHub Release)
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh

# Grid preview: BFF + IdP are different hosts
caipe config set server.url https://grid.preview.outshift.io
caipe config set auth.url https://idp.grid.preview.outshift.io/realms/caipe
caipe auth login
caipe agents list
caipe chat --agent '<id-from-list>'
```

Set **`auth.url` after `server.url`** — `config set server.url` also writes `auth.url` for single-host setups; split IdP URLs need an explicit `auth.url`.

---

## Requirements

- A reachable CAIPE deployment (UI/BFF + OAuth)
- **Install:** macOS or Linux (arm64 or x64)
- **Build from source:** [Bun](https://bun.sh) 1.1+ and Node 20+

Optional: **keytar** only when `auth.credential-storage` is `keychain` (default is encrypted file).

---

## Install

### Option A — Release binary (recommended)

Downloads a platform binary from GitHub Releases (tags `caipe/v*.*.*`):

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh
```

Pin a version:

```bash
CAIPE_VERSION=1.0.0 curl -fsSL \
  https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh
```

| Variable | Purpose |
|----------|---------|
| `CAIPE_INSTALL_DIR` | Install path (default `/usr/local/bin`) |
| `CAIPE_VERSION` | Release version without `caipe/` prefix (e.g. `1.0.0`) |
| `CAIPE_NO_VERIFY` | Set to `1` to skip checksum verification (not recommended) |

### Option B — npm (after publish)

When the release workflow has published to npm:

```bash
npm install -g caipe@1.0.0
# one-off:
npx caipe@1.0.0 -- doctor
```

Pin semver in scripts; avoid bare `npx caipe@latest` in production docs.

### Option C — Build from source

```bash
git clone https://github.com/cnoe-io/ai-platform-engineering.git
cd ai-platform-engineering/cli
bun install
npm run compile          # → dist/caipe (native binary on your machine)
./dist/caipe --version
```

Dev loop without compile:

```bash
npm run dev -- chat
node bin/caipe.cjs --version   # uses dist/bundle.cjs after npm run build
```

---

## Configure

Settings: `~/.config/caipe/settings.json`.

```bash
caipe config set server.url https://your-caipe.example.com
caipe auth login
caipe chat
```

### Grid preview (split API vs IdP)

```bash
caipe config set server.url https://grid.preview.outshift.io
caipe config set auth.url https://idp.grid.preview.outshift.io/realms/caipe
rm -f ~/.config/caipe/agent-config.json
caipe auth login
```

| Variable | Purpose |
|----------|---------|
| `CAIPE_SERVER_URL` | BFF / API base URL |
| `CAIPE_AUTH_URL` | OAuth / discovery base URL |
| `CAIPE_IDP_HINT` | Keycloak `kc_idp_hint` |
| `CAIPE_DEFAULT_AGENT` | Default dynamic agent id |
| `CAIPE_TOKEN` | Bearer JWT (headless) |

### Chat-related config keys

```bash
caipe config set chat.default-agent '<agent-id>'
caipe config set chat.plain-markdown true
caipe config set chat.tool-approval prompt   # auto | prompt | deny
```

---

## Commands

| Command | Description |
|---------|-------------|
| `caipe` / `caipe chat` | Interactive Ink REPL |
| `caipe auth login \| logout \| status` | OAuth session |
| `caipe config set \| get \| unset` | Settings |
| `caipe agents list \| info` | Dynamic agents you can use |
| `caipe doctor` | Auth, health, and agent checks |
| `caipe init` | Create project/global `CLAUDE.md` template |
| `caipe sessions list \| resume <id>` | Saved chat sessions |
| `caipe mcp list \| connect <provider>` | OAuth connector helpers (via BFF) |
| `caipe diff` | Git diff summary in repo |
| `caipe local --prompt "…"` | Local Anthropic/LiteLLM + read/write/bash tools (`ANTHROPIC_API_KEY`) |
| `caipe skills …` | Catalog install/list |
| `caipe memory` | Edit memory files |
| `caipe commit` | DCO-aware commit helper |

**REPL:** `@file`, `@glob:pattern`, `/compact`, `/delegate <agent> <msg>`, `/agents`, `/sessions`.

**Headless:** `caipe chat --headless --prompt "…" --output text|json|ndjson`

---

## Releases

Maintainers cut CLI releases from the monorepo:

```bash
git tag -a caipe/v1.0.0 -m "caipe CLI 1.0.0"
git push origin caipe/v1.0.0
```

That triggers `.github/workflows/caipe-release.yml` (binaries, GitHub Release, npm when `NPM_TOKEN` is configured).

---

## Develop

```bash
cd cli
bun install
npm run lint
npm test
npm run build
```

---

## License

Apache-2.0

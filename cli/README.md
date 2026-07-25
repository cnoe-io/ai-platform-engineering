# CAIPE CLI

Terminal client for [CAIPE](https://github.com/cnoe-io/ai-platform-engineering). Canonical repo: [agent-chat-cli](https://github.com/cnoe-io/agent-chat-cli).

## TL;DR

```bash
cd cli && bun install && npm run compile
./dist/caipe config set server.url https://grid.preview.outshift.io
./dist/caipe config set auth.url https://idp.grid.preview.outshift.io/realms/caipe
./dist/caipe auth login
./dist/caipe agents list
./dist/caipe chat --agent '<id-from-list>'
```

Full docs: [agent-chat-cli README](https://github.com/cnoe-io/agent-chat-cli/blob/main/README.md).

---

- **Node.js 20+** (for `npx`, tests, and the Node bundle)
- **Bun 1.1+** (recommended for `npm run compile` and local dev)
- A reachable CAIPE deployment (API + OAuth)

Optional: **keytar** only if you set `auth.credential-storage` to `keychain`.

---

## Install

### Option A — Run from GitHub (no build)

```bash
npx github:cnoe-io/agent-chat-cli -- --version
```

Use `--` before CLI arguments:

```bash
npx github:cnoe-io/agent-chat-cli -- auth login
npx github:cnoe-io/agent-chat-cli -- chat
```

### Option B — One-line setup script

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/cnoe-io/agent-chat-cli/main/setup-caipe-cli.sh)
```

Preconfigure the server:

```bash
CAIPE_SERVER_URL=https://grid.preview.outshift.io \
  bash <(curl -fsSL https://raw.githubusercontent.com/cnoe-io/agent-chat-cli/main/setup-caipe-cli.sh)
```

### Option C — Released binary (when available)

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/agent-chat-cli/main/install.sh | sh
```

Requires a GitHub release tagged **`caipe/v*.*.*`**.

---

## Build from source

From this monorepo directory:

```bash
cd cli
bun install
npm run compile          # native binary → dist/caipe
./dist/caipe --version
```

Or clone the standalone repo (same commands at repo root):

```bash
git clone https://github.com/cnoe-io/agent-chat-cli.git
cd agent-chat-cli
bun install && npm run compile
```

### Other build targets

| Command | Output |
|--------|--------|
| `npm run dev -- chat` | Run via **tsx** (fast iteration) |
| `npm run build` | Node bundle `dist/bundle.cjs` |
| `node bin/caipe.cjs chat` | Launcher: binary → bundle → tsx |
| `npm run compile:all` | Cross-compile all platforms |

**Compile note:** Bun compile uses **`--external keytar`**. Default storage is **encrypted-file**; use `npm rebuild keytar` only for the keychain backend.

```bash
npm run lint
npm test
```

---

## Configure and sign in

Settings: **`~/.config/caipe/settings.json`**.

### Typical setup

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
| `CAIPE_SERVER_URL` | BFF base URL |
| `CAIPE_AUTH_URL` | OAuth / discovery base |
| `CAIPE_IDP_HINT` | Keycloak IdP alias |
| `CAIPE_TOKEN` | Bearer token (headless) |

---

## Use the CLI

```bash
caipe                      # interactive chat
caipe agents list
caipe chat --headless --prompt "Your question"
caipe auth status
```

See the [agent-chat-cli README](https://github.com/cnoe-io/agent-chat-cli/blob/main/README.md) for the full command table, headless examples, and troubleshooting.

---

## License

Apache-2.0

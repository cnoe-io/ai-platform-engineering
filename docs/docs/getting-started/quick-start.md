---
sidebar_position: 2
---

# Quick Start

## One-command setup

No clone required. Run this in your terminal and follow the interactive prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/setup-caipe.sh | bash
```

The script asks for your LLM provider, API key, and optional components (RAG, tracing, persistence). It creates a local KinD cluster or deploys to an existing one.

> **Want to inspect the script first?** View [`setup-caipe.sh`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/setup-caipe.sh) on GitHub before running.

<iframe src="https://asciinema.org/a/845278/iframe" width="100%" height="600" style={{border: 'none', borderRadius: '8px', overflow: 'hidden'}} scrolling="no" allowFullScreen />

> [View full screen recording on asciinema](https://asciinema.org/a/845278)

---

## Terminal CLI (optional)

Use the **CAIPE CLI** to chat with your deployment from the terminal (OAuth, dynamic agents, skills). Source lives in the monorepo [`cli/`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/cli) directory.

### Install

**Binary (recommended)** — from [GitHub Releases](https://github.com/cnoe-io/ai-platform-engineering/releases) (`caipe/v*.*.*`):

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh
```

**npm** (when published):

```bash
npm install -g caipe@1.0.0
```

**Build from source:**

```bash
git clone https://github.com/cnoe-io/ai-platform-engineering.git
cd ai-platform-engineering/cli && bun install && npm run compile
./dist/caipe --version
```

### Connect to your server

```bash
caipe config set server.url https://your-caipe-server.example.com
caipe auth login
caipe agents list
caipe chat --agent '<agent-id>'
```

**Grid preview** (API and IdP on different hosts):

```bash
caipe config set server.url https://grid.preview.outshift.io
caipe config set auth.url https://idp.grid.preview.outshift.io/realms/caipe
caipe auth login
```

Full command reference, headless mode, and troubleshooting: [**CAIPE CLI**](../integrations/cli.md).

---

## Other setup options

| Guide | Best for |
|-------|----------|
| [**Docker Compose**](docker-compose/setup.md) | Local development or a single VM (EC2, etc.) |
| [**Helm**](helm/setup.md) | Any Kubernetes cluster — EKS, GKE, AKS, KinD, and more |

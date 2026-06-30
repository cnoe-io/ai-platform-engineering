---
sidebar_position: 2
---

# 🚀 Quick Start

## One-command setup

No clone required. Run this in your terminal and follow the interactive prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/setup-caipe.sh | bash
```

The script asks for your LLM provider, API key, and optional components (RAG, tracing, persistence). It can create a local KinD cluster or deploy to an existing one.

> **Want to inspect the script first?** View it at [`setup-caipe.sh`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/setup-caipe.sh) before running.

<iframe src="https://asciinema.org/a/845278/iframe" width="100%" height="600" style={{border: 'none', borderRadius: '8px', overflow: 'hidden'}} scrolling="no" allowFullScreen />

> [View full screen recording on asciinema](https://asciinema.org/a/845278)

---

## Additional setup guides

| Guide | Use case |
|-------|----------|
| [**Docker Compose**](docker-compose/setup.md) | Local development or VM (EC2) with agent profiles |
| [**Helm**](helm/setup.md) | Any Kubernetes distribution (EKS, GKE, AKS, and more) |

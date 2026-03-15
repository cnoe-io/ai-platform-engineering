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

---

## Choose your setup path

| Path | Best for |
|------|----------|
| [**Docker Compose**](docker-compose/setup.md) | Local development, VM (EC2), agent profiles |
| [**KinD**](kind/setup.md) | Local Kubernetes, mirroring a production cluster |
| [**Helm**](helm/setup.md) | Any Kubernetes cluster (EKS, GKE, AKS, …) |
| [**IDP Builder**](idpbuilder/setup.md) | Full platform stack with Backstage, ArgoCD, Gitea |
| [**EKS**](eks/setup.md) | AWS production deployment |

<div style={{paddingBottom: '56.25%', position: 'relative', display: 'block', width: '100%'}}>
  <iframe src="https://app.vidcast.io/share/embed/40364232-f609-43d7-9578-07aef9c25893?mute=1&autoplay=1&disableCopyDropdown=1" width="100%" height="100%" title="CAIPE Getting Started with Docker Compose Demo" loading="lazy" allow="fullscreen *;autoplay *;" style={{position: 'absolute', top: 0, left: 0, border: 'solid', borderRadius: '12px'}}></iframe>
</div>

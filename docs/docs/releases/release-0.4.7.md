# Release Notes — ai-platform-engineering 0.4.7

> Released: 2026-05-05
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.7`
> Previous release: [0.4.6](release-0.4.6.md)

## Highlights

0.4.7 delivers a comprehensive end-to-end overhaul of the Skills platform and a new unsaved-changes guard in the dynamic agent editor. The Skills Workspace is redesigned with a standalone scanner microservice, multi-source hub support, install history, ZIP export, and AI Assist — resolving four pre-existing UX bugs rooted in architectural mismatches.

## What's New

### Skills Platform Overhaul
- **Unified Workspace** — skills from all hubs (GitHub, GitLab, local) are browsable in a single view
- **Standalone scanner microservice** — skill discovery is decoupled from the gateway for reliability and scalability
- **Installer rewrite** — more robust install flow with per-skill history tracking
- **Multi-source hubs** — configure multiple GitHub/GitLab skill sources under a single hub
- **ZIP export** — download skill bundles as ZIP archives
- **AI Assist** — generate or refine skill content with AI assistance ([#1327](https://github.com/cnoe-io/ai-platform-engineering/pull/1327))

### Dynamic Agent Editor
- **Unsaved-changes guard** — confirm dialog shown before navigating away from a dirty agent editor; guards back-button, tab switches, and top-level header links ([#1328](https://github.com/cnoe-io/ai-platform-engineering/pull/1328))

## Breaking Changes

No breaking changes. Drop-in upgrade from 0.4.6.

## Known Issues

None known beyond those noted in [0.4.0](release-0.4.0.md).

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.7 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.4.6 → 0.4.7](migration-0.4.6-to-0.4.7.md)

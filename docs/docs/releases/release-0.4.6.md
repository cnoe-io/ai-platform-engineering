# Release Notes — ai-platform-engineering 0.4.6

> Released: 2026-05-05
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.6`
> Previous release: [0.4.5](release-0.4.5.md)

## Highlights

0.4.6 significantly improves the `setup-caipe.sh` installer experience with Docker auto-detection, back-navigation, and upgrade-aware prompts. The dynamic agents runtime is simplified with a shared-client memory model, lazy provider loading, and a single-flight init pattern that prevents duplicate runtime startup. Several UI agent editor polish items round out the release.

## What's New

### Setup Installer UX
- **Auto-detect and install Docker** on Linux (apt/dnf) and macOS (Homebrew); detect when the user is not in the `docker` group and offer to add them
- **Back-navigation** — type `0`, `b`, or `back` at any wizard prompt to return to the previous step
- **Upgrade detection** — re-runs skip redundant prompts by detecting the existing deployment state; EKS node kubeconfig symlinks detected and offered a writable replacement ([#1336](https://github.com/cnoe-io/ai-platform-engineering/pull/1336))

### Dynamic Agents: Runtime Simplification
- **Shared clients and lazy provider loading** — `llm_clients` refactored; provider guard removed; uses `cnoe-agent-utils 0.4.0` lazy imports
- **Single-flight initialization** — prevents duplicate runtime init via a future-based lock
- **Reduced retry latency** — `Retry-After` reduced from 10s to 5s; runtime TTL reduced to 60s for faster cleanup ([multiple commits](https://github.com/cnoe-io/ai-platform-engineering/compare/0.4.5...0.4.6))

## Bug Fixes

- **ui**: sync agents tab selection to URL `?tab=` param — tabs are now linkable and bookmarkable; include agent name in editor card title ([#1325](https://github.com/cnoe-io/ai-platform-engineering/pull/1325))

## Breaking Changes

No breaking changes. Drop-in upgrade from 0.4.5.

## Known Issues

None known beyond those noted in [0.4.0](release-0.4.0.md).

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.6 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.4.5 → 0.4.6](migration-0.4.5-to-0.4.6.md)

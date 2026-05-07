# Release Notes — ai-platform-engineering 0.4.1

> Released: 2026-04-24
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.1`
> Previous release: [0.4.0](release-0.4.0.md)

## Highlights

0.4.1 is a targeted hotfix addressing the Skills API Gateway install experience. Skills catalog XML comment markers were leaking into API responses, breaking agent recognition of skill metadata; per-hub recrawl was missing a manual trigger; and several layout and history UX issues were fixed.

## Bug Fixes

- **gateway**: strip `<!-- caipe-skill: ... -->` XML comments from catalog skill content in API responses; add `POST /api/skill-hubs/[id]/refresh` to force-recrawl a hub bypassing the 5-min cache; fix per-hub Recrawl button, install history, and layout issues ([#1283](https://github.com/cnoe-io/ai-platform-engineering/pull/1283))

## Breaking Changes

No breaking changes. Drop-in upgrade from 0.4.0.

## Known Issues

None known beyond those noted in [0.4.0](release-0.4.0.md).

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.1 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.4.0 → 0.4.1](migration-0.4.0-to-0.4.1.md)

# Release Notes — ai-platform-engineering 0.4.2

> Released: 2026-04-27
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.2`
> Previous release: [0.4.1](release-0.4.1.md)

## Highlights

0.4.2 fixes a critical `caipe-skills.py` bootstrap issue that caused the Skills API Gateway helper file to always serve an error stub, and cleans up the gateway UI. The CI/CD pipeline gains an automatic PR labeler and several robustness fixes.

## Bug Fixes

- **skills**: fix `caipe-skills.py` 404 — file was missing from the `skills-bootstrap` ConfigMap so the helper stub was always served; add auth fallback; simplify gateway UI ([#1286](https://github.com/cnoe-io/ai-platform-engineering/pull/1286))
- **docs**: escape bare `<` in `plan.md` to fix MDX build error ([#1285](https://github.com/cnoe-io/ai-platform-engineering/pull/1285))

## Breaking Changes

No breaking changes. Drop-in upgrade from 0.4.1.

## Known Issues

None known beyond those noted in [0.4.0](release-0.4.0.md).

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.2 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.4.1 → 0.4.2](migration-0.4.1-to-0.4.2.md)

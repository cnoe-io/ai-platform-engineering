# Release Notes — ai-platform-engineering 0.4.5

> Released: 2026-04-29
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.5`
> Previous release: [0.4.4](release-0.4.4.md)

## Highlights

0.4.5 is a focused bug-fix release. The most impactful change is a DocumentDB/CosmosDB compatibility fix that removes `$facet` aggregation from conversation list and audit log routes — operators running CAIPE against Amazon DocumentDB or Azure CosmosDB will see these admin views work correctly for the first time. RAG server JavaScript rendering is also repaired on x86_64.

## Bug Fixes

- **rag-server**: install `chromium_headless_shell` in `Dockerfile.ingestors` (x86_64); add init container chart support — fixes JS rendering failures introduced in the 0.4.4 image ([#1320](https://github.com/cnoe-io/ai-platform-engineering/pull/1320))
- **ui**: remove `$facet` aggregation from conversations and audit log APIs for CosmosDB/DocumentDB compatibility; add `client_type=webui` default filter so Slack conversations no longer appear in web UI sidebar ([#1321](https://github.com/cnoe-io/ai-platform-engineering/pull/1321))
- **ui**: fix dynamic agent chat `/skills` slash command not loading hub-sourced skills — now uses the unified `/api/skills` catalog endpoint ([#1314](https://github.com/cnoe-io/ai-platform-engineering/pull/1314))
- **slack-bot**: fix only the first matched agent firing for a mention; wire `overthink_config` so agents with `overthink: enabled: true` correctly gate on `@mentions` ([#1315](https://github.com/cnoe-io/ai-platform-engineering/pull/1315))
- **docs**: fix broken link in 0.3.x-to-0.4.0 migration guide ([#1316](https://github.com/cnoe-io/ai-platform-engineering/pull/1316))

## Breaking Changes

No breaking changes. Drop-in upgrade from 0.4.4.

## Known Issues

None known beyond those noted in [0.4.0](release-0.4.0.md).

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.5 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.4.4 → 0.4.5](migration-0.4.4-to-0.4.5.md)

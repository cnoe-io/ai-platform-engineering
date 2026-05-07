# Release Notes — ai-platform-engineering 0.4.3

> Released: 2026-04-27
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.3`
> Previous release: [0.4.2](release-0.4.2.md)

## Highlights

0.4.3 completes the 0.4.0 Slack bot config migration by shipping the flat `agents` list schema, and adds integrations documentation for the Backstage plugin, Webex bot, and CAIPE CLI. A macOS bash 3.2 compatibility fix prevents setup script failures on stock macOS terminals.

## What's New

### Documentation
- **Integrations docs**: add Backstage plugin, Webex bot, and CAIPE CLI setup guides ([#1297](https://github.com/cnoe-io/ai-platform-engineering/pull/1297))

## Bug Fixes

- **setup**: guard empty-array expansions (`${arr[@]}`) for bash 3.2 compatibility — prevents `unbound variable` errors on macOS when no kind clusters or kubectl contexts exist ([#1304](https://github.com/cnoe-io/ai-platform-engineering/pull/1304))
- **docs**: responsive iframe for demo video; fix sidebar links ([#1292](https://github.com/cnoe-io/ai-platform-engineering/pull/1292))

## Breaking Changes

> ⚠️ The Slack bot `botConfig` channel schema has changed.

The `qanda` / `ai_alerts` / `ai_enabled` keys are replaced by a flat `agents` list. If you are upgrading directly from 0.3.x, see the [0.3.x → 0.4.0 Migration Guide](migration-0.3.x-to-0.4.0.md#botconfig-restructured-to-flat-agents-list) for the full before/after YAML.

If you already migrated your `botConfig` as part of the 0.4.0 upgrade, no further action is required. ([#1288](https://github.com/cnoe-io/ai-platform-engineering/pull/1288))

## Known Issues

None known beyond those noted in [0.4.0](release-0.4.0.md).

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.3 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.4.2 → 0.4.3](migration-0.4.2-to-0.4.3.md)

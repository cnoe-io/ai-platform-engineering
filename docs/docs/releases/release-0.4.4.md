# Release Notes — ai-platform-engineering 0.4.4

> Released: 2026-04-28
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.4`
> Previous release: [0.4.3](release-0.4.3.md)

## Highlights

0.4.4 brings Skills Builder integration to dynamic agents — agents can now leverage user-authored skills from the `agent_skills` MongoDB collection at runtime. Several subagent stability bugs are fixed and the agent editor UI receives a polish pass. A migration script fix prevents data errors when running the 0.4.0 data migration against real DocumentDB data.

## What's New

### Dynamic Agents: Skills Integration
- **Skills integration** — dynamic agents can now use skills authored in the Skills Builder; at runtime the backend loads selected skills, converts them to SKILL.md files, and injects them into the agent's system context
- **Agent editor UX** — subagent fixes and UI polish for the agent configuration editor ([#1299](https://github.com/cnoe-io/ai-platform-engineering/pull/1299))

## Bug Fixes

- **migration**: fix `migrate_messages_to_turns.py` to handle stringified `repr()` artifact dicts (affecting 29k+ artifact-type events in dev DocumentDB) and add passthrough for unknown event types ([#1306](https://github.com/cnoe-io/ai-platform-engineering/pull/1306))

## Breaking Changes

No breaking changes. Drop-in upgrade from 0.4.3.

## Known Issues

None known beyond those noted in [0.4.0](release-0.4.0.md).

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.4 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.4.3 → 0.4.4](migration-0.4.3-to-0.4.4.md)

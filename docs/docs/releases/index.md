---
sidebar_position: 1
---

# Releases

Release notes and migration guides for CAIPE (Community AI Platform Engineering).

## 0.4.x Series

| Version | Date | Highlights |
|---------|------|-----------|
| [0.4.8](release-0.4.8.md) | 2026-05-06 | AWS MCP server, supervisor call limits, PSS Baseline Helm security |
| [0.4.7](release-0.4.7.md) | 2026-05-05 | Skills platform overhaul, agent editor unsaved-changes guard |
| [0.4.6](release-0.4.6.md) | 2026-05-05 | Setup installer UX, dynamic agents runtime simplification |
| [0.4.5](release-0.4.5.md) | 2026-04-29 | DocumentDB/CosmosDB compatibility, RAG server JS rendering fix |
| [0.4.4](release-0.4.4.md) | 2026-04-28 | Dynamic agents skills integration, migration script fix |
| [0.4.3](release-0.4.3.md) | 2026-04-27 | Slack bot botConfig schema, integrations docs |
| [0.4.2](release-0.4.2.md) | 2026-04-27 | Skills bootstrap fix, CI improvements |
| [0.4.1](release-0.4.1.md) | 2026-04-24 | Skills gateway UX hotfix |
| [0.4.0](release-0.4.0.md) | 2026-04-23 | **Major**: AG-UI protocol, Next.js gateway, shared conversation API |

## Migration Guides

| From → To | Key Changes |
|-----------|------------|
| [0.4.7 → 0.4.8](migration-0.4.7-to-0.4.8.md) | No values changes; optional call-limit env vars |
| [0.4.6 → 0.4.7](migration-0.4.6-to-0.4.7.md) | No values changes |
| [0.4.5 → 0.4.6](migration-0.4.5-to-0.4.6.md) | No values changes |
| [0.4.4 → 0.4.5](migration-0.4.4-to-0.4.5.md) | No values changes |
| [0.4.3 → 0.4.4](migration-0.4.3-to-0.4.4.md) | No values changes; run 0.4.0 migration script fix if needed |
| [0.4.2 → 0.4.3](migration-0.4.2-to-0.4.3.md) | **Breaking**: Slack bot `botConfig` schema change |
| [0.4.1 → 0.4.2](migration-0.4.1-to-0.4.2.md) | No values changes |
| [0.4.0 → 0.4.1](migration-0.4.0-to-0.4.1.md) | No values changes |
| [0.3.x → 0.4.0](migration-0.3.x-to-0.4.0.md) | **Major breaking**: Helm restructure + MongoDB data migrations |
| [0.2.41 → 0.3.2](migration-0.2.41-to-0.3.2.md) | See guide |

---
title: Skills
description: Browse, create, scan, and install reusable CAIPE skills.
---

# Skills

A skill is a focused, reusable set of instructions stored in `SKILL.md`.
Skills can guide Dynamic Agents in CAIPE or be installed into supported coding
agents through the Skills Gateway.

![Skills gallery and catalog controls](/img/features/skills.svg)

## Skills Surfaces

| Surface | Purpose |
|---|---|
| Gallery | Discover available built-in, hub, and user-authored skills |
| Editor and workspace | Create or revise a skill and its supporting files |
| Scan history | Review scanner results and safety status |
| Gateway | Create catalog API keys and install or update local skills |

## Common Actions

- Create a skill from the UI
- Import a skill archive or supported repository source
- Clone a read-only built-in skill before changing it
- Review revisions and restore an earlier revision
- Run an individual scan or request a catalog scan
- Attach an approved skill to a Dynamic Agent
- Export a skill for use elsewhere

Skill actions depend on ownership, sharing, scanner policy, and whether
built-in mutation has been enabled. CAIPE keeps built-in catalog entries
read-only by default.

## Scan Results

A scan can identify prompt injection, unsafe tool guidance, or other policy
findings. The deployment's scan gate determines whether findings are
informational or prevent a skill from entering the runtime catalog.

A clean scan is not a guarantee of safety. Review the skill instructions,
files, requested tools, and source before attaching it to an agent.

## Related Documentation

- [Skills feature overview](../features/skills/README.md)
- [Create a Skill](../repo-ops/skills/create-skill.md)

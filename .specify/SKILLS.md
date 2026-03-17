# Skills

## What Is a Skill?

A **skill** is a reusable, versioned set of instructions that can be shared among AI agents. Skills encode:

- **Workflows**: How to perform a specific set of steps to achieve a goal (e.g., create a spec, run tests)
- **Tool integrations**: How to use a specific MCP server or external tool
- **Best practices**: Organizational standards for languages, frameworks, or processes

Skills are the mechanism by which institutional knowledge is made persistent and agent-accessible without repeating it in every prompt.

## Skills vs. Specs

| | Skills | Specs |
|---|--------|-------|
| **Scope** | Reusable across projects | Project/feature specific |
| **Content** | Procedures, best practices, tool usage | Architecture, requirements, design decisions |
| **Location** | `.cursor/commands/`, `.claude/commands/`, etc. | `specs/<###>/` |
| **Audience** | All agents across all projects | Agents working on this project/feature |
| **Overridable** | Yes, by specs | Authoritative for the feature |

## Skills Standard

All skills in this repository implement the [agentskills.io specification](https://agentskills.io/specification). Key requirements:

- Skills are Markdown files with optional YAML frontmatter
- Frontmatter may declare `description`, `handoffs`, and `scripts`
- Scripts bundled with skills must be auditable and version-pinned
- Skills are idempotent where possible

## Built-in Spec-Kit Skills

The following skills are provided by the spec-kit integration:

| Skill | Command | Description |
|-------|---------|-------------|
| Specify | `/speckit.specify` | Create/update a feature spec from natural language |
| Plan | `/speckit.plan` | Generate an implementation plan from a spec |
| Tasks | `/speckit.tasks` | Generate an executable task list from a plan |
| Implement | `/speckit.implement` | Execute tasks from tasks.md |
| Constitution | `/speckit.constitution` | Create/update the project constitution |

### How agent command files are generated

Skills are authored **once** in `.specify/templates/commands/*.md` and manually copied to each supported AI tool's directory:

| Agent | Generated at | Format |
|-------|-------------|--------|
| Cursor | `.cursor/commands/` | Markdown |
| Claude Code | `.claude/commands/` | Markdown |

**Never edit the generated agent directories directly.** Edit `.specify/templates/commands/` and copy to agent directories.

## CAIPE-Specific Skills

| Skill | Location | Description |
|-------|----------|-------------|
| Python Rules | `.cursor/rules/` | Ruff, Black, type hints, Google-style docstrings |
| TypeScript Rules | `ui/.cursor/rules/` | ESLint, Prettier, React 19 patterns |

## Sourcing Public Skills

Public skills are available from community registries. Before adopting any public skill:

1. **Review the skill source** — read every line including bundled scripts
2. **Check for version pinning** — skills referencing external resources must pin versions
3. **Security scan** — run the skill through a security scanner for embedded scripts/binaries
4. **Log adoption** — add the skill to the inventory table below with source and version

| Skill | Source | Version | Adopted | Notes |
|-------|--------|---------|---------|-------|
| speckit.* | [github/spec-kit](https://github.com/github/spec-kit) | main@2026-03 | 2026-03-16 | Core SDD workflow |

## Adding a New Skill

1. Create the skill file in `.specify/templates/commands/<skill-name>.md`
2. Copy to `.cursor/commands/speckit.<skill-name>.md` (adjust format as needed)
3. Add frontmatter with `description` and any `handoffs`
4. If the skill bundles a script, place it in `scripts/bash/` or `.specify/scripts/`
5. Add the skill to the inventory table above
6. Update this document if the skill establishes a new pattern

## Skills and Agent Autonomy

Well-written skills are a prerequisite for high agent autonomy. At Level 6+ autonomy:

- Agents load skills on demand based on the task context
- Skills replace per-session instructions from engineers
- The quality of skills directly determines the quality of autonomous output

Invest time in skill quality. A well-crafted skill is institutional knowledge that compounds over time.

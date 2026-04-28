# CAIPE Spec Kit

This directory contains the [Spec Kit](https://github.com/github/spec-kit) configuration for AI Platform Engineering (CAIPE), following the [Spec-Driven Development](https://github.com/github/spec-kit/blob/main/spec-driven.md) methodology.

## Structure

```
.specify/
├── memory/
│   └── constitution.md        # Governing principles
├── ARCHITECTURE.md            # High-level architecture
├── TESTING.md                 # Quality gates and test strategy
├── SKILLS.md                  # Skills inventory and conventions
├── SPECS.md                   # Specs and plans conventions
├── CHANGELOG.md               # Version history
├── templates/
│   ├── agent-file-template.md
│   ├── constitution-template.md
│   ├── spec-template.md
│   ├── plan-template.md
│   ├── tasks-template.md
│   └── checklist-template.md
└── scripts/
    └── bash/                  # Automation scripts
        ├── check-prerequisites.sh
        ├── create-new-feature.sh
        ├── setup-plan.sh
        └── update-agent-context.sh
```

Slash commands are installed by `specify init` directly into agent-specific directories:
- `.cursor/commands/speckit.*.md` (Cursor)
- `.claude/commands/speckit.*.md` (Claude Code)

## Living Documentation

AI agents are expected to read this directory at the start of every session to load project context:

| File | Purpose |
|------|---------|
| [memory/constitution.md](./memory/constitution.md) | Governing principles for development |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | High-level architecture and key design decisions |
| [TESTING.md](./TESTING.md) | Quality gates and test strategy |
| [SKILLS.md](./SKILLS.md) | Skills inventory, conventions, and sourcing guidelines |
| [SPECS.md](./SPECS.md) | Specs and plans conventions |

## Spec-Driven Workflow

```
/speckit.specify <description>   → docs/docs/specs/<###>/spec.md
/speckit.plan <tech choices>     → docs/docs/specs/<###>/plan.md + research + contracts
/speckit.tasks                   → docs/docs/specs/<###>/tasks.md
/speckit.implement               → source code + tests
```

1. **Specify**: Create a feature spec from natural language
2. **Clarify** *(optional)*: Ask structured questions to de-risk ambiguous areas
3. **Plan**: Generate an implementation plan with constitution checks
4. **Tasks**: Generate a dependency-ordered, parallelizable task list
5. **Analyze** *(optional)*: Cross-artifact consistency check
6. **Implement**: Execute tasks phase by phase

## Commands

| Command | Description |
|---------|-------------|
| `/speckit.constitution` | Create/amend constitution |
| `/speckit.specify` | Create/update a feature spec |
| `/speckit.clarify` | Structured clarification questions |
| `/speckit.plan` | Generate implementation plan |
| `/speckit.tasks` | Generate task list |
| `/speckit.analyze` | Cross-artifact consistency analysis |
| `/speckit.checklist` | Generate quality checklists |
| `/speckit.implement` | Execute tasks |
| `/speckit.taskstoissues` | Convert tasks to GitHub Issues |

## Related

- **Published Specs & ADRs**: `docs/docs/specs/` (auto-published via Docusaurus)
- **UI Spec Kit**: `ui/.specify/`

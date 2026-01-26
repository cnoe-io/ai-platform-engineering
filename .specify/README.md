# CAIPE Spec Kit

This directory contains the [Spec Kit](https://github.com/github/spec-kit) configuration for AI Platform Engineering (CAIPE).

## Structure

```
.specify/
├── memory/
│   └── constitution.md    # Project principles and standards
├── specs/                  # Feature specifications
├── templates/              # Spec templates
└── scripts/                # Automation scripts
```

## Usage

### Creating a New Spec

1. Create a new file in `.specify/specs/` with a descriptive name
2. Use the template from `.specify/templates/spec.md`
3. Define acceptance criteria and implementation plan
4. Update the spec as implementation progresses

### Spec Categories

- **Agent Specs**: New agent implementations or enhancements
- **MCP Specs**: MCP server features and tool additions
- **Multi-Agent Specs**: Orchestration and coordination patterns
- **UI Specs**: CAIPE UI features (also see `ui/.specify/`)
- **Integration Specs**: Cross-cutting concerns and integrations

## Related

- **ADRs**: Architecture Decision Records in `docs/docs/changes/`
- **UI Spec Kit**: UI-specific specs in `ui/.specify/`
- **Docs**: Full documentation at `docs/`

## Principles

See [constitution.md](memory/constitution.md) for project principles and development standards.

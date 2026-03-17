# Specifications

All design documentation for AI Platform Engineering (CAIPE) lives here — feature specifications, implementation plans, and architecture decision records (ADRs).

## Structure

| Directory | Contents | Naming Convention |
|-----------|----------|-------------------|
| `<###-feature-name>/` | Feature specs, plans, tasks, contracts | Sequentially numbered (`001`, `002`, ...) |
| `changes/` | Architecture Decision Records (ADRs) | Date-prefixed (`YYYY-MM-DD-<slug>.md`) |

## Spec-Kit Workflow

New feature specs are created using the spec-kit commands:

```bash
/speckit.specify <description>   # → docs/docs/specs/<###>/spec.md
/speckit.plan <tech choices>     # → docs/docs/specs/<###>/plan.md
/speckit.tasks                   # → docs/docs/specs/<###>/tasks.md
/speckit.implement               # Execute tasks against the plan
```

## Spec Directory Layout

Each numbered spec directory can contain:

```text
docs/docs/specs/<###-feature-name>/
├── spec.md          # Feature specification (PRD)
├── plan.md          # Implementation plan
├── tasks.md         # Executable, dependency-ordered task list
├── research.md      # Technical research (library choices, benchmarks)
├── data-model.md    # Entity and schema definitions
├── contracts/       # API contracts, event schemas
└── quickstart.md    # Key validation scenarios
```

## Adding a New Spec

1. Run `/speckit.specify <description>` — automatically assigns the next number
2. Fill in the spec template with overview, user stories, acceptance criteria
3. Run `/speckit.plan` to create the implementation plan
4. Run `/speckit.tasks` to create the task breakdown

## Adding a Change Record (ADR)

1. Create a file in `changes/`: `YYYY-MM-DD-short-descriptive-name.md`
2. Start with a level-one heading: `# Title of the change`
3. New files appear automatically in the sidebar

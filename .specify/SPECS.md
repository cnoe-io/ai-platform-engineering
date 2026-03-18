# Specs and Plans

## What Is a Spec?

A **spec** (specification) is a project-specific document describing the design of a feature or the project as a whole. Specs:

- Cover high-level decisions and architecture to set boundaries for implementing agents
- Define acceptance criteria that become automated tests
- Are the **source of truth** — code is regenerated from specs, not the other way around
- May rely on skills to provide best practices, but may override skills explicitly

## What Is a Plan?

A **plan** is the technical translation of a spec into actionable implementation steps. Plans:

- Are derived from specs by the `/speckit.plan` command
- Document technology choices with rationale
- Trace every architectural decision back to a specific spec requirement
- Include data models, API contracts, and test scenarios

## Spec Lifecycle

```text
idea → spec.md → plan.md → tasks.md → implementation → production
         │           │           │
      /speckit    /speckit    /speckit
      .specify     .plan       .tasks
```

## Directory Structure

All specs live under `docs/docs/specs/` so they are automatically published to the Docusaurus documentation site. The `.specify/specs` symlink points here for spec-kit compatibility.

```text
docs/docs/specs/
├── index.md                     # Overview page
├── _category_.json              # Docusaurus sidebar config
└── <###-feature-name>/          # e.g., 092-user-auth
    ├── spec.md                  # The feature specification (PRD)
    ├── plan.md                  # Implementation plan
    ├── research.md              # Technical research (library choices, benchmarks)
    ├── data-model.md            # Entity and schema definitions
    ├── contracts/               # API contracts, event schemas
    │   ├── rest-api.md
    │   └── events.md
    ├── quickstart.md            # Key validation scenarios
    └── tasks.md                 # Executable, dependency-ordered task list
```

## Spec Numbering

Specs are numbered sequentially: `001`, `002`, `003`, ...

The `/speckit.specify` command automatically determines the next number by scanning existing specs.

## Spec Content Requirements

A complete `spec.md` must include:

- **Overview**: What the feature does and why it exists
- **User Stories**: As a `<role>`, I want `<goal>` so that `<benefit>`
- **Acceptance Criteria**: Testable, unambiguous conditions for "done"
- **Non-Functional Requirements**: Performance, security, scalability constraints
- **Out of Scope**: Explicitly what this spec does NOT cover

Specs must NOT include:

- Implementation details (no tech stack, no code structure)
- `[NEEDS CLARIFICATION]` markers in a ratified spec

## Plan Content Requirements

A complete `plan.md` must include:

- **Technical Context**: Language, framework, storage, testing tools
- **Constitution Check**: Verification against `.specify/memory/constitution.md`
- **Project Structure**: Directory layout for source and tests
- **Implementation Phases**: Ordered phases with deliverables per phase
- **Rationale**: Why each technology choice was made

## Task Format

`tasks.md` uses the following conventions:

- Tasks are ordered by dependency (prerequisites first)
- Independent tasks are marked `[P]` for parallelization
- Each task references the spec acceptance criterion it satisfies
- Tasks have clear, verifiable done criteria

## Living Documentation (.specify/)

High-level, cross-cutting plans that span features or the entire project are stored in `.specify/`:

- `memory/constitution.md` — governing principles
- `ARCHITECTURE.md` — system architecture
- `TESTING.md` — quality gates
- `SKILLS.md` — skills inventory
- `SPECS.md` — this document

Feature-specific specs always go in `docs/docs/specs/<###-feature-name>/`.

## Agents and Specs

Agents are expected to:

1. Read `.specify/memory/constitution.md` before any implementation
2. Read `.specify/ARCHITECTURE.md` to understand system context
3. Create/update specs before generating code
4. Verify their output against spec acceptance criteria before marking tasks done
5. Update `.specify/ARCHITECTURE.md` when they introduce new architectural patterns

Agents must never:

- Skip spec creation and write code directly
- Mark a task done when its acceptance criteria are not met
- Contradict a ratified spec without an explicit amendment

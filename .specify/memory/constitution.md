# AI Platform Engineering (CAIPE) Constitution

## Core Principles

### I. Specifications as the Source of Truth

All development begins with a specification. Code serves the specification — not the other way around. The `.specify/` directory is the canonical source of intent, architecture, and design. Agents may generate and evolve code freely; they must not contradict a ratified specification without an amendment.

- Every feature starts as a specification in `docs/docs/specs/<###-feature-name>/spec.md`
- PRD-level decisions are captured in `.specify/` and reviewed by engineers
- Code is regenerated from specifications; outdated code is replaced, not patched

### II. Agent-First Architecture

AI agents are first-class contributors. CAIPE is itself a multi-agent system, and its development workflows are designed to minimize unnecessary human intervention in mechanical code production while preserving human judgment for architecture, ethics, and business logic.

- Each domain (ArgoCD, AWS, Jira, Splunk, PagerDuty, etc.) has a dedicated agent with specialized knowledge
- The Supervisor agent orchestrates multi-agent collaboration via the A2A protocol
- New repos are initialized with AI tool configurations (`.claude/`, `.cursor/`, `.codex/`)
- Skills, rules, and prompts encode institutional knowledge so agents operate autonomously
- Plans are stored in `.specify/` and tracked for active agent execution
- Background agents are expected to complete work units without per-step guidance

### III. MCP Server Pattern

Each agent exposes its tools through a Model Context Protocol (MCP) server. MCP servers are the primary integration layer between agents and external systems.

- Each agent has an MCP server for tool access
- MCP servers provide paginated, memory-safe access to external systems
- Strict limits on response sizes to prevent OOM issues
- MCP interactions follow the [CoSAI MCP Security guidelines](https://www.coalitionforsafeai.org/): input validation, sandboxing, transport security, and human-in-the-loop for risky operations

### IV. LangGraph-Based Agents

All agents are built on LangGraph for stateful, graph-based execution. This ensures consistent patterns across the codebase and enables advanced workflows.

- Support for interrupts, checkpoints, and human-in-the-loop workflows
- TypedDict state management with clear node definitions
- Redis-backed checkpoint persistence for production deployments
- Agent graphs are testable in isolation with mocked dependencies

### V. A2A Protocol Compliance

All inter-agent communication follows Google's Agent-to-Agent (A2A) protocol. This ensures interoperability across agents and enables streaming, task lifecycle management, and artifact exchange.

- Support for streaming via SSE with artifact updates
- Task lifecycle: created → working → completed/failed/canceled
- Agent Cards describe capabilities and are discoverable by the Supervisor
- Multi-turn conversations with context preservation across agent boundaries

### VI. Skills over Ad-Hoc Prompts

Reusable, versioned skills replace one-off prompts. Skills encapsulate organizational best practices, tool integrations, and workflow patterns. They are the mechanism by which institutional knowledge is shared across projects.

- Skills MUST implement the [agentskills.io specification](https://agentskills.io/specification)
- Public skills from registries are security-scanned before adoption
- Project-specific skills live in `.cursor/commands/` (and equivalent per tool)
- Skills may bundle scripts and data; scripts must be auditable

### VII. Test-First Quality Gates (NON-NEGOTIABLE)

No production code ships without passing its defined quality gates. Tests are derived from specifications, not written after implementation.

- Acceptance criteria in specs become automated test scenarios
- `.specify/TESTING.md` defines the minimum quality gates for this repository
- Red-Green-Refactor cycle is enforced: tests fail first, then implementation follows
- CI must gate on all quality criteria defined in TESTING.md
- `make lint`, `make test`, and `make caipe-ui-tests` must all pass before any PR merges

### VIII. Structured Documentation

Every repository maintains a living `docs/` directory that agents and engineers both read and write. Documentation is not optional; it is the memory of the system.

- `.specify/ARCHITECTURE.md` — high-level architecture, always current
- `.specify/TESTING.md` — quality gates and test strategy
- `.specify/SKILLS.md` — skills inventory and usage guidelines
- `.specify/SPECS.md` — specs and plans conventions
- `docs/docs/specs/<###-feature>/` — per-feature specs, plans, tasks, ADRs (auto-published)

### IX. Security and Compliance by Default

Security is not a phase; it is a constraint woven into every specification and skill.

- Skills sourced externally are reviewed for supply chain risks before use
- No secrets in source; environment injection via approved mechanisms only
- Every skill that carries scripts is audited and version-pinned
- OWASP Top 10 mitigations are standard requirements in all web-facing specs
- MCP servers validate all inputs and enforce least privilege

### X. Simplicity and Avoiding Over-Engineering

Implement exactly what the specification requires — no more.

- [YAGNI](https://martinfowler.com/bliki/Yagni.html) — "You Aren't Gonna Need It" (Ron Jeffries, Extreme Programming) applies to both engineers and agents
- [Rule of Three](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming)) — tolerate duplication until the third occurrence, then refactor (Don Roberts, via Martin Fowler's *[Refactoring](https://martinfowler.com/books/refactoring.html)*, 1999)
- [Dead Code](https://martinfowler.com/bliki/DeadCode.html) is deleted, not commented out (Martin Fowler's *[Refactoring](https://martinfowler.com/books/refactoring.html)*) — version control is the safety net

## Development Workflow

### Branching and Commits

- Branch naming: **`prebuild/<type>/<description>`** where `<type>` matches the Conventional Commits verb
- [Conventional Commits](https://www.conventionalcommits.org/) required on all commits
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`
- Format: `<type>(<optional scope>): <description>`
- DCO sign-off required: `Signed-off-by: <Name> <email>`

**Examples**:

```
prebuild/feat/add-auth
prebuild/fix/null-pointer
prebuild/docs/update-architecture
prebuild/chore/spec-kit-constitution
```

### Prebuild CI Pipeline

The `prebuild/` branch prefix is **required** — it triggers the pre-release CI pipeline that builds Docker images and Helm charts for testing before merge.

**What happens when you push a `prebuild/` branch**:

1. **Pre-release Docker images** are built and pushed to `ghcr.io/<org>/prebuild/<image>` tagged with the PR number
2. **Pre-release Helm chart** versions are auto-bumped with an `-rc` suffix and published to the OCI registry
3. **CI workflows** (linting, unit tests) run on the PR but skip the production `[CI]` image builds (those only run on `main`)

| Trigger | What Builds | Image Registry | Tag Format |
|---------|------------|----------------|------------|
| PR from `prebuild/*` branch | Pre-release images | `ghcr.io/<org>/prebuild/<image>` | `pr-<number>-<sha>` |
| Push to `main` | Production images | `ghcr.io/<org>/<image>` | `latest`, `<sha>` |
| Git tag (`v*.*.*`) | Release images | `ghcr.io/<org>/<image>` | `<version>`, `stable` |

**Pre-release images built per PR** (only when relevant paths change):

| Image | Paths Triggering Build |
|-------|----------------------|
| `ai-platform-engineering` (supervisor) | `build/Dockerfile`, `ai_platform_engineering/multi_agents/**`, `pyproject.toml` |
| `ai-platform-engineering-a2a-sub-agent` | `build/Dockerfile.a2a-sub-agent`, `ai_platform_engineering/agents/**` |
| `ai-platform-engineering-mcp-agent` | `build/Dockerfile.mcp-agent`, `ai_platform_engineering/agents/**` |
| `ai-platform-engineering-dynamic-agents` | `build/Dockerfile.dynamic-agents`, `ai_platform_engineering/agents/**` |
| `caipe-ui` | `build/Dockerfile.caipe-ui`, `ui/**` |
| `ai-platform-engineering-slack-bot` | `build/Dockerfile.slack-bot`, `ai_platform_engineering/integrations/slack_bot/**` |
| `ai-platform-engineering-a2a-rag` | `ai_platform_engineering/knowledge_bases/rag/**` |

**Helm chart pre-release**: When chart files under `charts/` change on a `prebuild/` PR, the `helm-rc-version-bump` workflow auto-bumps chart versions with an `-rc.<pr>` suffix and the `helm-pre-release` workflow publishes the chart to the OCI registry.

**Always create `prebuild/` branches** — branches without this prefix will not produce testable images or charts.

### Spec-Driven Workflow

1. **Specify**: Run `/speckit.specify <description>` to create `docs/docs/specs/<###>/spec.md`
2. **Plan**: Run `/speckit.plan <tech choices>` to produce `docs/docs/specs/<###>/plan.md`
3. **Tasks**: Run `/speckit.tasks` to produce `docs/docs/specs/<###>/tasks.md`
4. **Implement**: Run `/speckit.implement` to execute tasks against the plan
5. **Review**: Engineer reviews generated code against spec acceptance criteria

### Bug Handling in Spec-Driven Development

Bugs are classified into three tiers based on their relationship to specifications. Agents and engineers must identify the correct tier before starting work.

| Tier | Name | Trigger | Spec Action | Branch | Workflow |
|------|------|---------|-------------|--------|----------|
| 1 | Spec violation | Code doesn't match its spec | None — spec is correct | `prebuild/fix/<description>` | Fix code, reference existing spec |
| 2 | Spec gap | Bug reveals uncovered edge case | Update existing spec | `prebuild/fix/<description>` | Amend spec, then fix code |
| 3 | Design flaw | Bug reveals architectural issue | New spec required | `prebuild/feat/<###-description>` | Full `/speckit.specify` pipeline |

**Tier 1 — Spec violation**: The spec already defines the correct behavior; the implementation is wrong. Create a `prebuild/fix/` branch, fix the code, and reference the existing spec's acceptance criteria. One commit: `fix(<scope>): <description>`.

**Tier 2 — Spec gap**: The bug exposes something the spec never considered (missing edge case, unhandled error). Update the existing `specs/<###>/spec.md` with new acceptance criteria, then fix the code. Two commits: `docs: add missing edge case to spec`, then `fix: handle edge case`.

**Tier 3 — Design flaw**: The bug reveals a systemic or architectural problem that requires rethinking. This goes through the full pipeline — run `/speckit.specify` to create a new spec, then plan, tasks, and implement.

### Agent Autonomy Levels

Based on [The 8 Levels of Agentic Engineering](https://www.bassimeledath.com/blog/levels-of-agentic-engineering) by Bassim Eledath and [Harness Engineering](https://openai.com/index/harness-engineering/) by OpenAI.

| Level | Name | Description | Human Role |
|-------|------|-------------|------------|
| 1 | Tab Complete | AI suggests next character inputs | Reviews every change |
| 2 | Agent IDE | User chats with AI assistant for changes | Reviews most changes |
| 3 | Context Engineering | Optimize prompts to AI coding tools | Reviews architecture |
| 4 | Compounding Engineering | Add update prompt feedback loop | Reviews outputs |
| 5 | MCP and Skills | Give coding tool access to live systems | Reviews incidents |
| 6 | Harness Engineering | Add live data to update feedback loop | Works on the system |
| 7 | Background Agents | Enable agents to get and complete work autonomously | Approves work units |

**Target**: CAIPE operates at Level 6. This constitution and its supporting docs enable that baseline.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Agents | Python 3.11+, LangGraph, LangChain |
| MCP Servers | FastMCP, httpx |
| Multi-Agent | A2A Protocol, SSE streaming |
| UI | Next.js 16, React 19, Tailwind CSS |
| Deployment | Docker, Kubernetes, Helm |
| Documentation | Docusaurus |
| Package Manager | uv (Python), npm (UI) |
| Linting | Ruff (Python), ESLint (TypeScript) |
| Testing | pytest (Python), Jest (UI) |

## Governance

This Constitution supersedes all other per-repo conventions unless explicitly overridden with documented rationale.

Amendments require:

1. A specification describing the change and its rationale
2. Review and approval via PR
3. Migration plan for existing agents and configurations

All PRs must verify constitutional compliance. Complexity violations must be justified in the PR description.

**Version**: 0.0.1 | **Ratified**: 2026-03-16 | **Last Amended**: 2026-03-16

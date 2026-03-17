# Testing and Quality Gates

## Philosophy

Tests are derived from specifications, not written after implementation. Every acceptance criterion in a `spec.md` becomes an automated test scenario. The `quickstart.md` in each feature spec captures the key validation scenarios that gate release.

Quality gates are enforced by CI and must pass before any PR merges.

## Quality Gate Definitions

### Gate 1: Specification Completeness (Pre-Implementation)

Before implementation begins, verify:

- [ ] `specs/<###>/spec.md` exists with no `[NEEDS CLARIFICATION]` markers
- [ ] All acceptance criteria are testable and unambiguous
- [ ] `specs/<###>/plan.md` exists and has passed constitutional review
- [ ] `specs/<###>/tasks.md` exists with dependency-ordered tasks

### Gate 2: Unit Tests

- **Coverage threshold**: ≥ 80% line coverage on new code
- **Scope**: All public functions and methods
- **Framework**:
  - Python: `pytest` with `pytest-cov`
  - TypeScript (UI): `jest` with `--coverage`
- **Location**: Tests mirror source structure

### Gate 3: Integration Tests

Required for:

- New agent implementations
- Changes to inter-agent (A2A) communication
- MCP server tool additions or modifications
- Shared schema modifications
- Any change touching `contracts/` in a spec

- **Framework**: `pytest` for backend; `jest` for UI
- **Location**: `integration/` for backend; `ui/tests/` for UI
- **Environment**: Must run in CI with mocked external dependencies

### Gate 4: Contract Tests

For any feature that defines API contracts (`specs/<###>/contracts/`):

- [ ] Contract tests exist that validate all endpoints/events defined in `contracts/`
- [ ] Contract tests run against the actual implementation (not just mocks)

### Gate 5: Linting and Static Analysis

- **Python**: `ruff` (formatting + linting)
- **TypeScript**: `eslint` + `prettier`
- Zero warnings policy on new code; existing warnings may be suppressed with justification

### Gate 6: Security Scanning

- No secrets detected in committed code
- Dependency vulnerability scan: `pip-audit` (Python), `npm audit` (UI)
- OWASP Top 10 review for web-facing features (manual or automated)
- MCP server inputs validated against injection attacks

### Gate 7: Quickstart Validation

From `specs/<###>/quickstart.md`:

- [ ] All key validation scenarios pass manually or via automated E2E tests
- [ ] Performance goals stated in `plan.md` are met (benchmarks run if applicable)

## Make Targets

All quality gates are accessible through `make`:

| Target | What It Runs |
|--------|-------------|
| `make lint` | Ruff linting (Python) |
| `make lint-fix` | Auto-fix linting issues |
| `make test` | All tests (supervisor + multi-agents + agents) |
| `make test-supervisor` | Supervisor tests only |
| `make test-multi-agents` | Multi-agent system tests |
| `make test-agents` | All agent MCP tests |
| `make caipe-ui-tests` | UI Jest tests |

## Test Organization

```text
tests/                              # Python backend tests
├── agents/                         # Per-agent unit tests
│   ├── test_argocd_agent.py
│   ├── test_aws_agent.py
│   └── ...
├── multi_agents/                   # Multi-agent orchestration tests
│   ├── test_supervisor.py
│   └── ...
└── utils/                          # Utility tests

integration/                        # Integration tests
├── a2a_client_integration_test.py
├── benchmark_persistence_backends.py
└── ...

ui/                                 # UI tests
└── __tests__/                      # Jest test files
```

## CI Pipeline Requirements

Every PR must run:

1. Linting (Gate 5)
2. Unit tests + coverage report (Gate 2)
3. Integration tests (Gate 3, where applicable)
4. Security scan (Gate 6)
5. Contract tests (Gate 4, where applicable)

Failed gates block merge. No exceptions without documented justification in the PR.

## Agentic Testing Considerations

When AI agents implement code:

- Agents are instructed to write tests before implementation (TDD)
- The Red-Green-Refactor cycle is enforced via the `/speckit.implement` command
- Agents must not mark tasks complete if tests are failing
- Coverage reports are fed back into the agent context for self-correction

## Definitions

| Term | Definition |
|------|-----------|
| **Unit test** | Tests a single function/method in isolation with mocked dependencies |
| **Integration test** | Tests multiple components together, with external services mocked at the network boundary |
| **Contract test** | Validates that an implementation conforms to the API/event contract defined in specs |
| **Quality gate** | A mandatory check that must pass before code progresses to the next stage |
| **Acceptance criterion** | A testable condition from a spec that defines "done" for a requirement |

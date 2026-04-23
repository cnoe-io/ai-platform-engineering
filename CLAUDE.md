# Claude Code Instructions

## Git Workflow

- Always work on a **new branch** -- never commit directly to `main`
- Branch naming convention: `prebuild/<short-description>`
  - e.g. `prebuild/fix-supervisor-streaming-json-and-orphaned-tool-calls`
- Push the branch and **create a PR using `gh pr create`** (see below)

## Commit Style -- Conventional Commits + DCO

Every commit must use [Conventional Commits](https://www.conventionalcommits.org/) format and include a **DCO sign-off** (`git commit -s`).

For AI-assisted commits, follow the [dco-ai-attribution](./skills/dco-ai-attribution/SKILL.md) skill:
- Default rule: AI must **never** add `Signed-off-by` — only the human author can certify the DCO
- Always append `Assisted-by: Claude:<model-version>` when code was materially AI-assisted
- See `AGENTS.md` for the canonical policy reference used by AI coding agents

### Explicit-authorization carve-out for this repository

For this repository (`ai-platform-engineering-feat-comprehensive-rbac`), the maintainer
**Sri Aradhyula `<sraradhy@cisco.com>`** has granted a session-scoped explicit
authorization for AI agents to run `git commit -s` on his behalf when (and only when)
he has stated so in the current chat session. Under that delegation:

- The agent uses Sri's configured git identity (`git config user.name` /
  `git config user.email`) — never a fictitious identity.
- The `Assisted-by: Claude:<model-version>` trailer is still mandatory.
- The delegation is recorded in the chat transcript (the message granting it).
- The carve-out is revocable mid-session; once revoked the agent reverts to
  the default rule.

See [skills/dco-ai-attribution/SKILL.md](./skills/dco-ai-attribution/SKILL.md) for the
full carve-out conditions and the alternate pre-commit checklist.

```
<type>(<scope>): <short description>

<body explaining why, not just what>

Signed-off-by: Your Name <your.email@example.com>
```

**Types**: `fix`, `feat`, `chore`, `docs`, `refactor`, `test`, `ci`

Use `git commit -s` to automatically append the DCO sign-off line based on your git config `user.name` and `user.email`.

## Creating PRs with gh CLI

Always use `gh pr create` with a conventional-commit title and structured body:

```bash
gh pr create \
  --title "fix(scope): short description under 70 chars" \
  --body "$(cat <<'EOF'
## Summary

- Bullet 1
- Bullet 2

## Test plan

- [ ] Item 1
- [ ] Item 2
EOF
)" \
  --base main
```

## Worktree Environment Setup

Git worktrees do **not** share the parent repo's `.venv`. After entering a worktree, set up a fresh virtual environment before running any Python commands:

```bash
uv venv --python python3.13 --clear .venv
uv sync
```

Subpackages with their own `pyproject.toml` (e.g. RAG ingestors, RAG server, MCP agents) need their own venv built from within their directory:

```bash
cd ai_platform_engineering/knowledge_bases/rag/ingestors   # or server, agents/*/mcp, etc.
uv venv --python python3.13 --clear .venv
uv sync
```

## Quality Gates

Before committing, always run:

```bash
make lint            # Ruff linting (Python)
make test            # All tests (supervisor + multi-agents + agents)
make caipe-ui-tests  # UI Jest tests
```

### Targeted test commands

```bash
make test-supervisor      # Supervisor/main workspace tests only
make test-multi-agents    # Multi-agent system tests
make test-agents          # All agent MCP tests
make lint-fix             # Auto-fix linting issues
```

### Running a specific test file or class

```bash
PYTHONPATH=. uv run pytest tests/<test_file>.py -v
PYTHONPATH=. uv run pytest tests/<test_file>.py::<TestClass> -v
```

## Container & Helm Security Standards

These standards apply to every new agent Dockerfile and every new Helm chart subchart.

### Dockerfiles

All agent and MCP server images should run as a non-root user at **UID 1001 / GID 1001**.

If a Dockerfile does not have a `USER` directive, `runAsNonRoot: true` in the Helm chart will cause the pod to fail at startup. Check `docker inspect <image> --format '{{.Config.User}}'` to confirm before setting that value in a chart.

## Reusable Skills

The `skills/` directory contains reusable tools organized by category:

- **dco-ai-attribution**: DCO compliance and AI attribution rules for AI-assisted commits (see [skills/dco-ai-attribution/SKILL.md](./skills/dco-ai-attribution/SKILL.md))
- **persistence**: Test LangGraph backends (Redis, PostgreSQL, MongoDB) and fact extraction
- **debugging**: (future) Debugging and troubleshooting tools
- **monitoring**: (future) Observability and metrics helpers
- **deployment**: (future) Deployment automation

### Quick Examples

```bash
# Test persistence backend
./skills/persistence/test_persistence_all_backends.sh redis

# Switch persistence backend
./skills/persistence/switch_backend.sh postgres

# Python-based testing
python skills/persistence/test_langgraph_persistence.py mongodb
```

See [skills/README.md](./skills/README.md) for full documentation.

## RBAC Living Documentation Rule

**Whenever you make any change to the RBAC system, you MUST update the canonical RBAC reference under `docs/docs/security/rbac/` in the same session.**

The RBAC reference is split into four focused files (plus an `index.md` landing page) so contributors don't have to scroll through one mega-doc. Pick the right file for the change and update it — when in doubt, also touch `index.md` if the change affects the big-picture summary.

(The legacy single-file doc at `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md` is now a redirect stub; do not edit it — edit the split files instead.)

| Change type | File to update | Section / table |
|-------------|----------------|-----------------|
| New role, scope, or permission | `architecture.md` | Component 1 (Keycloak) role/scope tables |
| New env var on any service | `architecture.md` | Env var table for that component |
| New middleware, gate, or auth layer | `architecture.md` (component) **and** `workflows.md` (flow diagram) | The relevant component section + sequence diagram |
| New service added to the stack | `architecture.md` (new Component section) **and** `index.md` (big-picture) | New Component N section + the architecture overview diagram |
| Auth flow change (Keycloak flows, OBO, token-exchange, broker login) | `workflows.md` | Update the affected sequence diagram and prose |
| New file added to the auth path | `file-map.md` | The File Map table |
| Keycloak `init-idp.sh` / realm-config behaviour change | `architecture.md` (Component 1) **and**, if it changes a flow, `workflows.md` |
| Dynamic Agents auth change | `architecture.md` (Component 5) |
| New test user, demo step, troubleshooting tip | `usage.md` | Test users / demo walkthrough / common questions |
| Spec 102 e2e port band, `make test-rbac-*`, or compose-profile change | `usage.md` (link to spec-102 quickstart) **and** `docs/docs/specs/102-comprehensive-rbac-tests-and-completion/quickstart.md` |
| Threat-model or trust-boundary change | `index.md` | Threat Model Considerations |

`docs/docs/security/rbac/file-map.md` must always reflect where every auth-relevant file lives. `scripts/validate-rbac-doc.py` (added in spec 102 Phase 10) is the CI guard for this.

## Active Technologies
- TypeScript (Next.js 16, React 19) + Zustand (state management), Next.js App Router (093-fix-audit-chat-active-preserve)
- MongoDB (server-side via API), Zustand store (client-side) (093-fix-audit-chat-active-preserve)
- Python 3.13 + FastMCP 3.2.3, Starlette (transitive via FastMCP), PyJWT, requests (101-mcp-auth-caller-key)
- N/A (middleware is stateless; JwksCache is in-process memory) (101-mcp-auth-caller-key)

## Recent Changes
- 093-fix-audit-chat-active-preserve: Added TypeScript (Next.js 16, React 19) + Zustand (state management), Next.js App Router

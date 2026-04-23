# Claude Code Instructions

## Git Workflow

- Always work on a **new branch** -- never commit directly to `main`
- Use **git worktree** to work in isolated branches (preferred over `git checkout -b`):
  ```bash
  # Claude Code: use EnterWorktree tool with the branch name
  # Manual equivalent (run from repo root):
  git worktree add ../ai-platform-engineering-<short-name> -b prebuild/<type>/<short-name>
  ```
  Worktrees live **sibling to the repo** at the cnoe level: `../ai-platform-engineering-<short-name>`
- Branch naming convention: `prebuild/<type>/<short-description>`
  - `<type>` matches the conventional commit type: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`
  - e.g. `prebuild/fix/supervisor-streaming-json-and-orphaned-tool-calls`
  - e.g. `prebuild/docs/enterprise-identity-federation`
  - e.g. `prebuild/feat/langgraph-redis-checkpoint-persistence`
- Push the branch and **create a PR using `gh pr create`** (see below)

## Commit Style -- Conventional Commits + DCO

Every commit must use [Conventional Commits](https://www.conventionalcommits.org/) format and include a **DCO sign-off** (`git commit -s`).

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

## Active Technologies
- TypeScript (Next.js 16, React 19) + Zustand (state management), Next.js App Router (093-fix-audit-chat-active-preserve)
- MongoDB (server-side via API), Zustand store (client-side) (093-fix-audit-chat-active-preserve)
- TypeScript 5.x, Bun 1.x + React 19, Ink 5 (TUI), Commander.js (CLI parsing), `@ag-ui/client` (AG-UI SSE streaming), keytar (OS keychain), marked-terminal (Markdown → ANSI), diff (unified diff), execa (git subprocess) (100-caipe-v1-core)
- Local filesystem only — `~/.config/caipe/` (global) + `.claude/` or `skills/` (per-project) (100-caipe-v1-core)
- TypeScript 5.x, Bun 1.x + React 19, Ink 5 (TUI), Commander.js (CLI parsing), `@ag-ui/client` (AG-UI SSE streaming), native `fetch` + `EventSource` (A2A SSE — no separate SDK needed), keytar (OS keychain), marked-terminal (Markdown → ANSI), diff (unified diff), execa (git subprocess) (100-caipe-v1-core)
- Local filesystem only — `~/.config/caipe/` (global) + `.claude/` or `skills/` (per-project); `settings.json` holds `server.url` and optional `auth.apiKey` (100-caipe-v1-core)

## Recent Changes
- 093-fix-audit-chat-active-preserve: Added TypeScript (Next.js 16, React 19) + Zustand (state management), Next.js App Router

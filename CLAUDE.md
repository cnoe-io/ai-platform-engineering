# Claude Code Instructions

## Git Workflow

- Always work on a **new branch** -- never commit directly to `main`
- Use **git worktree** to work in isolated branches (preferred over `git checkout -b`):
  ```bash
  # Claude Code: use EnterWorktree tool with the branch name
  # Manual equivalent:
  git worktree add .claude/worktrees/<branch> -b <branch>
  ```
- Branch naming convention: `prebuild/<type>/<short-description>`
  - `<type>` matches the conventional commit type: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`
  - e.g. `prebuild/fix/supervisor-streaming-json-and-orphaned-tool-calls`
  - e.g. `prebuild/docs/enterprise-identity-federation`
  - e.g. `prebuild/feat/langgraph-redis-checkpoint-persistence`
- Push the branch and **create a PR using `gh pr create`** (see below)

## Commit Style -- Conventional Commits + DCO

Every commit must use [Conventional Commits](https://www.conventionalcommits.org/) format and include a **DCO sign-off** (`git commit -s`):

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
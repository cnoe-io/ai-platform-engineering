# Agent Instructions

## Project Structure

```
ai_platform_engineering/   # Python backend
  agents/                  # Sub-agents (GitHub, ArgoCD, etc.)
  knowledge_bases/rag/     # RAG server, ingestors, graphrag, ontology
  mcp/                     # MCP (Model Context Protocol) integrations
  multi_agents/            # Multi-agent orchestration (supervisor, deepagent)
  utils/                   # Shared utilities
ui/                        # Next.js frontend
docs/                      # Documentation site (Docusaurus)
docker-compose/            # Docker configs for services
integration/               # Integration tests
scripts/                   # Utility scripts
charts/                    # Helm charts
```

Each component has its own environment variables - see `env.example` in `ui/` and READMEs in `ai_platform_engineering/knowledge_bases/rag/`.

## Documentation

- **Architecture & concepts** - Keep updated in `docs/`
- **Configuration & code details** - Document in component READMEs
- **Agent instructions** - Keep this file (`AGENTS.md`) up-to-date

## Git Guidelines

- **Sign off commits** - Use `git commit --signoff` (DCO requirement)
- **Conventional Commits** - Format: `type(scope): description`
  - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
  - Example: `feat(rag): add userinfo caching`

## Issue Tracking (bd)

This project uses **bd** (beads) for issue tracking.

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Quality Gates

Before committing code changes, run relevant checks:
- Python: `uv run ruff check`, `uv run pytest` (always use `uv run` to ensure virtual env)
- UI: `nvm use` first (if available), then `npm run lint`, `npm run build`

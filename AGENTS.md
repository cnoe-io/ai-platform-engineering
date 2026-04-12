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
- **Branch naming** - Use `prebuild/` prefix for CI to build Docker images
  - Example: `prebuild/feat/rag-batch-job-status`
- **PR descriptions** - Follow the template in `.github/pull_request_template.md`

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

## Code Style

- **Imports at top** - All imports must be at the top of the file, unless otherwise specified
- **Type hints required** - Python functions should have type hints for parameters and return values
- **Error handling** - Use specific exceptions, log errors with context, don't silently swallow exceptions

## Active Technologies
- TypeScript (Next.js 16, React 19) + Zustand (state management), Next.js App Router (093-fix-audit-chat-active-preserve)
- MongoDB (server-side via API), Zustand store (client-side) (093-fix-audit-chat-active-preserve)
- TypeScript 5.x, Bun 1.x + React 19, Ink 5 (TUI), Commander.js (CLI parsing), `@ag-ui/client` (AG-UI SSE streaming), keytar (OS keychain), marked-terminal (Markdown → ANSI), diff (unified diff), execa (git subprocess) (100-caipe-v1-core)
- Local filesystem only — `~/.config/caipe/` (global) + `.claude/` or `skills/` (per-project) (100-caipe-v1-core)
- TypeScript 5.x, Bun 1.x + React 19, Ink 5 (TUI), Commander.js (CLI parsing), `@ag-ui/client` (AG-UI SSE streaming), native `fetch` + `EventSource` (A2A SSE — no separate SDK needed), keytar (OS keychain), marked-terminal (Markdown → ANSI), diff (unified diff), execa (git subprocess) (100-caipe-v1-core)
- Local filesystem only — `~/.config/caipe/` (global) + `.claude/` or `skills/` (per-project); `settings.json` holds `server.url` and optional `auth.apiKey` (100-caipe-v1-core)

## Recent Changes
- 093-fix-audit-chat-active-preserve: Added TypeScript (Next.js 16, React 19) + Zustand (state management), Next.js App Router

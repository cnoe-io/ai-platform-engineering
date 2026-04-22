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

## DCO and AI Attribution Policy

**Skill**: [`skills/dco-ai-attribution/SKILL.md`](./skills/dco-ai-attribution/SKILL.md)

AI agents operating in this repository **must** follow these rules on every commit:

1. **Sign off every commit.** AI agents may add `Signed-off-by` on behalf of the configured git author (`user.name` / `user.email`) — typically by running `git commit -s`. The human submitter remains responsible for reviewing the commit before push.
2. **Always add an `Assisted-by` line** in the commit body when code was materially AI-assisted. Format (no colon directly after `Assisted-by` — GitHub's DCO check treats `Trailer-Name:` lines as signature trailers and will reject the commit):
   ```
   Assisted-by <tool> (model: <model-or-unknown>)
   ```
   Examples:
   ```
   Assisted-by claude (model: opus-4.7)
   Assisted-by cursor (model: unknown)
   Assisted-by gemini (model: 2.5-pro)
   Assisted-by codex (model: gpt-5)
   ```
   The agent fills in what it actually knows. If the runtime cannot determine the model identifier (most CLIs do not expose it as an env var), use `(model: unknown)` so the human author can correct it during review rather than guessing a stale model string.

Full pre-commit checklist and examples: [`skills/dco-ai-attribution/SKILL.md`](./skills/dco-ai-attribution/SKILL.md)

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
- Python 3.11+ (runtime is Python 3.13 in Docker) + Slack Bolt 1.27.0, Slack SDK 3.41.0, httpx (SSE streaming), Pydantic (config models), requests, loguru, PyYAML — no new dependencies (100-slack-agui-migration)
- MongoDB (LangGraph checkpointer on dynamic agents side; Slack bot is stateless beyond in-memory TTL caches) (100-slack-agui-migration)

## Recent Changes
- 093-fix-audit-chat-active-preserve: Added TypeScript (Next.js 16, React 19) + Zustand (state management), Next.js App Router

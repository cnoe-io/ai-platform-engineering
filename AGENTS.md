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

**Authority**: Linux kernel [AI Coding Assistants policy](https://github.com/torvalds/linux/blob/master/Documentation/process/coding-assistants.rst)

AI agents operating in this repository **must** follow these rules on every commit:

1. **Default rule — never generate `Signed-off-by`** — this is a human-only DCO certification. Do not add, suggest, or insert this trailer on behalf of the AI.
2. **Always suggest `Assisted-by`** when code was materially AI-assisted:
 ```
 Assisted-by: Claude:claude-opus-4-7
 ```
3. **Always remind the human** to add their own `Signed-off-by` before the commit is finalized.

### Explicit-authorization carve-out (this repo only)

The maintainer **Sri Aradhyula `<sraradhy@cisco.com>`** has granted a session-scoped
authorization for AI agents to invoke `git commit -s` on his behalf when (and only
when) he has explicitly stated so in the current chat session (e.g. "sign off as me",
"use `-s` on my behalf", "I delegate DCO sign-off for this session"). Under the
carve-out:

- The agent uses Sri's configured git identity — never a fictitious identity.
- `Assisted-by: Claude:<model-version>` is still required.
- The chat message granting the delegation is the audit record.
- The delegation is revocable at any time within the session.

Outside that explicit grant, rules 1–3 above apply unchanged. The agent must default
to the strict rule whenever the authorization is unclear.

## Git Guidelines

- **Sign off every commit** - Use `git commit -s` (DCO requirement).
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

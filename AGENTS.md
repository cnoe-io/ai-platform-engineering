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

## Docs & Spec Rules

- Reading is as hard as writing.
- Optimize for the next reader.
- Prefer bullets over paragraphs.
- Prefer diagrams over long explanations.
- No wall of text.
- Remove words that do not change decisions.

## DCO and AI Attribution Policy

**Authority**: Linux kernel [AI Coding Assistants policy](https://github.com/torvalds/linux/blob/master/Documentation/process/coding-assistants.rst)

AI agents operating in this repository **must** follow these rules on every commit:

1. **No AI sign-off** - `Signed-off-by` is a human DCO certification. AI agents must never invent, assume, or add this trailer on their own.
2. **Explicit human approval is required** - Before creating any commit with `Signed-off-by`, ask whether the human signs off that exact commit and receive an explicit yes in the current chat session.
3. **No approval means no signed commit** - If explicit sign-off approval is absent or unclear, do not create a signed-off commit. Tell the human that DCO will fail until a human sign-off is added.
4. **Use only the configured human identity after approval** - If the human explicitly signs off, use the current git identity. Never override it, invent an identity, or sign off as the AI.
5. **Always include or suggest `Assisted-by`** when code was materially AI-assisted:
 ```
 Assisted-by: <agent>:<model>
 ```
The chat message granting sign-off approval is the audit record.

## Git Guidelines

- **Sign off every commit after human approval** - Use `git commit -s` only after the human explicitly confirms DCO sign-off for that commit.
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
- TypeScript (Next.js, React) + Zustand (state management), Next.js App Router (093-fix-audit-chat-active-preserve)
- MongoDB (server-side via API), Zustand store (client-side) (093-fix-audit-chat-active-preserve)
- Python + Slack Bolt, Slack SDK, httpx (SSE streaming), Pydantic (config models), requests, loguru, PyYAML — no new dependencies (100-slack-agui-migration)
- MongoDB (LangGraph checkpointer on dynamic agents side; Slack bot is stateless beyond in-memory TTL caches) (100-slack-agui-migration)
- Service accounts: dynamic Keycloak confidential clients + OpenFGA `service_account` tuples + Mongo `service_accounts` collection; BFF (Next.js) orchestrates create/rotate/revoke/scope; caller-keyed tool authz added to the OpenFGA ext_authz bridge (2026-06-05-service-accounts)

# Agent Instructions

## Project Structure

```
ai_platform_engineering/   # Python backend
  agents/                  # Per-tool MCP servers (GitHub, ArgoCD, etc.)
  dynamic_agents/          # Dynamic agents runtime (FastAPI, MongoDB, AG-UI/SSE)
  knowledge_bases/rag/     # RAG server, ingestors, graphrag, ontology
  skills_middleware/       # Skill scanning / catalog middleware
  utils/                   # Shared utilities
ui/                        # Next.js frontend
docs/                      # Documentation site (Docusaurus)
docker-compose/            # Docker configs for services
tests/                     # Repo-level + RBAC tests
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

## DCO Policy

AI agents operating in this repository **must** follow these rules on every commit:

1. **No AI sign-off** - `Signed-off-by` is a human DCO certification. AI agents must never invent, assume, or add this trailer on their own.
2. **Use an explicit human DCO on every commit** - Every commit must include the `Signed-off-by` trailer that the human contributor explicitly provided.
3. **Do not invent identities** - Use only a DCO identity explicitly provided by the human contributor.

## Git Guidelines

- **Conventional Commits for commits and PR titles** - Format: `type(scope): description`
  - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
  - Example: `feat(rag): add userinfo caching`
- **Branch naming** - Use `prebuild/` prefix for CI to build Docker images
  - Example: `prebuild/feat/rag-batch-job-status`
- **PR descriptions** - Follow the template in `.github/pull_request_template.md`

## Issue Tracking

This project uses **GitHub Issues** for issue tracking.

- Create follow-up work as GitHub Issues in `cnoe-io/ai-platform-engineering`.
- Reference related issues in PR descriptions when applicable.
- Do not use repo-local Beads or `bd` issue tracking.

## Quality Gates

Before committing code changes, run relevant checks:
- Python: `uv run ruff check`, `uv run pytest` (always use `uv run` to ensure virtual env)
- UI: `nvm use` first (if available), then `npm run lint`, `npm run build`

## Docker Compose First Install

When changing `docker-compose.yaml`, `docker-compose.dev.yaml`, `.env.example`,
release image tags, Compose profiles, Keycloak/OpenFGA/RAG defaults, or
first-launch UX, follow `.claude/skills/docker-compose-first-install/SKILL.md`.
The `docker-compose.yaml` + `.env.example` path must work for a first-time OSS
user with the minimal profiles:

```bash
mcp-servers,caipe-ui-prod,rbac,caipe-supervisor,dynamic-agents,rag,caipe-mongodb,web_ingestor
```

Do not add Slack/Webex bots to that default path.

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

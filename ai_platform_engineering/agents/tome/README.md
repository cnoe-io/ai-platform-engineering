# Tome Agent

The LLM "brain" for the **Tome** wiki app (the UI shell lives in `ui/src` under
`lib/tome`, `components/tome`, `app/api/tome`). caipe-ui is LLM-free by design,
so all model work is delegated to this Python service over HTTP/SSE — the same
pattern the platform uses for the supervisor and dynamic agents.

It runs the **Claude Agent SDK** ingest + chat loops. The UI proxies
`POST /chat` and `POST /ingest` to it; the agent calls back to the UI's
`/api/tome/api/internal/...` endpoints for the project snapshot, page bodies,
and persistence. CAIPE Mongo is the system of record.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | Chat turn → `text/event-stream` (`token`/`tool_call`/`tool_result`/`session`/`done`/`error`) |
| POST | `/ingest` | Ingest run → `text/event-stream` (`log`/`tool_call`/`page_written`/`done`/`error`) |
| GET | `/healthz` · `/readyz` · `/metrics` | Liveness / readiness / metrics |

## Configuration (env)

| Var | Meaning |
|---|---|
| `TTT_PROJECT_ID` | CAIPE project id/slug (opaque; used to build callback URLs) |
| `TTT_BACKEND_URL` | Base for the UI's tome API, e.g. `http://caipe-ui:3000/api/tome` |
| `TTT_AGENT_TOKEN` | Shared bearer for the internal callbacks (non-empty) |
| `TTT_PROJECT_ROOT` | Working-copy dir for the agent's file tools (rehydrated each run) |
| `TTT_AGENT_ROLE` | `editor` \| `viewer` |
| `TTT_CHAT_MODEL` / `TTT_INGEST_MODEL` | Model ids (Anthropic-style; may be served via a proxy) |
| `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` | Anthropic-style endpoint + key (a proxy may front Bedrock etc.) |
| `GITHUB_TOKEN` / `CONFLUENCE_TOKEN` / `WEBEX_TOKEN` | Read-only source tokens for the connector MCPs (optional) |

The endpoint, models, and credentials are entirely config-driven — nothing
host- or product-specific is hardcoded.

## Run (local dev)

```bash
uv run uvicorn tome_agent.agent.main:app --host 0.0.0.0 --port 8766
```

Point the UI at it with `TOME_AGENT_URL` (e.g. `http://host.docker.internal:8766`).

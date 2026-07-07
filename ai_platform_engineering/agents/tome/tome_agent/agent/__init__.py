"""ttt-agent — the per-project agent container.

A self-contained package that gets baked into `Dockerfile.agent`. It runs
the Claude Agent SDK loop (chat + ingest), exposes an HTTP/SSE surface
the backend reverse-proxies, and calls back to the backend over
`/internal/...` for page persistence and ingest log lines.

Nothing in this package may import from `ttt.api`, `ttt.services`,
`ttt.models`, `ttt.db`, or `ttt.pipeline` — those are backend-only
(sqlite, OAuth flows, FastAPI routes) and aren't in the agent image.

It MAY import from:
- `ttt.config` (settings — read-only).
- `ttt.orchestrator.contract` (wire schemas shared with the backend).
- `ttt.reports.schema` (page kind / template helpers — pure data).
- `ttt.prompts` (static markdown loader).

This boundary is what keeps the agent image minimal — no FastAPI routes
or sqlite or OAuth state pulled in transitively.
"""

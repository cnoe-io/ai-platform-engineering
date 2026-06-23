# Tome — Local Dev Setup

Tome is the wiki/projects feature running as a second dev instance on **port 33000**, with its own isolated Docker stack (Keycloak, OpenFGA, MongoDB, agentic apps) so it doesn't conflict with the main CAIPE instance.

## Port Map

| Service | Port |
|---|---|
| UI dev server | 33000 |
| Tome agent backend | 9500 |
| Keycloak | 17080 |
| OpenFGA | 28080 |
| MongoDB | 27117 |
| Dynamic Agents | 18100 |
| AgentGateway | 14000 |
| OpenFGA authz-bridge | 19100 |
| Audit service | 38010 |
| FinOps app | 3010 |
| Weather app | 3020 |
| OSS Repo Management app | 3040 |
| Jira Project Dashboard app | 3041 |

## Prerequisites

- Docker Desktop
- Node.js via `nvm` (`.nvmrc` in `ui/`)
- Python 3.11+ with [`uv`](https://github.com/astral-sh/uv)
- A `ui/.env.local` — copy `tome/env.local.example` and fill in secrets

## 1. Start the Docker stack

```bash
docker compose -f docker-compose.tome.yaml up -d
```

Wait for Keycloak to finish initializing (~60–90s on first run — it imports the realm and patches redirect URIs for `localhost:33000`). Check with:

```bash
docker compose -f docker-compose.tome.yaml ps
```

All services should show `healthy` or `exited (0)` (one-shot init containers exit 0).

### Stop / tear down

```bash
# Stop without removing volumes (preserves MongoDB data and Keycloak state)
docker compose -f docker-compose.tome.yaml stop

# Full teardown including volumes
docker compose -f docker-compose.tome.yaml down -v
```

## 2. Start the UI dev server

```bash
cd ui
nvm use          # picks up .nvmrc
npm run dev -- --port 33000
```

The server hot-reloads code changes but **does not reload env vars** — restart it after editing `ui/.env.local`.

Open [http://localhost:33000](http://localhost:33000). Log in with Keycloak local credentials or the bootstrap admin email set in `BOOTSTRAP_ADMIN_EMAILS`.

## 3. Start the Tome agent backend

The Tome agent is a Python/uvicorn service that handles LLM chat and ingest for the wiki feature.

```bash
cd ai_platform_engineering/agents/tome
uv run uvicorn tome_agent.agent.main:app --host 0.0.0.0 --port 9500
```

The UI expects it at `TOME_AGENT_URL=http://localhost:9500` (set in `ui/.env.local`).

See [`ai_platform_engineering/agents/tome/README.md`](../ai_platform_engineering/agents/tome/README.md) for full agent configuration.

## 4. Verify everything is up

```bash
# Docker stack
docker compose -f docker-compose.tome.yaml ps

# Tome agent
curl http://localhost:9500/healthz

# UI
curl -s -o /dev/null -w "%{http_code}" http://localhost:33000/api/config
```

## Agentic apps

The following apps are included in the Docker stack and proxied through the UI at `/apps/<id>`:

| App | Container port | UI path |
|---|---|---|
| FinOps | 3010 | `/apps/finops` |
| Weather | 3020 | `/apps/weather` |
| OSS Repo Management | 3040 | `/apps/oss-repo-management` |
| Jira Project Dashboard | 3041 | `/apps/jira-project-dashboard` |

JWT verification is disabled for all apps in local dev (`AGENTIC_APP_*_JWT_DISABLED=true`).

## GitHub OAuth (Credentials / Connections)

The GitHub OAuth app must have the following callback URL registered:

```
http://localhost:33000/api/credentials/oauth/github/callback
```

Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `ui/.env.local` to match the registered app.

## env.local reference

See [`tome/env.local.example`](./env.local.example) for a full template. Copy it to `ui/.env.local` and fill in your secrets.

Key values to change from defaults:

| Variable | What to set |
|---|---|
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` |
| `BOOTSTRAP_ADMIN_EMAILS` | Your email |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Your GitHub OAuth app credentials |
| `GITHUB_TOKEN` | Personal access token for Skill Hubs |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (or proxy URL) |

# Quickstart / Verification: MCP Authorization Resilience

How to verify each user story. Run from repo root unless noted.

## Prereqs

- Local dev stack via `docker-compose.dev.yaml` with the AgentGateway + OpenFGA + dynamic-agents profiles, or a Helm render environment.
- `uv` for Python tests; `helm` for chart render.

## US1 — Default install has working MCP tools (P1)

**Chart render (static path, default):**

```bash
helm template charts/ai-platform-engineering \
  --set global.agentgateway.enabled=true \
  --set global.agentgateway.extAuth.enabled=true \
  | grep -A3 'extAuthz:'
# EXPECT: a `timeout: "10s"` line under extAuthz
```

```bash
# Operator override is honored:
helm template charts/ai-platform-engineering \
  --set global.agentgateway.enabled=true \
  --set global.agentgateway.extAuth.enabled=true \
  --set global.agentgateway.extAuth.timeout=5s \
  | grep 'timeout:'
# EXPECT: timeout: "5s"
```

**Dev compose (already applied hotfix):**

```bash
grep -n 'timeout' deploy/agentgateway/config.yaml
# EXPECT: extAuthz.timeout: 10s
docker logs agentgateway 2>&1 | grep -i 'reload\|extauthz' | tail
# EXPECT: config reloaded successfully (no "unknown field")
```

Then open the agent chat and enumerate tools → **no healthy/authorized server reported unavailable** (SC-001).

## US2 — Cold-start slowness self-heals (P2)

Unit test (preferred, deterministic):

```bash
cd ai_platform_engineering/dynamic_agents
PYTHONPATH=src uv run pytest tests -k "resilience and (retry or transient)" -v
# EXPECT:
#  - transient-then-success ⇒ server available, attempts>1, not in failed list
#  - permanent error ⇒ attempts==1 (fail fast), in failed/permanent list
#  - success path ⇒ attempts==1 (no retry, no added latency)
```

## US3 — Honest not-ready vs failed messaging (P3)

```bash
cd ai_platform_engineering/dynamic_agents
PYTHONPATH=src uv run pytest tests -k "classify or warning" -v
# EXPECT:
#  - classify_load_error: timeout/5xx/authz-timeout-403 ⇒ 'transient'
#                         unknown-host/refused/404      ⇒ 'permanent'
#                         clean policy 401/403          ⇒ 'denied'
#  - transient ⇒ "starting up ... will be retried" (NOT "will not work")
#  - permanent ⇒ "unavailable ... Tools from this server will not work."
#  - denied    ⇒ unchanged denial message (never "starting up")
```

## Edge cases

- **Genuine denial not retried** (SC-005): test asserts a clean 403 returns immediately as `denied` with `attempts==1`.
- **All transient on cold start**: messaging reads "starting up"; a second enumeration recovers.

## Quality gates (verify step)

```bash
# Python lint + tests
cd ai_platform_engineering/dynamic_agents && uv run ruff check src && PYTHONPATH=src uv run pytest tests -q

# Chart renders cleanly (static + override)
helm template charts/ai-platform-engineering --set global.agentgateway.enabled=true --set global.agentgateway.extAuth.enabled=true >/dev/null && echo OK
```

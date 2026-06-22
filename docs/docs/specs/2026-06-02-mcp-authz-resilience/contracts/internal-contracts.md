# Phase 1 Contracts: MCP Authorization Resilience

No new external/HTTP API. Contracts here are (a) the gateway config knob, (b) the internal Python function behavior, and (c) the user-facing warning messages.

## C1 — Helm values contract

```yaml
global:
  agentgateway:
    extAuth:
      enabled: false
      serviceName: ""
      serviceNamespace: ""
      port: 9100
      # NEW: per-route external-authorization request timeout applied by the
      # gateway. The proxy's built-in default is 200ms, which is too tight for
      # concurrent tool-enumeration against a cold OpenFGA and yields
      # fail-closed 403s ("MCP server unavailable"). Default 10s.
      timeout: "10s"
```

- **Static routing render** (`templates/agentgateway-static-config.yaml`): the `extAuthz` block MUST emit `timeout: {{ $extAuth.timeout | default "10s" | quote }}`.
- **Backward compatibility**: when `extAuth.timeout` is unset, render `"10s"`. No behavior change when `extAuth.enabled: false` (block not rendered).
- **CRD routing** (`templates/agentgateway-mcp.yaml`): unchanged; documented that the timeout is tuned via the authz-bridge backend `requestTimeout` (no policy field exists).

## C2 — `get_tools_with_resilience` contract (`mcp_client.py`)

```python
async def get_tools_with_resilience(
    connections: dict[str, dict[str, Any]],
    *,
    max_attempts: int = 3,
    base_backoff_s: float = 0.25,
) -> tuple[list, list[str], dict[str, str]]:
    ...
```

**Guarantees:**

1. **Backward compatible** return signature `(all_tools, failed_servers, failed_errors)` is preserved; new behavior is additive (a per-server status is also exposed for the runtime — via an attribute/return extension that existing callers can ignore).
2. **Success path does zero retries** — a server that connects on attempt 1 incurs no added latency.
3. **Transient retry is bounded** — at most `max_attempts` connect attempts per server, with exponential backoff `base_backoff_s * 2**(n-1)` plus jitter; total added delay per server is bounded and small.
4. **Permanent errors fail fast** — classified-permanent failures are NOT retried.
5. **Denials are not retried** — a clean policy 401/403 returns immediately as `denied`.
6. **Per-server isolation preserved** — one server's failure/retries never block another (servers still processed concurrently).
7. **Classification is centralized** — a single `classify_load_error(error_msg, ...) -> Literal["transient","permanent","denied"]` helper is the only place mapping lives.

**Classification helper contract:**

```python
def classify_load_error(error_msg: str, status_code: int | None = None) -> str:
    """Return 'transient' | 'permanent' | 'denied'. Ambiguous 403 → 'denied' (conservative)."""
```

## C3 — User-facing warning contract (`agent_runtime.py`)

The single blanket warning is replaced by classification-aware lines.

| Condition | System-prompt warning (LLM context) | Streamed `on_warning` (user) |
|---|---|---|
| transient (not ready) | `**MCP servers still starting up (will retry; tools may appear shortly):** <ids>` | `MCP server '<id>' is starting up and not ready yet — it will be retried.` |
| permanent (needs attention) | `**MCP servers that failed to load (tools unavailable — needs attention):** <ids>: <error>` | `MCP server '<id>' is unavailable: <reason>. Tools from this server will not work.` |
| denied | (existing denial/diagnostic messaging — unchanged) | (existing denial message — unchanged) |

**Guarantees:**

1. The permanent message keeps the actionable "Tools from this server will not work" wording **only** for permanent failures.
2. The transient message conveys a temporary/not-ready state and an automatic retry — never the permanent wording.
3. A genuine denial is never relabeled as "starting up".
4. Messages are deterministic for a given classification (testable).

# Phase 1 Data Model: MCP Authorization Resilience

This feature is stateless; the only "model" is an in-process classification of a tool-load attempt. No persisted entities.

## MCPServerLoadOutcome (in-memory, per server per init)

| Field | Type | Description |
|---|---|---|
| `server_id` | `str` | MCP server identifier (route id). |
| `status` | `Literal["available", "transient", "permanent", "denied"]` | Classification of the load result. |
| `tools` | `list` | Tools loaded (only when `available`). |
| `error` | `str \| None` | Extracted, user-safe error message (when not `available`). |
| `attempts` | `int` | Number of connect attempts made (1 on success path; up to retry max for transient). |

### Status semantics & transitions

```text
attempt → success                              ⇒ available   (no retry)
attempt → transient error  → retry (bounded)   ⇒ available    (self-heal)
                            → retries exhausted ⇒ transient    ("still starting up, will retry")
attempt → permanent error                      ⇒ permanent    (fail fast, "needs attention")
attempt → genuine policy 401/403 (not timeout) ⇒ denied        (surface as denial; never retried)
```

## Error → status mapping (classification rules)

| Observed signal (from `_extract_error_message` / `_diagnose_endpoint_failure`) | Status |
|---|---|
| Request timeout / read timeout / `TimeoutException` | transient |
| Connection reset / connection closed mid-stream / `TransportError` after connect | transient |
| HTTP 5xx from endpoint | transient |
| HTTP 403 **with** ext_authz/upstream-timeout signature | transient |
| Name resolution failure / unknown host (`getaddrinfo`) | permanent |
| Connection refused with no listener (backend down) | permanent |
| HTTP 404 (no route / wrong path) | permanent |
| Malformed connection config | permanent |
| Clean HTTP 401/403 policy decision (no timeout signal) | denied |

**Conservative bias (FR-009 safety):** an ambiguous 403 that cannot be tied to a timeout/connection signal is classified **denied** (not retried), never silently retried.

## Aggregation in `agent_runtime`

`get_tools_with_resilience` continues to return `(all_tools, failed_servers, failed_errors)` for backward compatibility, **plus** a per-server status map. `agent_runtime` stores:

- `_failed_servers_transient: list[str]` + message
- `_failed_servers_permanent: list[str]` + message
- (denials already flow through existing denial/diagnostic messaging)

These drive the two distinct warning lines (see contracts).

# Contract: Python `requireRbacPermission` helper

**Spec**: [`spec.md`](../spec.md) FR-002, FR-003 | **Plan**: [`plan.md`](../plan.md) Phase 2 | **Sequence diagram**: [`call-sequences.md`](../call-sequences.md) Flow 3

This is the API contract for the Python helper that mirrors the TypeScript `requireRbacPermission` function in `ui/src/lib/api-middleware.ts` and `checkPermission` in `ui/src/lib/rbac/keycloak-authz.ts`. Every Python service in scope (supervisor, dynamic_agents backend, RAG server, agent MCP servers, Slack bot) consumes this helper at every gate.

The Python and TypeScript implementations MUST behave identically for the same `(token, resource, scope)` triple. Tests in [`tests/rbac/unit/py/test_helper_parity.py`](../../) (Phase 2 deliverable) assert this by running both runtimes against the same Keycloak with the same personas and asserting identical outcomes.

---

## Module location

```text
ai_platform_engineering/utils/auth/keycloak_authz.py
```

## Public API

### `async def require_rbac_permission(token: str, resource: str, scope: str) -> AuthzDecision`

Validates that the bearer in `token` has the named `(resource, scope)` permission via Keycloak's PDP. Returns the decision. Does **not** raise on deny; the caller raises HTTP 403 (this matches the supervisor's existing pattern of separating policy decision from HTTP response).

**Parameters**

| Name | Type | Notes |
|---|---|---|
| `token` | `str` | Raw access token (no `"Bearer "` prefix). MUST already be JWKS-validated upstream by `JwtUserContextMiddleware`. |
| `resource` | `str` | Keycloak resource name. MUST match the regex `^[a-z0-9_]+(:[A-Za-z0-9_-]+)?$`. |
| `scope` | `str` | Keycloak scope name. MUST match the regex `^[a-z_]+$`. |

**Returns**

```python
@dataclass(frozen=True)
class AuthzDecision:
    allowed: bool
    reason: AuthzReason   # closed enum mirroring TS
    source: Literal['keycloak', 'cache', 'local']

class AuthzReason(str, Enum):
    OK = 'OK'
    OK_ROLE_FALLBACK = 'OK_ROLE_FALLBACK'
    OK_BOOTSTRAP_ADMIN = 'OK_BOOTSTRAP_ADMIN'
    DENY_NO_CAPABILITY = 'DENY_NO_CAPABILITY'
    DENY_PDP_UNAVAILABLE = 'DENY_PDP_UNAVAILABLE'
    DENY_INVALID_TOKEN = 'DENY_INVALID_TOKEN'
    DENY_RESOURCE_UNKNOWN = 'DENY_RESOURCE_UNKNOWN'
```

**Raises**: never — even on PDP network errors. PDP unreachable is reflected in the returned `AuthzDecision`.

**Side effects**:
- Reads / writes the process-local `permission_decision_cache` (mirror of TS `permissionDecisionCache`). Cache key: `sha256(token):resource#scope`. TTL: `int(os.getenv('RBAC_CACHE_TTL_SECONDS', 60))`.
- Calls `log_authz_decision(...)` (best-effort, swallows write failures per FR-007).

---

### `def require_rbac_permission_dep(resource: str, scope: str) -> Callable`

FastAPI dependency factory. Wraps the async helper for use as `Depends(...)`. Raises `HTTPException(403)` on deny so handlers don't have to.

```python
@router.get('/v1/query')
async def query(
    request: Request,
    _ = Depends(require_rbac_permission_dep('rag', 'retrieve')),
):
    ...
```

The dependency reads the bearer from the request via `current_bearer_token` ContextVar (set by `JwtUserContextMiddleware`).

---

## Behavioural contract (parity with TS)

The following invariants hold across both runtimes and are asserted by `tests/rbac/unit/py/test_helper_parity.py`:

### Invariant 1 — Same input, same outcome
For any `(token, resource, scope)`:
```
TS checkPermission(token, resource, scope).allowed == Py require_rbac_permission(token, resource, scope).allowed
```

### Invariant 2 — Same reason code on deny
```
TS .reason == Py .reason  (when both deny)
```

### Invariant 3 — Cache key parity
The cache key MUST be `sha256(token):resource#scope` in both runtimes, so a cache populated by either will hit for the other (relevant if cache is ever shared via Redis — out of scope today, but the parity keeps that door open).

### Invariant 4 — PDP request payload parity
Both runtimes MUST issue the same UMA-ticket grant request:
```
POST {KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token
Authorization: Bearer <token>
Content-Type: application/x-www-form-urlencoded
Body:
  grant_type=urn:ietf:params:oauth:grant-type:uma-ticket
  audience={KEYCLOAK_RESOURCE_SERVER_ID}
  permission={resource}#{scope}
  response_mode=decision
```

### Invariant 5 — Audit-log parity
Audit-log documents written by the Py helper MUST validate against [`audit-event.schema.json`](./audit-event.schema.json) with `source: "py"`. TS records use `source: "ts"`. All other fields populated identically for the same decision.

### Invariant 6 — PDP-unavailable fallback parity
Both runtimes MUST consult `realm-config-extras.json` ([`realm-config-extras.schema.json`](./realm-config-extras.schema.json)) for per-resource fallback. Both runtimes MUST default to deny-all when no rule is configured.

---

## Environment variables (consumed by the Python helper)

Same names, same semantics, same defaults as the TS helper. **Do not introduce Python-specific aliases.**

| Variable | Default | Purpose |
|---|---|---|
| `KEYCLOAK_URL` | (required, no default) | Base URL, e.g. `http://localhost:7080`. |
| `KEYCLOAK_REALM` | `caipe` | Realm name. |
| `KEYCLOAK_RESOURCE_SERVER_ID` | (required) | Resource-server client id, e.g. `caipe-app`. |
| `RBAC_CACHE_TTL_SECONDS` | `60` | PDP decision cache TTL. |
| `RBAC_CACHE_MAX_SIZE` | `10000` | LRU bound. |
| `BOOTSTRAP_ADMIN_EMAILS` | (empty) | Comma-separated. Same emergency override as TS. |
| `RBAC_FALLBACK_CONFIG_PATH` | `/etc/keycloak/realm-config-extras.json` | Path to PDP-unavailable fallback config. |

---

## Failure-mode contract

| Scenario | Behaviour |
|---|---|
| Token missing or malformed | Caller-side responsibility (`JwtUserContextMiddleware` rejects upstream with 401). The helper assumes `token` is well-formed and reaches Keycloak. |
| Token validates but `(resource, scope)` not in realm | PDP returns 403; helper returns `AuthzDecision(allowed=False, reason=DENY_NO_CAPABILITY)`. Compare to `DENY_RESOURCE_UNKNOWN` which fires only when the helper itself detects a misconfiguration before contacting Keycloak — currently unused; reserved for future. |
| Network error reaching Keycloak | Helper returns `AuthzDecision(allowed=False, reason=DENY_PDP_UNAVAILABLE)`. Caller checks `realm-config-extras` for fallback and may mutate the decision to `OK_ROLE_FALLBACK` based on JWT realm roles. |
| Cache hit for a previously-allowed decision | Helper returns the cached decision with `source='cache'`. Cache holds only allows; denies are never cached (mirrors TS). |
| Audit-log Mongo write fails | Logged at WARN with structured fields `{decision, error}`. Decision proceeds. (FR-007.) |

---

## Implementation hint (NON-binding)

Below is a reference implementation outline. Phase 2 implementers should adapt it; the contract above is binding, the code below is illustrative.

```python
# ai_platform_engineering/utils/auth/keycloak_authz.py
import hashlib
import os
from dataclasses import dataclass
from enum import Enum
from typing import Literal

import httpx
from cachetools import TTLCache

from ai_platform_engineering.utils.auth.audit import log_authz_decision
from ai_platform_engineering.utils.auth.jwt_context import get_jwt_user_context
from ai_platform_engineering.utils.auth.realm_extras import get_fallback_rule


class AuthzReason(str, Enum):
    OK = 'OK'
    OK_ROLE_FALLBACK = 'OK_ROLE_FALLBACK'
    OK_BOOTSTRAP_ADMIN = 'OK_BOOTSTRAP_ADMIN'
    DENY_NO_CAPABILITY = 'DENY_NO_CAPABILITY'
    DENY_PDP_UNAVAILABLE = 'DENY_PDP_UNAVAILABLE'
    DENY_INVALID_TOKEN = 'DENY_INVALID_TOKEN'
    DENY_RESOURCE_UNKNOWN = 'DENY_RESOURCE_UNKNOWN'


@dataclass(frozen=True)
class AuthzDecision:
    allowed: bool
    reason: AuthzReason
    source: Literal['keycloak', 'cache', 'local']


_CACHE: TTLCache[str, AuthzDecision] = TTLCache(
    maxsize=int(os.getenv('RBAC_CACHE_MAX_SIZE', 10_000)),
    ttl=int(os.getenv('RBAC_CACHE_TTL_SECONDS', 60)),
)


def _cache_key(token: str, resource: str, scope: str) -> str:
    digest = hashlib.sha256(token.encode()).hexdigest()
    return f'{digest}:{resource}#{scope}'


async def require_rbac_permission(token: str, resource: str, scope: str) -> AuthzDecision:
    key = _cache_key(token, resource, scope)
    if (hit := _CACHE.get(key)) is not None:
        return AuthzDecision(allowed=hit.allowed, reason=hit.reason, source='cache')

    keycloak_url = os.environ['KEYCLOAK_URL']
    realm = os.getenv('KEYCLOAK_REALM', 'caipe')
    audience = os.environ['KEYCLOAK_RESOURCE_SERVER_ID']

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f'{keycloak_url}/realms/{realm}/protocol/openid-connect/token',
                headers={'Authorization': f'Bearer {token}'},
                data={
                    'grant_type': 'urn:ietf:params:oauth:grant-type:uma-ticket',
                    'audience': audience,
                    'permission': f'{resource}#{scope}',
                    'response_mode': 'decision',
                },
            )
    except httpx.HTTPError:
        decision = _evaluate_pdp_unavailable_fallback(token, resource)
        log_authz_decision_safe(token, resource, scope, decision)
        return decision

    if r.status_code == 200 and r.json().get('result') is True:
        decision = AuthzDecision(allowed=True, reason=AuthzReason.OK, source='keycloak')
        _CACHE[key] = decision
        log_authz_decision_safe(token, resource, scope, decision)
        return decision

    if r.status_code == 403:
        decision = AuthzDecision(allowed=False, reason=AuthzReason.DENY_NO_CAPABILITY, source='keycloak')
        # Note: denies are NOT cached, to match TS behaviour.
        log_authz_decision_safe(token, resource, scope, decision)
        return decision

    # Unexpected status (e.g. 500 from Keycloak) — treat as PDP-unavailable.
    decision = _evaluate_pdp_unavailable_fallback(token, resource)
    log_authz_decision_safe(token, resource, scope, decision)
    return decision
```

Implementation TODOs left to Phase 2:
- `_evaluate_pdp_unavailable_fallback` reads `realm-config-extras.json` and the JWT's `realm_access.roles` claim.
- `log_authz_decision_safe` wraps `log_authz_decision` in try/except per FR-007.
- `require_rbac_permission_dep` factory for FastAPI consumption.
- Bootstrap-admin emergency override mirroring `isBootstrapAdmin` in TS.
- Tests: parity suite + unit suite covering each AuthzReason path.

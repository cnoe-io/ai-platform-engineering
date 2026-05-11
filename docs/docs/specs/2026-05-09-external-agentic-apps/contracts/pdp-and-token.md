# Contract: PDP Decisions and App-Scoped Tokens

## PDP Request

CAIPE calls the policy boundary before launch, proxy forwarding, webhook forwarding, and app-owned resource authorization.

```json
{
  "correlation_id": "req_01H...",
  "app_id": "weather",
  "action": "app.proxy.request",
  "subject": {
    "id": "opaque-or-hash",
    "email_hash": "sha256",
    "roles": ["user"],
    "groups": ["platform"]
  },
  "request": {
    "method": "GET",
    "route": "/apps/weather/current",
    "tenant": "default",
    "resource": {
      "type": "route",
      "id": "/current"
    }
  },
  "installation": {
    "installed": true,
    "enabled": true,
    "runtime_health": "healthy"
  }
}
```

## PDP Response

```json
{
  "decision_id": "dec_01H...",
  "effect": "allow",
  "reason_code": "allowed",
  "scopes": ["weather:read"],
  "expires_at": "2026-05-09T18:30:00Z",
  "safe_metadata": {
    "policy": "local-agentic-apps-v1"
  }
}
```

Denied response:

```json
{
  "decision_id": "dec_01H...",
  "effect": "deny",
  "reason_code": "unauthorized",
  "scopes": [],
  "expires_at": "2026-05-09T18:30:00Z"
}
```

## Required Behavior

- The default effect is deny.
- PDP unavailability denies by default. The initial implementation uses the local
  adapter in `ui/src/lib/agentic-apps/pdp.ts`; external PDP wiring can replace
  the adapter without changing callers.
- CAIPE does not contact the app runtime for denied launch, proxy, or webhook decisions.
- `decision_id` and `correlation_id` are included in audit events.
- Safe metadata must not include raw cookies, app tokens, provider payloads, provider tokens, or secrets.

## App-Scoped Token Claims

Allowed forwarded requests include a CAIPE-issued app-scoped token.

```json
{
  "iss": "caipe-agentic-apps",
  "aud": "agentic-app:weather",
  "sub": "opaque-or-hash",
  "app_id": "weather",
  "scope": "weather:read",
  "scp": ["weather:read"],
  "decision_id": "dec_01H...",
  "correlation_id": "req_01H...",
  "jti": "tok_01H...",
  "iat": 1778350800,
  "exp": 1778351100
}
```

Implemented environment variables:

- `AGENTIC_APP_TOKEN_SECRET`: HS256 signing secret for local app-scoped tokens;
  falls back to `NEXTAUTH_SECRET` in the CAIPE host.
- `AGENTIC_APP_TOKEN_ISSUER`: optional issuer override; defaults to
  `caipe-agentic-apps`.
- `AGENTIC_APP_<ID>_JWT_AUDIENCE`: optional reference-runtime audience override;
  defaults to `agentic-app:<id>`.

## Token Verification Requirements For Apps

- Verify issuer, audience, expiration, app id, scopes, and signature.
- Treat `x-caipe-*` headers as non-authoritative hints.
- Enforce scopes and `app_id` locally before serving protected app resources.
- Reject expired tokens and tokens for another app.
- Do not require CAIPE browser cookies or root provider tokens.

## Forwarded Headers

CAIPE sets:

- `Authorization: Bearer <app-scoped-token>`
- `X-Caipe-App-Id: <appId>`
- `X-Caipe-Decision-Id: <decisionId>`
- `X-Caipe-Correlation-Id: <correlationId>`

CAIPE strips inbound:

- `Cookie`
- client-supplied `Authorization`
- client-supplied `X-Caipe-*` identity headers
- hop-by-hop proxy headers

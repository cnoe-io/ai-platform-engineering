# Contract: Generic Webhook Gateway

## Endpoint

```text
/api/agentic-apps/webhooks/{appId}/{provider}/{channel}
```

Supported methods are declared per channel in the app manifest. The implemented gateway supports
`POST` and `PUT`; undeclared methods return `405`.

## Routing Inputs

- `appId`: installed app ID.
- `provider`: provider namespace such as `github`, `slack`, `jira`, or `gitlab`.
- `channel`: app-owned webhook channel declared in the manifest.
- Raw body bytes.
- Provider headers required by the app for signature verification and delivery tracing.

## Host Checks

Before forwarding, CAIPE must:

1. Confirm the app platform is enabled.
2. Resolve an installed and enabled app.
3. Confirm the manifest declares the provider/channel.
4. Confirm the request method is allowed.
5. Enforce `maxBodyBytes` before forwarding.
6. Apply health policy.
7. Request a PDP decision for the channel `policyAction` or
   `webhook.{provider}.{channel}`.
8. Emit delivery records for denied, dropped, forwarded, and failed outcomes.

Rate limiting is reserved in the contract and represented by the `rate_limited`
delivery status; the first implementation does not enable a distributed limiter.

If any check fails, CAIPE must not contact the app runtime.

## Forwarded Request

CAIPE forwards to the app runtime origin plus the manifest channel `upstreamPath`.

The forwarded request must preserve:

- Exact raw body bytes.
- Declared provider signature headers.
- Declared provider delivery ID headers.
- `Content-Type` when present and allowed.

CAIPE adds:

- `Authorization: Bearer <app-scoped-token>`
- `X-Caipe-App-Id`
- `X-Caipe-Decision-Id`
- `X-Caipe-Correlation-Id`
- `X-Caipe-Body-Sha256`

CAIPE strips:

- Browser cookies.
- Client-supplied `Authorization`.
- Client-supplied `X-Caipe-*` headers.
- Hop-by-hop proxy headers.

## Response Semantics

- Upstream response status: allowed deliveries return the app runtime response status
  and body, plus `X-Caipe-Decision-Id` and `X-Correlation-Id`.
- `403 Forbidden`: PDP denied, app disabled, channel blocked, or health policy blocks forwarding.
- `404 Not Found`: app or channel is unknown; use this for untrusted scanning resistance.
- `405 Method Not Allowed`: route exists but the method is not declared for the channel.
- `413 Payload Too Large`: body exceeds manifest/channel limit.
- `502 Bad Gateway`: app runtime unavailable after CAIPE allowed forwarding.

Implemented header allowlist:

- `Content-Type`
- Headers explicitly declared by `webhooks[].preservedHeaders`

The gateway always strips browser cookies, client-supplied `Authorization`,
client-supplied `X-Caipe-*` headers, and hop-by-hop proxy headers before adding
host-owned authorization and correlation headers.

## App Responsibilities

- Verify provider signatures when `verificationOwner` is `app`.
- Own provider secrets, provider tokens, retry idempotency, and domain event persistence.
- Treat CAIPE headers as delivery metadata, not provider authenticity proof.
- Return safe status codes and avoid logging raw secrets or provider tokens.

## Audit Event Shape

```json
{
  "type": "agentic_app.webhook.forwarded",
  "appId": "agentic-sdlc",
  "provider": "github",
  "channel": "repo-events",
  "decisionId": "dec_01H...",
  "correlationId": "req_01H...",
  "outcome": "forwarded",
  "reasonCode": "allowed",
  "payload": {
    "method": "POST",
    "bodySha256": "hex",
    "providerDeliveryId": "delivery-id",
    "httpStatus": 202
  }
}
```

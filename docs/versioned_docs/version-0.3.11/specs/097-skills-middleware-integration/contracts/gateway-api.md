# Contract: Try Skills Gateway (UI + Machine Catalog Access)

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-24

## Overview

The **Try skills gateway** satisfies FR-018 and User Story 4: in-product documentation for calling the **same** catalog the UI and supervisor use, with **Okta/OIDC Bearer** (FR-014) or a **scoped catalog API key**, plus **step-by-step** setup for **Claude** and **Cursor**.

---

## UI contract

- **Location**: Skills experience includes a dedicated panel or route (e.g. “Try API” / “Gateway”) reachable from the main skills page.
- **Content** (minimum):
  1. Base URL for catalog requests (environment-specific).
  2. **Auth option A**: `Authorization: Bearer <access_token>` — note that the token must be an Okta/OIDC access token accepted by the same JWKS validation as RAG (FR-014).
  3. **Auth option B**: API key header (exact header name documented; e.g. `X-Caipe-Skills-Key` or `Authorization: Bearer sk_...` — **one** scheme chosen and documented; must not log key values).
  4. Example `curl` for `GET` catalog with optional `q`, `page`, `page_size`, `source`, `visibility` query params (see [catalog-api.md](./catalog-api.md)).
  5. **Claude**: ordered steps — obtain token or API key, fetch catalog JSON, map to local `.cursor/skills`-style or Claude Desktop plugin path per [agentskills.io](https://agentskills.io/specification) layout where applicable; clarify that CAIPE is source of truth for **listing** and optional download of SKILL.md if exposed.
  6. **Cursor**: ordered steps — project rules vs Agent Skills directory (`.cursor/skills` or team convention), how to paste skill metadata or symlink from exported files if/when export exists.
- **Errors**: Document that invalid auth returns **401** with a **generic** body (no account enumeration).

---

## Catalog API key (machine clients)

### Issuance (admin or self-service — product decision)

- Keys are **revocable**, **scope-limited** to catalog read (and optional related read-only operations).
- Storage: persist **hash only** (e.g. bcrypt/argon2 or HMAC of key with server secret); store `key_id`, `owner_user_id`, `created_at`, `revoked_at`, `last_used_at` (optional).

### Request authentication

- Client sends key via the documented header/scheme.
- Server resolves key to principal; applies **same visibility rules** as JWT path (FR-020): union of global + teams + personal for that principal.

### Rotation

- Creating a new key does not invalidate old until revoked; revocation effective immediately.

---

## Consistency

- Search and list results for the same principal MUST match between:
  - UI gallery (filtered),
  - `/skills` chat command,
  - Gateway-documented `curl`,
  - Supervisor effective set for that user/session (FR-004, FR-015, FR-020).

---

## Success criteria mapping

- **SC-008**: Developer completes setup using only in-product gateway text + one successful authenticated catalog request with search.

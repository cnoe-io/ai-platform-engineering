# Contract: Skill Hubs API (Admin)

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-18

## Overview

Authorized users (admins or “skill hub managers”) can register, update, and remove external skill hubs. Unauthorized attempts must receive a clear permission error (FR-009). These endpoints are used by an admin UI or settings page, not by the chat command.

---

## Endpoints

### List hubs

**Method**: `GET`  
**Path**: `/api/skill-hubs`

**Response (200)**: List of hub records (id, type, location, enabled, last_success_at, last_failure_at, last_failure_message, created_at, updated_at). Only for authorized users.

**Authorization**: Require admin or skill-hub-manager role; else **403** with body e.g. `{ "error": "forbidden", "message": "Only authorized users can manage skill hubs." }`.

---

### Register hub

**Method**: `POST`  
**Path**: `/api/skill-hubs`

**Body**:

```json
{
  "type": "github",
  "location": "owner/repo",
  "enabled": true,
  "credentials_ref": null
}
```

- `credentials_ref`: Optional; e.g. name of env var holding GitHub token for private repos.

**Response (201)**: Created hub object (including generated `id`).

**Errors**: **400** if type/location invalid; **403** if unauthorized; **409** if hub with same location already registered (or document conflict).

---

### Update hub

**Method**: `PATCH`  
**Path**: `/api/skill-hubs/[id]`

**Body**: Partial hub object (e.g. `enabled`, `location`, `credentials_ref`).

**Response (200)**: Updated hub object.

**Errors**: **403** unauthorized; **404** if hub not found.

---

### Remove hub

**Method**: `DELETE`  
**Path**: `/api/skill-hubs/[id]`

**Response (204)** or **200** with confirmation.

**Errors**: **403** unauthorized; **404** if hub not found.

---

## Permission model

- Only users with an admin or designated “skill hub manager” role can call POST, PATCH, DELETE, and optionally GET (if list is restricted). End users can only use the catalog (GET /api/skills) and the `/skills` chat command.
- Unauthorized attempts return **403** with a clear message (SC-005).

# Contract: Supervisor Skills Load Status, Refresh & Gateway Sync (FR-012, FR-016, FR-026, SC-007, SC-010)

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-26

## Overview

Operators need to see whether the **in-process supervisor** has loaded skills that match a **recent catalog refresh** (spec FR-016, SC-007). Today, `AIPlatformEngineerMAS._build_graph()` re-reads `get_merged_skills()` only on **process start** and on **`platform_registry` connectivity changes**; `POST /skills/refresh` may only invalidate the catalog **cache** without rebuilding the MAS graph. This contract defines the **observable fields** and the **required refresh semantics**.

---

## Supervisor status (authenticated)

**Purpose**: Expose non-secret metadata for debugging and admin UI.

**Method**: `GET`  
**Path** (illustrative — align with existing health/status patterns): `/internal/supervisor/skills-status` or extend an existing status payload (e.g. enrich `get_status()` from `AIPlatformEngineerMAS` behind an authenticated route).

### Response shape (200)

```json
{
  "graph_generation": 0,
  "skills_loaded_count": 0,
  "skills_merged_at": "2026-03-23T12:00:00Z",
  "catalog_cache_generation": 0
}
```

| Field | Description |
|-------|-------------|
| `graph_generation` | Monotonic counter incremented each `_build_graph()` (matches in-process MAS). |
| `skills_loaded_count` | Number of skills merged into the last `_build_graph()` snapshot. |
| `skills_merged_at` | ISO-8601 UTC timestamp of last successful merge in `_build_graph()` (or null if never). |
| `catalog_cache_generation` | Increments on `invalidate_skills_cache()` / merged-cache rebuild so UI can compare cache vs graph. **Recommended** for FR-026. |
| `last_built_catalog_generation` | Optional; generation value the supervisor’s last `_build_graph()` merged against (if tracked). When present, equality with `catalog_cache_generation` implies **in sync**. |

**Authorization**: Same pattern as catalog (JWT / admin-only as appropriate). Never return raw tokens or hub secrets.

### Extended response (optional single payload for FR-026)

Implementations MAY add a top-level or nested object so the Try skills gateway can render one request:

```json
{
  "graph_generation": 3,
  "skills_loaded_count": 42,
  "skills_merged_at": "2026-03-26T12:00:00Z",
  "catalog_cache_generation": 3,
  "last_built_catalog_generation": 3,
  "sync_status": "in_sync"
}
```

| `sync_status` value | Meaning |
|---------------------|---------|
| `in_sync` | Catalog cache generation matches supervisor build (per implementation rule above). |
| `supervisor_stale` | Cache generation is ahead of what the last graph build used; user should trigger **POST /skills/refresh** or wait for automatic rebuild. |
| `unknown` | Insufficient data (e.g. field not implemented yet) or ambiguous multi-instance deployment. |

**UI**: Try skills gateway MUST show human-readable labels (e.g. “In sync”, “Supervisor stale — refresh skills”, “Status unavailable”) per spec FR-026.

---

## Catalog refresh → supervisor (FR-012)

**Method**: `POST`  
**Path**: `/skills/refresh` (Python router; may be proxied as `/api/skills/refresh` from UI)

### Required behavior (spec)

1. Invalidate merged-skills **cache** (existing).
2. **Trigger supervisor reload**: either call into a registered callback that runs `AIPlatformEngineerMAS._rebuild_graph()` (or equivalent that re-runs `_build_graph()`), **or** document a single coordinated endpoint that performs both steps. Spec: cache-only refresh without updating the MAS snapshot is **incomplete** for FR-012 / FR-016.

### Response

```json
{
  "status": "ok",
  "message": "Skills cache invalidated",
  "graph_generation": 3,
  "skills_loaded_count": 42
}
```

Optional fields after successful rebuild: `graph_generation`, `skills_loaded_count` so the client can confirm without a second GET.

---

## UI expectations

- Admin or settings panel may show “Supervisor skills: **N** skills, graph gen **G**, last merge **T**.”
- After user clicks “Refresh skills” or completes hub onboarding, UI calls refresh endpoint and **re-fetches status** (or uses response body) to confirm alignment (SC-007).

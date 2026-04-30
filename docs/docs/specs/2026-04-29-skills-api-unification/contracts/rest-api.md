# HTTP Contract: Skills (Unified)

**Audience**: CAIPE UI, automation scripts, gateway consumers.  
**Auth**: Existing session/JWT patterns via `withAuth` unless noted.

## Principles

- **Catalog** and **persisted config** are different resources (FR-002).
- **Breaking change**: `/api/agent-skills` family **removed** after migration (FR-010).

## Catalog (unchanged purpose)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skills` | Merged skill catalog for browse (not CRUD list of raw Mongo docs). |

Query/response shape: **unchanged** from current implementation.

## Persisted skill configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skills/configs` | List/filter persisted configs (team/global as today). |
| POST | `/api/skills/configs` | Create config. |
| GET | `/api/skills/configs?id={id}` | Get one (if supported today). |
| PUT | `/api/skills/configs` | Update (body includes id). |
| DELETE | `/api/skills/configs?id={id}` | Delete. |

Request/response bodies: align with current **`AgentSkill`**, **`CreateAgentSkillInput`**, and **`UpdateAgentSkillInput`** types.

**Legacy mapping**: Same semantics as former `/api/agent-skills`.

## Supporting routes (moved base path)

| Method | Path | Description |
|--------|------|-------------|
| GET, POST | `/api/skills/seed` | Template seeding / preview (admin flows as today). |
| POST | `/api/skills/generate` | AI-assisted SKILL generation (dynamic-agents proxy). |
| POST | `/api/skills/import-github` | GitHub ancillary import. |

## Template import (new)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/skills/templates/import` | Import selected packaged templates as **system** rows. |

**Request body (JSON)**:

```json
{
  "template_ids": ["incident-postmortem-report"],
  "import_all": false
}
```

- `template_ids`: optional list of template source ids.
- `import_all`: if true, import all known packaged templates (use with care).

**Response (illustrative)**:

```json
{
  "imported": [{ "id": "skill-incident-postmortem-report-a1b2c3", "template_source_id": "incident-postmortem-report" }],
  "skipped": [{ "template_source_id": "incident-postmortem-report", "reason": "already_imported" }],
  "errors": []
}
```

Exact envelope should match existing API success/error helpers.

## Gateway artifacts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skills/bootstrap` | Bootstrap markdown / snippet for IDE hooks. |
| GET | `/api/skills/install.sh` | Shell installer (advanced bulk path documented second). |

## Supervisor (unchanged endpoints; called by UI)

- `POST {SUPERVISOR}/skills/refresh?include_hubs=false` — after config writes.
- `POST {SUPERVISOR}/skills/scan-content` — optional scan on save.

These are not part of Next.js `/api/skills` but are part of the end-to-end skills feature.

---

## Planned (not yet implemented): Scanner jobs, hub scan, quarantine (FR-011–FR-016)

These endpoints and query parameters are **specified** in [spec.md](../spec.md) for future implementation. They are documented here so clients and the 097 data model stay aligned.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/skills?scan_status=…&quarantine=…` | Filter merged catalog by `scan_status` and quarantine policy (when implemented). |
| POST | `/api/skills/scan-jobs` | Start async hub or catalog scan job. |
| GET | `/api/skills/scan-jobs/:id` | Poll job status and summary. |
| POST | `/api/skills/scan-jobs/:id/cancel` | Cancel a running job. |
| GET | `/api/skills/quarantine-policy` | Read effective quarantine policy. |
| PUT | `/api/skills/quarantine-policy` | Update policy (admin). |
| POST | `/api/skills/re-scan` | Re-run scan for a skill or hub subset. |

**Supervisor (planned)**: `GET {SUPERVISOR}/skills/scan-jobs/:id`, `POST {SUPERVISOR}/skills/re-scan` — mirror or proxy as needed when jobs run server-side.

See also [data-model.md](../data-model.md) § Scan jobs and Quarantine policy.

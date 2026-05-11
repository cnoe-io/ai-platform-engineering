# Implementation Plan: Unified Skills API & Gateway

**Spec**: [spec.md](./spec.md)  
**Audience**: Engineers implementing the feature.  
**Decisions locked**: Reuse Mongo collection `agent_skills`; template import **system-only**; auto-seed **at most one** example; deterministic ID suffix = **first 6 hex chars** of SHA-256(template_source_id + `:` + `system`); no new git worktree (use existing branch).

---

## 1. Technical context

| Area | Choice |
|------|--------|
| UI | Next.js App Router, `route.ts` handlers |
| Persisted skills | MongoDB collection **`agent_skills`** (unchanged name) |
| Catalog merge | `GET /api/skills` + supervisor `/skills`; local aggregate in UI when proxy unavailable |
| Packaged templates | `charts/.../data/skills/<folder>/SKILL.md` + `metadata.json` via `loadSkillTemplatesInternal()` |
| Gateway | `/api/skills/bootstrap`, `/api/skills/install.sh`, `TrySkillsGateway.tsx` |
| Hash | Node `crypto.createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 6)` |

---

## 2. API target map (replace `/api/agent-skills`)

| Legacy | New |
|--------|-----|
| `GET/POST/PUT/DELETE` `/api/agent-skills` | `GET/POST/PUT/DELETE` `/api/skills/configs` (same query/body semantics) |
| `GET/POST` `/api/agent-skills/seed` | `GET/POST` `/api/skills/seed` |
| `POST` `/api/agent-skills/generate` | `POST` `/api/skills/generate` |
| `POST` `/api/agent-skills/import-github` | `POST` `/api/skills/import-github` |
| *(new)* | `POST` `/api/skills/templates/import` — body `{ template_ids?: string[], import_all?: boolean }` |

**Keep**: `GET /api/skills` — catalog only; do not overload with CRUD.

**Delete**: `ui/src/app/api/agent-skills/**` after migration.

**Shared server helpers**: e.g. `lib/server/assistant-suggest-da.ts` for generate; optional `lib/server/skill-configs.ts` for Mongo CRUD reused by configs route.

---

## 3. ID generation for template import

```text
slug      = kebab-case from template folder id or name (sanitize)
payload   = `${templateSourceId}:system`
suffix    = sha256(payload).hex.slice(0, 6)   // 6 hex chars
id        = `skill-${slug}-${suffix}`
```

**Dedup**: `findOne({ 'metadata.template_source_id': templateSourceId, is_system: true })` → skip insert.

**Metadata**: `metadata.template_source_id`, `metadata.import_kind: 'helm_template_v1'`, `is_system: true`, `owner_id: 'system'`.

---

## 4. Auto-seed: only one example

- **Designate** one template id (e.g. `incident-postmortem-report`) as `EXAMPLE_TEMPLATE_ID` (env `SKILLS_AUTO_SEED_TEMPLATE_ID` with default).
- On first gallery load (or dedicated init): if Mongo configured and **no** system doc with `metadata.template_source_id === EXAMPLE_TEMPLATE_ID`, insert **one** row using same ID formula as template import (or raw template id if product prefers stable `skill-incident-postmortem-report-<6hex>`).
- **Do not** auto-run full `seedTemplatesFromDisk()` for all templates.

---

## 5. Phased implementation

### Phase A — Route move (breaking)

1. Add `app/api/skills/configs/route.ts` (copy from `agent-skills/route.ts`, adjust comments).
2. Move `seed`, `generate`, `import-github` under `app/api/skills/`.
3. Add `app/api/skills/templates/import/route.ts` (POST) implementing hash + dedup + `templateToAgentSkill` reuse from seed logic.
4. Update all `fetch('/api/agent-skills...')` → new paths (store, editor, chat, tests).
5. Remove `app/api/agent-skills/**`.
6. Grep + `npm run lint` + `npm test` in `ui/`.

### Phase B — Template import UI

1. Skills Gallery (or admin): button **“Import packaged templates”** → modal listing templates from `GET /api/skill-templates` or new `GET /api/skills/templates` (read-only list) — **decision**: reuse existing skill-templates endpoint or inline list in import modal via fetch.
2. POST selected ids to `/api/skills/templates/import`.
3. Toast: seeded / skipped / errors.

### Phase C — Auto-seed narrow

1. Change `agent-skills-store` `loadSkills` / `seedTemplates`: only run **single-example** path, not full seed.
2. Optionally narrow `POST /api/skills/seed` to admin-only or deprecate in favor of import + one-example auto.

### Phase D — Gateway (TrySkillsGateway + bootstrap + install.sh)

1. Update `FALLBACK_TEMPLATE` in `bootstrap/route.ts` and chart `bootstrap.md` if present: **primary** = live `GET` catalog with auth header; **advanced** = bulk/install.sh.
2. `install.sh`: comment order + ensure bulk mode is clearly secondary.
3. `TrySkillsGateway.tsx`: reorder sections / labels per spec FR-009.

### Phase E — Default skill content (partially done)

- **Done**: `charts/.../data/skills/incident-postmortem-report/` (real SKILL.md).
- Verify loader picks it up; document in release notes.

### Phase F — Docs & comms

- PR body: breaking URL table; Mongo unchanged; 6-hex suffix; system import only.
- Update `097-*` file path references from `agent-skills/route.ts` → `skills/configs/route.ts` where they mention file paths.

---

## 5.5 Next.js route matrix (unified UI API)

| User story | HTTP | Path | Handler (relative to `ui/src/app/api/`) |
|------------|------|------|----------------------------------------|
| US1 | * | * | **`agent-skills/` removed** — use `skills/configs/route.ts` for CRUD. |
| US2 | POST | `/api/skills/templates/import` | `skills/templates/import/route.ts` |
| US3 | POST | `/api/skills/seed` | `skills/seed/route.ts` (narrow seed) |
| US3 | POST | `/api/skills/generate` | `skills/generate/route.ts` |
| US3 | POST | `/api/skills/import-github` | `skills/import-github/route.ts` |
| US4 | GET | `/api/skills/configs` | `skills/configs/route.ts` |
| US4 | POST/PUT/DELETE | `/api/skills/configs` | same |
| US4 | GET | `/api/skills` | `skills/route.ts` (merged catalog) |
| US5 (planned) | GET | `/api/skills?scan_status=…` | `skills/route.ts` (filters TBD) |
| US5 (planned) | POST | `/api/skills/scan-jobs` | TBD |
| Polish | POST | `/api/skills/generate` | `skills/generate/route.ts` (Skills AI Assist; uses `assistant-suggest-da.ts`) |
| Polish | POST | `/api/dynamic-agents/assistant/suggest` | `dynamic-agents/assistant/suggest/route.ts` (direct proxy) |

### Scanner / quarantine mapping (FR-015 cross-check with 097)

| This spec (FR) | 097 reference |
|------------------|---------------|
| FR-013–FR-016 quarantine / catalog visibility | **FR-027** (`scan_status`, strict gate, catalog loader exclusion) |
| Per-save scan | **FR-027** synchronous scan on configs save when `skill_content` present |
| Stored findings | **`skill_scan_findings`** collection ([097 data-model](../097-skills-middleware-integration/data-model.md)) |

---

## 6. Verification checklist

- [ ] No remaining `fetch` to `/api/agent-skills` in `ui/src`.
- [ ] Import twice → second request **0** new inserts for same templates.
- [ ] IDs match `skill-{slug}-{6hex}` pattern.
- [ ] Fresh env: auto path creates **≤1** example.
- [ ] `GET /api/skills` still returns catalog JSON shape.
- [ ] Supervisor refresh still triggered on config write.
- [ ] Gateway copy: live catalog first.

---

## 7. Rollback

- Revert PR; restore `agent-skills` routes from git history if needed.

---

## 8. Out of scope (this plan)

- Mongo collection rename.
- Changing catalog `source` string values in JSON.

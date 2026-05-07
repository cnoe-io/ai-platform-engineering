# Contract: Skill Scanner Pipeline (Skill Scanner by Cisco AI Defense)

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-28

## Overview

Integrate **[Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner)** **provided by Cisco AI Defense** (or an approved wrapper) per FR-023, FR-027, and SC-009/SC-011. Scanner is **best-effort**; **no findings does not prove safety** ([upstream scope and limitations](https://github.com/cisco-ai-defense/skill-scanner)).

## Third-party attribution (normative, FR-023)

Wherever the product **names** the scanner (admin hub/skill scan UI, settings copy, internal docs shipped with the product):

1. State that security scanning uses **Skill Scanner** **provided by Cisco AI Defense**.
2. Include the repository link **https://github.com/cisco-ai-defense/skill-scanner** (may be a markdown or anchor link).
3. Keep the disclaimer: results are **best-effort** and do not guarantee security.

Repository **NOTICE** or **THIRD_PARTY_NOTICES** (if the project uses them) SHOULD list **Skill Scanner** / **cisco-ai-skill-scanner** with the same URL and Apache-2.0 license reference per upstream **LICENSE**.

---

## When to run

| Trigger | Scope |
|---------|--------|
| Hub ingest / refresh | After fetching SKILL.md set from GitHub hub, before merging into catalog cache (or before marking hub "healthy"). |
| Agent-skills save/publish (FR-027) | **Synchronously** when a user creates or updates an agent-skills document with `skill_content`. Scanner runs against the single skill body; result sets `scan_status` on the document (`passed` / `flagged` / `unscanned`). Under `SKILL_SCANNER_GATE=strict`, flagged documents are excluded from the merged catalog. |
| Default / packaged skills | CI job or release pipeline on `SKILLS_DIR` / packaged skills (where feasible). |
| On-demand (optional) | Admin "Rescan hub" action. |

---

## Inputs

- Path or in-memory directory containing skill files (SKILL.md + referenced scripts for behavioral mode if enabled).
- Policy: preset (`balanced` / `strict`) or org YAML path (product decision).

---

## Outputs

- Structured findings: `severity` (e.g. critical, high, medium, low, info), `rule_id`, `path`, `message` (sanitized).
- Persist **skill_scan_findings** (see data-model) associated with `hub_id` (hub ingest) or agent-skills document id as `source_id` (when `source_type: "agent_skills"`), via `source_type` + `source_id`, and content hash or revision.

---

## Environment

| Variable | Values | Purpose |
|----------|--------|---------|
| `SKILL_SCANNER_GATE` | `warn` (default) \| `strict` | `strict` enables failing ingest/save on configured severity (e.g. high+) when combined with `SKILL_SCANNER_FAIL_ON` or script defaults. For agent-skills saves, `strict` causes flagged documents to be excluded from the merged catalog (FR-027). |
| `SKILL_SCANNER_POLICY` | `balanced` \| `strict` \| `permissive` | Passed to skill-scanner `--policy` where supported. |
| `SKILL_SCANNER_FAIL_ON` | e.g. `high`, `critical` | Optional explicit `--fail-on-severity` for CI/scripts. |

## Gate policy (documented default)

**Default recommendation**: **Warn-only** for high in v1 UI (do not silently drop); **block** on critical OR block high+critical in `strict` mode.

- On **block** (hub ingest): do not add new revision to merged catalog; surface error to admin with finding summary.
- On **block** (agent-skills save, FR-027): document is always persisted but marked `scan_status: "flagged"`; excluded from merged catalog under `SKILL_SCANNER_GATE=strict` until remediated.
- On **warn**: merge allowed; admin UI shows badge on hub/skill row.

---

## Operational constraints

- Optional LLM-based analyzers require API keys; **CI** may run static/YARA/pipeline/behavioral only unless secrets are provisioned.
- Do not log full skill bodies or API keys; redact paths if they contain secrets.

---

## Admin UI

- Hub detail or skills admin: show last scan time, max severity, link to detail list.
- Copy in UI: "Scanner results are best-effort and do not guarantee security."
- **Attribution** (footer or "About scanning"): e.g. "Skill scanning uses [Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner), provided by **Cisco AI Defense**."

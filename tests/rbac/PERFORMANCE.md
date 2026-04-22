# RBAC test suite — performance baseline

Spec [102 — Comprehensive RBAC tests & completion](../../docs/docs/specs/102-comprehensive-rbac-tests-and-completion/),
task **T062**, success-criterion **SC-008**.

> SC-008: a developer running `make test-rbac` on a current-gen laptop sees the
> result inside **10 minutes** for the cheap lane, and inside **30 minutes** for
> the full Docker stack. If we ever regress past these limits, file a Phase 11
> task and add `--workers=4` (or higher) to the Playwright config.

## Methodology

- Hardware: M-series Mac (developer laptop)
- Repo state: `prebuild/feat/comprehensive-rbac` after T060 wiring
- Stack: Phase 4 — only Phase 3 (Admin UI) routes are migrated; everything else
  is `migration_status: pending` so the matrix-driver `xit()`s those rows.
- Command: `/usr/bin/time -p make test-rbac` (no Docker stack, `RBAC_E2E` unset)
- The "cheap lane" runs the same three targets CI runs on every PR
  (`test-rbac-lint` → `test-rbac-pytest` → `test-rbac-jest`) and intentionally
  skips the Playwright Docker lane.

## Cheap lane — `make test-rbac` without `RBAC_E2E=1`

| Date       | Wall-clock | User CPU | Sys CPU | Notes                                              |
|------------|------------|----------|---------|----------------------------------------------------|
| 2026-04-22 | **6.22 s** | 3.24 s   | 1.46 s  | Phase 4 baseline. 72 jest assertions + 29 pytest.  |

Breakdown of what ran:

- **Lint** — `validate-rbac-matrix.py` (146 entries scanned), `validate-realm-config.py`
  (3 new resources cross-checked), `check-no-new-requireAdmin.sh` (32 legacy
  call sites covered by 49 `pending` matrix entries — all OK).
- **Pytest** — 564 collected, 29 passed, 535 skipped (Python surfaces are still
  `pending`, so the matrix-driver xfails them; helper-unit tests pass live).
- **Jest** — 546 collected, 72 passed, 474 skipped (UI BFF routes that haven't
  migrated yet are auto-`xit()`'d via `migration_status: pending`).

The 6 s number is for warm caches. A cold run (no `node_modules`, no `uv`
metadata cache) takes around **45–60 s**, dominated by `npm install` /
`uv sync`. CI hits the cold path once per workflow run.

## Full lane — `RBAC_E2E=1 make test-rbac`

Not yet recorded. Phase 4 only ships the cheap lane and the e2e plumbing
(playwright config, persona fixtures, story-1 + story-7 specs, label-gated
GitHub Actions workflow). The first full timing will be recorded as part of
**T125** ("update PERFORMANCE.md after Phase 5–9 specs land") so we capture a
realistic number with all 8 surfaces migrated.

Anticipated upper bound: **15–20 min** with the default 4 Playwright workers,
based on per-route latency observations from the helper-unit Keycloak round-trip
(~50 ms p50 against the docker-compose Keycloak). If we hit 25 min, file a
Phase 11 polish task to bump workers and split `story-7` into a separate job.

## How to re-run

```bash
# Cheap lane (no Docker)
/usr/bin/time -p make test-rbac

# Full lane (requires docker; brings up Keycloak+stack via test-rbac-up)
RBAC_E2E=1 RBAC_LINT_STRICT=1 /usr/bin/time -p make test-rbac
```

Append a new row to the table above whenever you run a fresh measurement —
keeping a chronological log here makes regressions obvious.

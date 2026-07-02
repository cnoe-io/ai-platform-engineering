# Implementation Plan: Configurable Audit Log Storage Backend

**Branch**: `2026-06-18-audit-logs-local-storage` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)

## Summary

Introduce a pluggable `AuditBackend` abstraction in both the Python backend and the Next.js BFF. Wire it into every audit write-path so a single env-var (`AUDIT_LOG_BACKEND`) redirects all audit events to local-disk (NDJSON files) or S3-compatible object storage (NDJSON+gzip), while leaving `mongodb` (the default) fully unchanged.

## Technical Context

**Language/Version**: Python 3.11+, TypeScript (Next.js 14 App Router)
**Primary Dependencies**: pymongo (existing), boto3 (new, S3 Python), `@aws-sdk/client-s3` (new, S3 TypeScript), Node.js `fs/promises` (local TypeScript)
**Storage**: MongoDB (existing default), local filesystem, S3-compatible object storage
**Testing**: pytest (Python), Jest (TypeScript)
**Target Platform**: Linux server (Docker/Kubernetes)
**Project Type**: web-service (backend + BFF)
**Performance Goals**: Audit writes ≤ 5 ms added p99 latency (fire-and-forget, non-blocking)
**Constraints**: Zero regression when `AUDIT_LOG_BACKEND` is unset; no breaking changes to public APIs
**Scale/Scope**: Low write volume today (dev environment); designed for production S3 ingestion rates

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Simplicity of implementation | PASS | Thin protocol + 3 concrete backends; no over-abstraction |
| YAGNI | PASS | No speculative backends beyond `mongodb`/`local`/`s3` |
| Composition over inheritance | PASS | Protocol (duck-typing Python) + interface (TypeScript); no class hierarchy |
| Security by default | PASS | No secrets in files; S3 credentials via env; local path never logged with content |
| CI gates non-negotiable | PASS | All existing tests must keep passing; new backends get unit tests |
| No implementation details in spec | PASS | Spec is technology-agnostic |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-06-18-audit-logs-local-storage/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── contracts/           ← Phase 1 output (env-var contract)
├── db-migration.md      ← Phase 1 output (MongoDB no-op note)
└── tasks.md             ← Phase 2 output (/speckit.tasks)
```

### Source Code

```text
# Python backend
ai_platform_engineering/utils/
├── audit_logger.py           ← MODIFY: swap _persist_to_mongo() for backend.write()
├── audit_backend.py          ← NEW: AuditBackend protocol + factory (get_audit_backend())
├── audit_backends/
│   ├── __init__.py           ← NEW
│   ├── mongo_backend.py      ← NEW: extracted from audit_logger._persist_to_mongo
│   ├── local_backend.py      ← NEW: NDJSON file writer
│   └── s3_backend.py         ← NEW: buffered NDJSON+gzip S3 uploader
└── audit_callback.py         ← NO CHANGE (calls log_audit_event, already abstracted)

# Next.js BFF
ui/src/lib/audit/
├── backend.ts                ← NEW: AuditBackend interface + factory (getAuditBackend())
├── backends/
│   ├── mongo-backend.ts      ← NEW: extracted from rbac/audit.ts persists
│   ├── local-backend.ts      ← NEW: NDJSON file writer (fs/promises)
│   └── s3-backend.ts         ← NEW: buffered NDJSON+gzip S3 uploader
└── index.ts                  ← NEW: re-exports

ui/src/lib/rbac/
└── audit.ts                  ← MODIFY: replace persistAuthzDecisionToMongo +
                                         persistToUnifiedAuditEvents with backend.write()

ui/src/lib/credentials/
└── audit.ts                  ← MODIFY: replace direct getCollection() with backend.write()

# Tests
tests/
├── test_audit_backend.py     ← NEW: unit tests for all Python backends
└── test_audit_logger.py      ← MODIFY: verify backend is called, not MongoDB directly

ui/src/lib/audit/__tests__/
├── backend.test.ts           ← NEW: factory + all TS backends
└── local-backend.test.ts     ← NEW: file creation, append, error handling
```

## Database migrations

`db-migration.md` — this feature does NOT add, remove, or alter any MongoDB schema. Existing `audit_events` and `authorization_decision_records` collections are unchanged. When a non-MongoDB backend is selected, those collections simply receive no new writes. No DDL, index creation, or data movement is required for this feature.

## Phase 0: Research

→ See [research.md](./research.md)

Key decisions resolved in research:

1. **File format**: NDJSON (one JSON event per line) with gzip compression for S3. Parquet deferred (needs schema registry and adds a heavy dependency; NDJSON is readable, grep-able, and sufficient for cost control via S3 lifecycle policies).

2. **Python S3 client**: `boto3` — already a transitive dependency in many agent integrations; standard choice. Credentials via standard AWS env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`) or workload identity.

3. **TypeScript S3 client**: `@aws-sdk/client-s3` v3 — modular, tree-shakeable, standard for Next.js. Same credential chain as boto3.

4. **S3 flush strategy**: Per-event upload (simplest; avoids in-memory buffer complexity for low-volume dev). Buffering/batching is a follow-on once we have production volume data. Fire-and-forget keeps latency below 5 ms added.

5. **Local file strategy**: One NDJSON file per (date, event-type, process). Append-mode writes. File created on first write if absent. No rotation (rotation is a follow-on if needed).

6. **Dual-write consolidation (TypeScript)**: Currently `rbac/audit.ts` writes to TWO collections (`authorization_decision_records` + `audit_events`). The new backend receives ONE call per event (the unified `audit_events` shape). The legacy `authorization_decision_records` dual-write is dropped when a non-MongoDB backend is active.

7. **Backend singleton**: Created once at module load time (Python: module-level `_BACKEND` singleton with thread-safe lazy init; TypeScript: module-level `let _backend` singleton).

## Phase 1: Design & Contracts

### AuditBackend interface

**Python** (`audit_backend.py`):

```python
from typing import Any, Dict, Protocol, runtime_checkable

@runtime_checkable
class AuditBackend(Protocol):
    def write(self, event: Dict[str, Any]) -> None:
        """Fire-and-forget write. Must never raise; log errors internally."""
        ...

def get_audit_backend() -> AuditBackend:
    """Return the process-wide singleton backend (created once at first call)."""
    ...
```

**TypeScript** (`ui/src/lib/audit/backend.ts`):

```typescript
export interface AuditBackend {
  write(event: Record<string, unknown>): void; // fire-and-forget, never throws
}

export function getAuditBackend(): AuditBackend { ... }
```

### Environment variables (contract)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUDIT_LOG_BACKEND` | No | `mongodb` | Active backend: `mongodb`, `local`, `s3` |
| `AUDIT_LOG_LOCAL_PATH` | When `local` | `./audit-logs` | Directory for NDJSON files |
| `AUDIT_LOG_S3_BUCKET` | When `s3` | — | S3 bucket name |
| `AUDIT_LOG_S3_PREFIX` | When `s3` | `audit` | S3 key prefix |
| `AUDIT_LOG_S3_REGION` | When `s3` | `us-east-1` | AWS region |
| `AWS_ACCESS_KEY_ID` | Static key auth only | — | Standard AWS credentials (dev/CI) |
| `AWS_SECRET_ACCESS_KEY` | Static key auth only | — | Standard AWS credentials (dev/CI) |
| `AWS_ROLE_ARN` + `AWS_WEB_IDENTITY_TOKEN_FILE` | IRSA (EKS) | — | Injected by EKS pod identity webhook; picked up automatically by boto3 / aws-sdk |

### File/object key format

**Local disk**: `<AUDIT_LOG_LOCAL_PATH>/YYYY/MM/DD/<event_type>-<YYYYMMDD>-<uuid>.ndjson`

**S3**: `<AUDIT_LOG_S3_PREFIX>/YYYY/MM/DD/<event_type>-<YYYYMMDDTHHMMSS>-<uuid>.ndjson.gz`

### Write-path changes (minimal surgery)

**Python** — `audit_logger.py`:

```python
# Before
def log_audit_event(...):
    ...
    _persist_to_mongo(event)   # direct MongoDB call
    return event

# After
def log_audit_event(...):
    ...
    get_audit_backend().write(event)   # backend abstraction
    return event
```

**TypeScript** — `ui/src/lib/rbac/audit.ts`:

```typescript
// Before
persistAuthzDecisionToMongo(event);
persistToUnifiedAuditEvents(event, params.email, ...);

// After
getAuditBackend().write({ ...event, user_email: params.email, type, source });
```

`ui/src/lib/credentials/audit.ts` gets the same treatment: replace `getCollection()` insert with `getAuditBackend().write(...)`.

## Complexity Tracking

No constitution violations.

## Implementation Notes

- `local_backend.py` / `local-backend.ts`: use `os.makedirs(exist_ok=True)` / `fs.mkdir({recursive:true})` before first write. Open in append mode. Catch and log all IO errors; do not propagate.
- `s3_backend.py` / `s3-backend.ts`: construct key from current UTC time + `uuid4()`. Use gzip compression in-memory before PUT. Catch and log all S3 errors; do not propagate.
- `mongo_backend.py` / `mongo-backend.ts`: extracted verbatim from existing `_persist_to_mongo` / `persistAuthzDecisionToMongo` + `persistToUnifiedAuditEvents`; no logic change.
- At startup, log: `[audit] backend=local path=/audit-logs` (or `backend=s3 bucket=my-bucket prefix=audit` or `backend=mongodb`). Never log S3 credentials.
- Invalid `AUDIT_LOG_BACKEND` value: raise `ValueError` / throw `Error` at factory call time (startup fail-fast, not silent fallback).

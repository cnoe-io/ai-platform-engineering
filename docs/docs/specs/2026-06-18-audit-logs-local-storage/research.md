# Research: Configurable Audit Log Storage Backend

## Decision 1: File format for local and S3 backends

**Decision**: NDJSON (Newline-Delimited JSON), gzip-compressed for S3

**Rationale**: NDJSON is a line-per-event format that is trivially readable with `cat`, `grep`, `jq`. It maps 1:1 to the existing event dict shape with zero schema ceremony. For S3, gzip reduces storage cost and is natively decompressed by S3 Select and most analytics tools. Parquet was mentioned in the issue but requires a schema registry (pyarrow/fastparquet), adds ~30 MB to the image, and buys nothing until we run analytics queries at scale.

**Alternatives considered**:
- Parquet: better columnar analytics, heavier dependency, premature for current volume
- JSON-per-file: one file per event is worst-case for S3 API costs
- CSV: lossy for nested fields; poor for optional keys

---

## Decision 2: Python S3 client

**Decision**: `boto3` (standard AWS SDK for Python)

**Rationale**: Already a transitive dependency through other platform integrations (e.g., ArgoCD/S3 tooling). Supports all S3-compatible endpoints (MinIO, GCS S3 interop) via `endpoint_url`. Credential chain is standard (env vars → instance role → EKS IRSA).

**Alternatives considered**:
- `aiobotocore`: async, but audit writes are fire-and-forget on a thread — no benefit, more complexity
- `s3transfer`: higher-level but overkill for single-object PUTs

---

## Decision 3: TypeScript S3 client

**Decision**: `@aws-sdk/client-s3` v3

**Rationale**: Modular v3 SDK; only imports the S3 command classes needed. Tree-shaken in Next.js builds. Same credential chain as boto3. Standard choice for Next.js on AWS.

**Alternatives considered**:
- `aws-sdk` v2: monolithic, larger bundle, deprecated upstream
- `minio` JS SDK: works only with MinIO, not AWS S3

---

## Decision 4: S3 flush strategy

**Decision**: Per-event upload (one PUT per audit event)

**Rationale**: Current audit volume is low (dev environment, lightly used). Per-event PUTs are simpler — no buffer management, no data loss on crash, no timer goroutines. S3 PUT costs at this volume are negligible. Batching/buffering is a follow-on once production volume is measured.

**Alternatives considered**:
- In-memory buffer + flush on interval: more complex, risks losing buffered events on pod restart
- In-memory buffer + flush on size threshold: same risk, no advantage at low volume

---

## Decision 5: Backend singleton lifetime

**Decision**: Module-level singleton, initialized on first call (lazy) with double-checked locking in Python

**Rationale**: Both Python and TypeScript module systems execute module initialization once per process. A module-level singleton avoids re-reading env vars on every write and matches existing patterns in `mongodb_client.py` and `mongodb.ts`. Python needs a lock because `log_audit_event` can be called from multiple threads.

---

## Decision 6: Dual-write consolidation (TypeScript)

**Decision**: Drop `authorization_decision_records` dual-write when non-MongoDB backend is active; keep only the unified `audit_events` shape

**Rationale**: `authorization_decision_records` is a legacy collection that predates the unified schema. The new backends write a single event stream using the unified shape (with `type` field). When MongoDB is the backend, the existing dual-write is preserved to avoid any regression for operators who query that collection directly.

**Alternatives considered**:
- Keep dual-write for all backends: non-MongoDB backends would need to mimic two separate collection writes, adding complexity with no benefit (they're reading from a unified stream anyway)

---

## Decision 7: Credential audit in TypeScript

**Decision**: `ui/src/lib/credentials/audit.ts` → `writeCredentialAuditEvent()` is also routed through the backend abstraction

**Rationale**: It currently calls `getCollection('credential_audit_events').insertOne(...)`. This is a separate MongoDB collection that also needs to move off MongoDB. The event shape is slightly different but compatible with the backend's `write(event: Record<string, unknown>)` signature.

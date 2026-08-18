"""Pydantic models for audit ingest and query responses."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class AuditEvent(BaseModel):
    """Flexible audit event model.

    The service preserves unknown fields so UI, bridge, and agent producers can
    evolve without a collector deploy for every new audit attribute.
    """

    model_config = ConfigDict(extra="allow")

    audit_event_id: str | None = None
    ts: datetime | str | None = None
    type: str | None = None
    tenant_id: str | None = None
    subject_hash: str | None = None
    subject_ref: str | None = None
    actor_ref: str | None = None
    action: str | None = None
    outcome: str | None = None
    reason_code: str | None = None
    correlation_id: str | None = None
    component: str | None = None
    resource_ref: str | None = None
    pdp: str | None = None
    source: str | None = None

    # Normalized caipe-authz envelope. Legacy producers continue using the
    # flat fields above during migration.
    event_id: str | None = None
    event_type: str | None = None
    occurred_at: datetime | str | None = None
    producer: str | None = None
    schema_version: str | None = None
    payload: dict[str, Any] | None = None

    def to_record(self) -> dict[str, Any]:
        record = self.model_dump(mode="json", exclude_none=True)
        if self.event_id and self.event_type:
            envelope_fields = {
                "event_id",
                "event_type",
                "occurred_at",
                "producer",
                "schema_version",
                "payload",
            }
            extras = {key: value for key, value in record.items() if key not in envelope_fields}
            record = {
                **(self.payload or {}),
                **extras,
                "audit_event_id": self.event_id,
                "ts": self.occurred_at or utc_now_iso(),
                "type": self.event_type,
                "component": self.producer or "caipe-authz",
                "source": self.producer or "caipe-authz",
                "schema_version": self.schema_version or "1",
            }
            outcome = record.get("outcome")
            if isinstance(outcome, str):
                record["outcome"] = outcome.lower()
            elif self.event_type == "authz_migration_comparison":
                record["outcome"] = (
                    "success" if record.get("mismatch_class") in {None, "NONE"} else "error"
                )
            else:
                record["outcome"] = "error" if record.get("failure_reason") else "success"
            record.setdefault("tenant_id", "default")
            record.setdefault("subject_hash", record.get("actor_hash", "not-applicable"))
            record.setdefault("action", record.get("operation", self.event_type))
            if "provider" in record and "pdp" not in record:
                record["pdp"] = record["provider"]
            if self.event_type == "authz_migration_comparison":
                for evaluator in ("legacy", "authz"):
                    nested = record.pop(evaluator, None)
                    if not isinstance(nested, dict):
                        continue
                    outcome = nested.get("outcome")
                    if isinstance(outcome, str):
                        record[f"{evaluator}_outcome"] = outcome.lower()
                    for field in ("reason_code", "duration_ms", "error", "code"):
                        if field in nested:
                            record[f"{evaluator}_{field}"] = nested[field]
                scope = record.pop("scope", None)
                if isinstance(scope, dict):
                    for field in ("resource_type", "action"):
                        if field in scope and field not in record:
                            record[field] = scope[field]
        record.setdefault("audit_event_id", str(uuid4()))
        record.setdefault("ts", utc_now_iso())
        return record


class IngestResponse(BaseModel):
    accepted: int
    queued: int


class QueryResponse(BaseModel):
    records: list[dict[str, Any]]
    total: int
    limit: int
    truncated: bool = Field(description="True when matching rows exceeded limit.")

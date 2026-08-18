"""Bounded Prometheus metrics for authorization decisions and migrations."""

from prometheus_client import Counter, Gauge, Histogram

DECISIONS = Counter(
    "caipe_authz_decisions_total",
    "Canonical authorization decisions",
    ("surface", "resource_type", "action", "outcome", "reason_code", "authoritative_path"),
)
DECISION_DURATION = Histogram(
    "caipe_authz_decision_duration_seconds",
    "Canonical decision latency",
    ("surface", "transport", "authoritative_path"),
)
COMPARISONS = Counter(
    "caipe_authz_comparisons_total",
    "Legacy/Authz migration comparisons",
    ("surface", "resource_type", "action", "mismatch_class"),
)
OUTBOX_BACKLOG = Gauge(
    "caipe_authz_audit_outbox_records",
    "Pending authorization audit records",
)
ROLLOUT_REVISION = Gauge(
    "caipe_authz_rollout_revision_info",
    "Active rollout revision",
    ("revision",),
)
INSPECTION_REQUESTS = Counter(
    "caipe_authz_inspection_requests_total",
    "Privileged inspection calls",
    ("operation", "outcome"),
)

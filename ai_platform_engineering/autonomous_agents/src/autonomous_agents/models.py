"""Pydantic models for Autonomous Agents service."""

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

if TYPE_CHECKING:  # pragma: no cover - import-cycle break
    from autonomous_agents.services.preflight import Acknowledgement


class TriggerType(str, Enum):
    CRON = "cron"
    WEBHOOK = "webhook"
    INTERVAL = "interval"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


# =============================================================================
# Trigger definitions -
# =============================================================================

class CronTrigger(BaseModel):
    type: Literal[TriggerType.CRON] = TriggerType.CRON
    schedule: str = Field(..., description="Cron expression e.g. '0 9 * * *'")


class IntervalTrigger(BaseModel):
    type: Literal[TriggerType.INTERVAL] = TriggerType.INTERVAL
    seconds: int | None = None
    minutes: int | None = None
    hours: int | None = None

    @model_validator(mode="after")
    def require_positive_interval(self) -> "IntervalTrigger":
        invalid = [name for name, val in [("seconds", self.seconds), ("minutes", self.minutes), ("hours", self.hours)] if val is not None and val <= 0]
        if invalid:
            raise ValueError(f"IntervalTrigger fields must be positive integers: {', '.join(invalid)}")
        if not any([self.seconds, self.minutes, self.hours]):
            raise ValueError("IntervalTrigger requires at least one of seconds, minutes, or hours to be a positive integer")
        return self


class WebhookTrigger(BaseModel):
    type: Literal[TriggerType.WEBHOOK] = TriggerType.WEBHOOK
    secret: str | None = Field(None, description="Optional HMAC secret for payload validation")
    # Optional name of an HTTP header that uniquely identifies a delivery
    # (e.g. ``X-GitHub-Delivery``, ``X-PagerDuty-Webhook-Id``). When set
    # and present on the request, the dedup key for the
    # ``trigger_instances`` collection is derived from
    # ``f"{task_id}:hdr:{value}"``. When unset (or absent on a given
    # request) the dedup key falls back to the verified HMAC signature
    # we already compute for auth -- see
    # ``services.trigger_instances.derive_dedup_key`` for the full
    # precedence. Header names are matched case-insensitively per HTTP
    # convention; we normalise to whatever case the sender used in the
    # row's ``delivery_header_name`` field for audit clarity.
    dedup_header: str | None = Field(
        default=None,
        description=(
            "HTTP header name carrying a unique delivery id. When set and "
            "present, used as the dedup key for the trigger_instances "
            "collection so retries from the sender don't double-fire the "
            "task. Falls back to the HMAC signature when absent."
        ),
    )


Trigger = CronTrigger | IntervalTrigger | WebhookTrigger


# =============================================================================
# Task definition (loaded from YAML)
# =============================================================================

class TaskDefinition(BaseModel):
    id: str = Field(..., description="Unique task identifier")
    name: str = Field(..., description="Human-readable task name")
    description: str | None = None
    # Spec #099 FR-001 / OQ-1: ``agent`` is a *hint*, not a hard requirement.
    # When absent, the supervisor's LLM router picks a sub-agent from the
    # prompt at run time. Made optional in this revision so operators can
    # author tasks without knowing CAIPE's internal agent ids.
    # Empty-string and whitespace-only values are normalised to None by
    # ``a2a_client._normalize_agent_hint`` so they behave the same as a
    # missing field on the wire.
    agent: str | None = Field(
        default=None,
        description=(
            "Optional routing hint — sub-agent id (e.g. 'github', 'argocd'). "
            "When set, supervisor skips LLM routing and dispatches directly. "
            "When omitted, the supervisor's LLM picks a sub-agent based on "
            "the prompt."
        ),
    )
    # When set, scheduler + preflight target the dynamic-agents service
    # instead of the supervisor so the prompt actually executes through
    # the user's custom agent (its tools / system prompt / middleware).
    # Semantically mutually exclusive with `agent` (which names a CAIPE
    # MAS sub-agent). If both are set, ``dynamic_agent_id`` wins -- see
    # the validator below -- because the supervisor has no awareness of
    # dynamic-agent ids and would always preflight-fail them.
    dynamic_agent_id: str | None = Field(
        default=None,
        description=(
            "Dynamic-agents service agent id. When set, scheduler and "
            "preflight target the dynamic-agents service instead of the "
            "supervisor so the prompt runs through that custom agent's "
            "tools / system prompt / middleware."
        ),
    )
    prompt: str = Field(..., description="Prompt sent to the agent when this task fires")
    trigger: CronTrigger | IntervalTrigger | WebhookTrigger = Field(..., discriminator="type")
    llm_provider: str | None = Field(None, description="Override global LLM provider for this task")
    enabled: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)

    # Optional per-task overrides for the supervisor A2A call. When None,
    # the service-wide defaults from Settings (A2A_TIMEOUT_SECONDS /
    # A2A_MAX_RETRIES) apply. Useful for slow-running synthesis prompts
    # (raise the timeout) or for "best-effort, don't burn quota" tasks
    # (force max_retries=0).
    timeout_seconds: float | None = Field(
        default=None,
        gt=0,
        description="Override A2A_TIMEOUT_SECONDS for this task (seconds, > 0).",
    )
    max_retries: int | None = Field(
        default=None,
        ge=0,
        description="Override A2A_MAX_RETRIES for this task (>= 0; 0 disables retries).",
    )

    @field_validator("timeout_seconds")
    @classmethod
    def _timeout_must_be_finite(cls, v: float | None) -> float | None:
        # Pydantic's ``gt=0`` constraint accepts ``float('inf')`` and ``nan``,
        # and YAML/env parsing can happily produce those values too.
        # Either would silently break the httpx timeout at runtime, so reject
        # both at load time. ``Settings`` has the same guard for the global
        # default — keep them in lockstep.
        if v is None:
            return v
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError("timeout_seconds must be a finite number")
        return v

    @model_validator(mode="after")
    def _reconcile_agent_routing(self) -> "TaskDefinition":
        # ``agent`` (CAIPE MAS sub-agent hint -> supervisor) and
        # ``dynamic_agent_id`` (custom agent -> dynamic-agents service) are
        # semantically mutually exclusive: the supervisor can't honour a
        # dynamic-agent id, and the dynamic-agents service has no notion
        # of MAS sub-agent hints. If both arrive (e.g. a draft created
        # before this field existed and then re-stamped by the editor),
        # prefer the explicit dynamic-agent route and clear the legacy
        # hint so downstream branches stay unambiguous.
        if self.dynamic_agent_id and self.agent:
            import logging
            logging.getLogger("autonomous_agents").warning(
                "task %s has both agent=%r and dynamic_agent_id=%r; "
                "preferring dynamic_agent_id and dropping agent hint.",
                self.id, self.agent, self.dynamic_agent_id,
            )
            object.__setattr__(self, "agent", None)
        return self

    # ------------------------------------------------------------------
    # Pre-flight acknowledgement (spec #099, FR-002)
    # ------------------------------------------------------------------
    # Server-managed: the create/update routes scrub any client-supplied
    # value and overwrite this field with the result of the actual
    # preflight call to the supervisor. We declare the field as ``Any``
    # rather than typing it as ``Acknowledgement`` to avoid a circular
    # import (``services.preflight`` imports ``Settings``, which imports
    # this module). The TYPE_CHECKING import above gives editors the
    # real type for hover/auto-complete without paying the runtime cost.
    last_ack: Any | None = Field(
        default=None,
        description=(
            "Most recent supervisor pre-flight acknowledgement for this task. "
            "Server-managed; client-supplied values are ignored on POST/PUT."
        ),
    )


# =============================================================================
# Task run records (in-memory, can be backed by DB later)
# =============================================================================

class FollowUpContext(BaseModel):
    """Operator follow-up that re-fires an existing webhook task.

    Carries the bits the task-runtime LLM needs to keep the conversation
    going: who replied, what they said, and which prior run they are
    responding to. The chat-thread synthesiser uses ``parent_run_id`` to
    link the resulting TaskRun back to its originator so the UI can
    render a single timeline instead of two unrelated rows.
    """

    parent_run_id: str = Field(
        ..., description="run_id of the task run that this is a follow-up to"
    )
    user_text: str = Field(
        ..., description="Free-form follow-up text from the operator"
    )
    user_ref: str | None = Field(
        default=None,
        description=(
            "Stable identifier for the replier (e.g. Webex personEmail) -- "
            "used as a non-PII audit hint in chat history. Optional so "
            "non-Webex transports can omit it."
        ),
    )
    transport: str | None = Field(
        default=None,
        description=(
            "Name of the inbound bridge that produced this follow-up "
            "(e.g. 'webex'). Free-form so future bridges (slack, "
            "teams, ...) can reuse the field without a model bump."
        ),
    )


class TaskRun(BaseModel):
    run_id: str
    task_id: str
    task_name: str
    status: TaskStatus
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: datetime | None = None
    response_preview: str | None = None
    error: str | None = None
    # When this run was produced by a follow-up reply (e.g. the Webex
    # bot forwarding an in-thread message), this points at the run
    # the operator was replying to. Lets the UI render a single
    # threaded timeline instead of unrelated rows. ``None`` for the
    # original webhook fire and for cron / interval / manual runs.
    parent_run_id: str | None = None
    # IMP-13: id of the chat-history conversation that mirrors this
    # run, when publishing is enabled. Lets the UI deep-link from a
    # run row to ``/chat/<conversation_id>``. Optional and stable per
    # ``run_id`` (UUID5-derived) so the field is safe to leave unset
    # for runs from before publishing was turned on.
    conversation_id: str | None = None
    # When this run was kicked off by a webhook delivery, this is the
    # ``_id`` of the row in ``trigger_instances`` that recorded the
    # delivery. Lets audit tooling navigate from "what fired this run?"
    # back to the originating webhook payload metadata. ``None`` for
    # cron / interval / manual-trigger runs.
    trigger_instance_id: str | None = None
    # Spec #099 Phase B — full supervisor response and captured A2A
    # streaming events. Populated when the run uses the streaming code
    # path (``invoke_agent_streaming``); ``None`` / empty for legacy
    # blocking calls and for runs persisted before this field existed.
    # The chat-thread synthesiser in the UI replays ``events`` so past
    # scheduled fires render with the same plan + tools + timeline a
    # typed chat reply gets, rather than the 500-char ``response_preview``
    # tombstone. ``response_full`` is the same text that appears in the
    # final_result artifact, kept alongside the events as a cheap
    # convenience for callers (search, downstream formatters, audit
    # logs) that don't want to walk the events list.
    response_full: str | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)


# =============================================================================
# Webhook payload
# =============================================================================

class WebhookPayload(BaseModel):
    """Generic webhook payload — passed as context to the agent prompt."""
    source: str | None = None
    event: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)

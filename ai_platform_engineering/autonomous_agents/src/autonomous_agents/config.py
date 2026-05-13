"""Configuration settings for Autonomous Agents service."""

import json
from functools import lru_cache
from typing import Any, Self

from pydantic import AliasChoices, Field, PrivateAttr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_cors_string(raw: str | None) -> list[str]:
    """Parse ``CORS_ORIGINS`` / constructor value into a list of origins.

    Accepts: empty (no CORS), a JSON array string, or a comma-separated list.
    pydantic-settings must *not* bind this field as ``list[str]`` directly:
    an empty env var becomes ``""`` and the settings source calls
    ``json.loads("")`` before any field validator runs, which crashes startup.
    """
    if raw is None:
        return []
    s = str(raw).strip()
    if not s:
        return []
    if s.startswith("["):
        parsed = json.loads(s)
        if not isinstance(parsed, list):
            raise ValueError("CORS_ORIGINS JSON must be a JSON array of strings")
        return [str(x).strip() for x in parsed if str(x).strip()]
    return [origin.strip() for origin in s.split(",") if origin.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Server
    host: str = "0.0.0.0"
    port: int = 8002
    debug: bool = False

    # LLM (passed through to agents via A2A)
    llm_provider: str = "anthropic-claude"

    # Supervisor A2A endpoint — autonomous agents send tasks here
    supervisor_url: str = "http://localhost:8000"

    # Dynamic-agents
    dynamic_agents_url: str | None = None
    dynamic_agents_system_email: str = "autonomous@system"
    dynamic_agents_timeout_seconds: float = Field(default=300.0, gt=0)
    dynamic_agents_preflight_timeout_seconds: float = Field(
        default=10.0, gt=0
    )

    # A2A streaming call timeout (seconds) for the supervisor request.
    # Streaming calls can run for the full timeout; the circuit breaker's
    # stale-trial leak guard auto-derives from this so a healthy-but-slow
    # call isn't reclaimed mid-flight (see ``services/circuit_breaker.py``
    # ``get_circuit_breaker``). Overridable per task via ``timeout_seconds``.
    a2a_timeout_seconds: float = Field(default=300.0, gt=0)

    @field_validator(
        "a2a_timeout_seconds",
        "dynamic_agents_timeout_seconds",
        "dynamic_agents_preflight_timeout_seconds",
    )
    @classmethod
    def _reject_nonfinite(cls, v: float) -> float:
        # Pydantic happily accepts inf/nan from env vars cast to float;
        # both would silently break httpx (timeout) -- inf disables it,
        # nan compares false against everything. Sign / non-negative
        # bounds are enforced separately by the per-field ``gt=0`` /
        # ``ge=0`` constraints — this validator is *only* responsible
        # for the finiteness check.
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError("must be a finite number")
        return v

    # Global fallback HMAC secret for incoming webhooks. When a webhook
    # task has no per-task ``secret`` configured the router falls back
    # to this value so operators can rotate or supply secrets via a
    # single env var (``WEBHOOK_SECRET``) without editing every task.
    # Per-task secrets always win when both are configured.
    webhook_secret: str | None = None

    # IMP-07 — webhook replay protection.
    #
    # When > 0, signed webhooks must additionally carry an
    # ``X-Webhook-Timestamp`` header (Unix seconds, integer or float)
    # and the HMAC signature is computed over ``f"{timestamp}.{body}"``
    # rather than just ``body``. Requests whose timestamp is older
    # than ``webhook_replay_window_seconds`` (or in the future by more
    # than the same window, to allow modest clock skew) are rejected.
    #
    # Disabled by default (= 0) so existing GitHub-style senders that
    # only sign the body keep working. Operators flip this to e.g.
    # ``300`` (5 min) once their senders are updated to include the
    # timestamp header. See README.md for the signing contract.
    webhook_replay_window_seconds: int = Field(default=0, ge=0)

    # Path to the YAML file describing webhook provider adapters
    # (signature header, scheme, algorithm, payload template, etc.).
    # ``None`` (the default) means use the bundled
    # ``autonomous_agents/webhook_providers.yaml`` shipped with the
    # package -- which already covers github, slack, pagerduty, and
    # generic_hmac. Operators add private upstreams by pointing
    # ``WEBHOOK_PROVIDERS_FILE`` at a custom file; that file fully
    # replaces the bundled defaults, so include any built-in providers
    # you still want when overriding.
    webhook_providers_file: str | None = None

    # CORS — stored as a raw string so Docker ``CORS_ORIGINS=`` (empty) does
    # not trip pydantic-settings' JSON decode for ``list[str]``. Expose the
    # parsed list via the ``cors_origins`` property (same name as before).
    cors_origins_raw: str = Field(
        default="",
        validation_alias=AliasChoices("CORS_ORIGINS", "AUTONOMOUS_CORS_ORIGINS"),
    )
    _cors_origins: list[str] = PrivateAttr(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _legacy_cors_constructor_kwarg(cls, data: Any) -> Any:
        # Unit tests and callers use ``Settings(cors_origins=[...])`` /
        # ``Settings(cors_origins="http://a,http://b")`` — translate to raw.
        if not isinstance(data, dict) or "cors_origins" not in data:
            return data
        co = data.pop("cors_origins")
        if isinstance(co, list):
            data["cors_origins_raw"] = ",".join(str(x) for x in co if str(x)) if co else ""
        elif isinstance(co, str):
            data["cors_origins_raw"] = co
        return data

    @model_validator(mode="after")
    def _materialize_cors_origins(self) -> Self:
        # IMP-05: reject ``*`` with allow_credentials=True (see main.py).
        parsed = _parse_cors_string(self.cors_origins_raw)
        if any(origin.strip() == "*" for origin in parsed):
            raise ValueError(
                "cors_origins=['*'] is unsafe with allow_credentials=True; "
                "list each allowed origin explicitly (e.g. "
                "['http://localhost:3000','https://app.example.com'])"
            )
        self._cors_origins = parsed
        return self

    @property
    def cors_origins(self) -> list[str]:
        return self._cors_origins

    # Connection for MongoDB
    mongodb_uri: str | None = None
    mongodb_database: str | None = None

    # MongoDB collections
    mongodb_collection: str = "autonomous_runs"
    mongodb_tasks_collection: str = "autonomous_tasks"
    mongodb_trigger_instances_collection: str = "trigger_instances"

    # Connect-retry knobs for MongoDB at startup
    mongodb_connect_max_attempts: int = Field(default=3, ge=1)
    mongodb_connect_retry_delay_seconds: float = Field(default=2.0, gt=0)

    # MongoDB collection mapping a Webex messageId to the (task_id,
    # run_id) that produced it. Populated best-effort by the scheduler
    # after every successful run that called the Webex ``post_message``
    # tool, and consumed by the inbound Webex bot bridge so an in-thread
    # reply can be routed back as a follow-up to the originating task.
    # Empty / unused when no Webex bot is deployed -- safe to leave at
    # the default.
    mongodb_webex_thread_map_collection: str = "webex_thread_map"

    # TTL (in days) for entries in ``webex_thread_map``. Threads that
    # haven't been touched in this window are auto-expired by Mongo so
    # the collection doesn't grow unbounded. Defaults to 30 days --
    # plenty of time for an operator to follow up on a flagged issue,
    # short enough that abandoned threads don't pile up.
    webex_thread_map_ttl_days: int = Field(default=30, ge=1)

    # TTL (in days) for entries in ``trigger_instances``. Most
    # webhook senders give up retrying within minutes; a week is
    # comfortably long for forensics ("did this delivery arrive?")
    # without growing the collection forever. Bump higher only if
    # operators actively rely on the audit trail for older
    # deliveries.
    trigger_instance_ttl_days: int = Field(default=7, ge=1)

    # IMP-16 — circuit breaker around the supervisor A2A call.
    #
    # Enabled by default because the failure mode it prevents
    # (every scheduled task burning its full retry budget against a
    # broken supervisor) is exactly the cascading-failure pattern
    # autonomous workloads cause. Operators can flip this off via
    # ``CIRCUIT_BREAKER_ENABLED=0`` if they ever need to.
    circuit_breaker_enabled: bool = True

    # How many *consecutive* failed supervisor calls trip the breaker.
    # The streaming A2A path has no retry layer, so each transient blip
    # counts as one failure directly. Default of 5 trades a little extra
    # failure-tolerance for fewer false-positive trips on brief
    # supervisor restarts.
    circuit_breaker_failure_threshold: int = Field(default=5, ge=1)

    # How long the breaker stays OPEN before letting a single trial
    # request through (HALF_OPEN). 30s is long enough that a crashed
    # supervisor has a real chance to come back, short enough that a
    # transient outage doesn't wedge scheduled runs for minutes.
    circuit_breaker_cooldown_seconds: float = Field(default=30.0, gt=0)

    # Leak-guard threshold for HALF_OPEN trials. If a trial caller
    # never reports back (crashed mid-call, killed, etc.) the breaker
    # reclaims the slot after this many seconds so a healthy caller
    # can probe.
    #
    # When ``None`` the factory in ``services/circuit_breaker.py``
    # auto-derives it as ``max(2 * cooldown, a2a_timeout * 1.5)``.
    # Auto-derivation matters for the streaming A2A path: streaming
    # calls can legitimately run for minutes (default
    # ``a2a_timeout_seconds=300``), and a hardcoded ``2 * cooldown``
    # bound would reclaim a still-healthy trial mid-flight, defeating
    # the breaker's single-flight invariant during recovery.
    # Operators only set this explicitly to override the default
    # (e.g. running a much shorter timeout and wanting the leak guard
    # tightened to match).
    circuit_breaker_stale_trial_seconds: float | None = Field(default=None, gt=0)

    @field_validator(
        "circuit_breaker_cooldown_seconds",
        "circuit_breaker_stale_trial_seconds",
    )
    @classmethod
    def _reject_nonfinite_cb_cooldown(cls, v: float | None) -> float | None:
        # Same hardening as ``a2a_*`` knobs: ``inf`` would wedge the
        # breaker permanently OPEN, ``nan`` would compare false against
        # everything and silently disable the cooldown gate. ``None``
        # is allowed for ``stale_trial_seconds`` (factory derives a
        # default) so explicitly skip the check when unset.
        if v is None:
            return v
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError("must be a finite number")
        return v

    # IMP-13 — chat history publishing.
    #
    # When enabled, the scheduler writes each completed run as a
    # tagged conversation (``source: "autonomous"``) into the UI's
    # ``conversations`` + ``messages`` collections so operators can
    # see autonomous activity in the existing chat sidebar.
    #
    # Off by default: the UI's chat schema is owned by another
    # package, and writing into it is a cross-package contract that
    # an operator should opt into deliberately. When off, no Mongo
    # connection is opened against the chat database at all.
    chat_history_publish_enabled: bool = False

    # Owner email stamped on every autonomous-origin conversation /
    # message. The UI's chat list query filters by ``owner_id``,
    # ``sharing.shared_with``, etc.; the autonomous-only filter chip
    # bypasses that filter, so this address is mainly an audit-trail
    # marker rather than a real ACL anchor. Pick something clearly
    # synthetic so humans don't mistake it for a colleague.
    chat_history_owner_email: str = "autonomous@system"

    # Optional override for the database that holds the UI chat
    # collections. Defaults to ``mongodb_database`` so single-DB
    # deployments need no extra config; operators with a separate
    # logical DB for UI chat data can point this elsewhere without
    # affecting run-history persistence.
    chat_history_database: str | None = None

    # Collection names mirror the UI defaults from
    # ``ui/src/lib/mongodb.ts``. Exposed as settings so a CAIPE
    # deployment that has renamed them (rare) doesn't have to fork
    # this code to keep publishing working.
    chat_history_conversations_collection: str = "conversations"
    chat_history_messages_collection: str = "messages"

    # ------------------------------------------------------------------
    # Webex inbound
    # ------------------------------------------------------------------
    # When ``webex_bot_token`` is set, the lifespan registers an
    # idempotent ``messages.created`` webhook against Webex pointing at
    # this service's ``/api/v1/hooks/webex/events`` route, and that
    # route is live. When unset, the route returns 503 and no Webex
    # API call is ever made -- the feature is fully dormant.
    #
    # Why ``str | None`` (not ``str = ""``): the route uses ``token is
    # None`` as the on/off discriminator. An empty string would be
    # ambiguous (operator typo vs deliberately-off) and pydantic-settings
    # parses ``WEBEX_BOT_TOKEN=`` to ``""`` rather than ``None``. The
    # ``_validate_webex_config`` validator below converts blanks to
    # ``None`` so both shapes mean the same thing.
    webex_bot_token: str | None = None
    # HMAC-SHA1 secret Webex signs every event with. Strongly
    # recommended whenever ``webex_bot_token`` is set; we log a
    # warning at startup if it isn't (see ``_validate_webex_config``).
    webex_webhook_secret: str | None = None
    # Externally-reachable base URL of THIS service. Webex POSTs to
    # ``<public_url>/api/v1/hooks/webex/events``. In dev, an ngrok /
    # cloudflared tunnel; in prod, the real hostname. Localhost does
    # NOT work -- Webex's webhook delivery comes from their cloud.
    webex_bot_public_url: str | None = None
    # Webex REST API base. Overridable for testing / future tenant
    # migrations. Trailing slash is stripped by the client.
    webex_api_base: str = "https://webexapis.com/v1"
    # HTTP timeout for outbound calls to Webex (``get_me`` /
    # ``get_message`` / ``/webhooks`` reconciliation).
    webex_http_timeout_seconds: float = Field(default=15.0, gt=0)

    @model_validator(mode="after")
    def _validate_webex_config(self) -> Self:
        """Fail-fast on partial Webex configuration.

        ``webex_bot_token`` is the on/off switch. When it's set we
        REQUIRE ``webex_bot_public_url`` -- otherwise the lifespan would
        try to register a Webex webhook with target URL
        ``"None/api/v1/hooks/webex/events"`` and emit a useless 4xx into
        Webex's webhook dashboard. ``webex_webhook_secret`` is strongly
        recommended but stays optional to keep parity with the legacy
        bot's "unsigned dev mode" -- we emit a runtime warning instead.

        Blank strings collapse to ``None`` so ``WEBEX_BOT_TOKEN=`` in
        ``.env`` (a common way to disable a feature) does the right
        thing rather than falling into the "token set but URL absent"
        validation error.
        """
        if self.webex_bot_token == "":
            self.webex_bot_token = None
        if self.webex_webhook_secret == "":
            self.webex_webhook_secret = None
        if self.webex_bot_public_url == "":
            self.webex_bot_public_url = None

        if self.webex_bot_token is not None and not self.webex_bot_public_url:
            raise ValueError(
                "WEBEX_BOT_TOKEN is set but WEBEX_BOT_PUBLIC_URL is not. "
                "Webex inbound cannot be enabled without an externally-reachable "
                "URL to register with Webex. Either set WEBEX_BOT_PUBLIC_URL "
                "to your public ingress (e.g. https://abcd.ngrok-free.app) or "
                "unset WEBEX_BOT_TOKEN to disable Webex inbound."
            )
        return self

    @property
    def webex_enabled(self) -> bool:
        """Single source of truth for "is Webex inbound active?".

        Used by the route (returns 503 when False) and the lifespan
        (skips Webex API calls entirely when False). Driven solely by
        the presence of ``webex_bot_token`` so unsetting the token in
        an existing deployment cleanly disables the feature.
        """
        return self.webex_bot_token is not None

    # Webhook-context redaction switch (default OFF).
    # The autonomous agent's published prompt could otherwise contain
    # the entire raw webhook payload (e.g. a GitHub PR body, a
    # PagerDuty incident JSON) which the UI then renders to *any*
    # authenticated viewer, because chat-history rows tagged
    # ``source: 'autonomous'`` are read-accessible to all logged-in
    # users for audit visibility (see ``requireConversationAccess``).
    # Defaulting to OFF means an operator must opt in deliberately
    # before potentially-sensitive webhook bodies are mirrored into
    # broad-readable chat. With this off, the published prompt is
    # the bare ``task.prompt`` plus an opaque
    # ``Context: <redacted N keys>`` marker so debugging "did the
    # webhook fire?" is still possible without exposing payload
    # contents.
    chat_history_include_context: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()

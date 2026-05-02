"""Configuration loaded from environment variables."""

from __future__ import annotations

import os

from pydantic import BaseModel, Field


class Settings(BaseModel):
    # Mongo
    mongodb_uri: str = Field(
        default_factory=lambda: os.environ.get(
            "MONGODB_URI",
            "mongodb://admin:changeme@caipe-mongodb:27017/caipe?authSource=admin",
        )
    )
    mongodb_database: str = Field(
        default_factory=lambda: os.environ.get("MONGODB_DATABASE", "caipe")
    )
    schedules_collection: str = Field(
        default_factory=lambda: os.environ.get("SCHEDULES_COLLECTION", "schedules")
    )

    # Auth: shared service token between dynamic-agents and scheduler-svc.
    # Sent as `X-Scheduler-Token` header on every request.
    service_token: str = Field(
        default_factory=lambda: os.environ.get("SCHEDULER_SERVICE_TOKEN", "")
    )

    # Kubernetes
    namespace: str = Field(
        default_factory=lambda: os.environ.get("SCHEDULER_NAMESPACE", "caipe")
    )
    cron_runner_image: str = Field(
        default_factory=lambda: os.environ.get(
            "CRON_RUNNER_IMAGE", "ghcr.io/cnoe-io/caipe-cron-runner:latest"
        )
    )
    # ServiceAccount for the per-schedule CronJob runner pods. No perms.
    cron_runner_service_account: str = Field(
        default_factory=lambda: os.environ.get(
            "CRON_RUNNER_SERVICE_ACCOUNT", "caipe-cron-runner"
        )
    )
    # Internal URL the runner uses to call back into scheduler-svc.
    scheduler_internal_url: str = Field(
        default_factory=lambda: os.environ.get(
            "SCHEDULER_INTERNAL_URL", "http://caipe-scheduler:8080"
        )
    )
    # Where the runner POSTs the chat message.
    caipe_api_url: str = Field(
        default_factory=lambda: os.environ.get(
            "CAIPE_API_URL", "http://caipe-ui:3000"
        )
    )
    # Secret name + key holding the runner's CAIPE API token.
    caipe_api_token_secret: str = Field(
        default_factory=lambda: os.environ.get(
            "CAIPE_API_TOKEN_SECRET", "caipe-cron-runner-token"
        )
    )
    caipe_api_token_secret_key: str = Field(
        default_factory=lambda: os.environ.get(
            "CAIPE_API_TOKEN_SECRET_KEY", "token"
        )
    )

    # Limits
    max_schedules_per_owner: int = Field(
        default_factory=lambda: int(os.environ.get("MAX_SCHEDULES_PER_OWNER", "50"))
    )
    max_message_chars: int = Field(
        default_factory=lambda: int(os.environ.get("MAX_MESSAGE_CHARS", "2000"))
    )

    # Owner reference: scheduler-svc's own Deployment, for cascade-delete of
    # CronJobs. If unset, no ownerReferences are written (dev mode).
    owner_deployment_name: str | None = Field(
        default_factory=lambda: os.environ.get("OWNER_DEPLOYMENT_NAME") or None
    )
    owner_deployment_uid: str | None = Field(
        default_factory=lambda: os.environ.get("OWNER_DEPLOYMENT_UID") or None
    )


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings

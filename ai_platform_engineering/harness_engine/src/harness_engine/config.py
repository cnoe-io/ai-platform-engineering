"""Harness Engine operator configuration."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class AgentCoreRuntimeTarget(BaseModel):
    """Operator-owned AgentCore target; ARNs never come from agent drafts."""

    arn: str = Field(..., min_length=20, pattern=r"^arn:aws[a-z-]*:bedrock-agentcore:")
    qualifier: str = Field("DEFAULT", min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    region: str | None = Field(None, pattern=r"^[a-z]{2}(?:-gov)?-[a-z]+-\d$")


class Settings(BaseSettings):
    """Environment-only service settings."""

    model_config = SettingsConfigDict(env_prefix="HARNESS_ENGINE_", extra="ignore")

    host: str = "0.0.0.0"
    port: int = Field(8010, ge=1, le=65535)
    internal_token: str = Field("local-development-only", min_length=16)
    storage_backend: str = Field("memory", pattern=r"^(memory|mongodb)$")
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_database: str = "harness_engine"
    event_retention_seconds: int = Field(86400, ge=300, le=2592000)
    long_poll_seconds: float = Field(15.0, ge=0.1, le=30.0)
    agentcore_runtimes_json: str = "{}"
    agentcore_endpoint_url: str | None = None

    def agentcore_targets(self) -> dict[str, AgentCoreRuntimeTarget]:
        """Parse the operator allowlist without exposing raw settings to clients."""

        try:
            raw = json.loads(self.agentcore_runtimes_json)
            if not isinstance(raw, dict):
                raise ValueError("must be a JSON object")
            return {alias: AgentCoreRuntimeTarget.model_validate(value) for alias, value in raw.items()}
        except (json.JSONDecodeError, ValidationError, ValueError) as exc:
            raise ValueError("HARNESS_ENGINE_AGENTCORE_RUNTIMES_JSON is invalid") from exc

"""Configuration settings for Dynamic Agents service."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    Tracing (Langfuse) Configuration:
        The following environment variables are read by cnoe-agent-utils.TracingManager
        to enable Langfuse tracing for LLM calls and agent execution:

        - ENABLE_TRACING: Set to "true" to enable tracing (default: disabled)
        - LANGFUSE_PUBLIC_KEY: Langfuse project public key (e.g., "pk-lf-xxx")
        - LANGFUSE_SECRET_KEY: Langfuse project secret key (e.g., "sk-lf-xxx")
        - LANGFUSE_HOST: Langfuse server URL (e.g., "http://langfuse-web:3000")

        When enabled, traces are grouped by session_id (conversation) and include:
        - LLM inputs/outputs with token counts
        - Tool calls as nested spans
        - Agent metadata (name, config_id, user_id)
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Server
    host: str = "0.0.0.0"
    port: int = 8001
    debug: bool = False

    # MongoDB
    # Full URI takes precedence; if not set, built from components
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_database: str = "caipe"

    # Collections
    dynamic_agents_collection: str = "dynamic_agents"
    mcp_servers_collection: str = "mcp_servers"

    # CORS
    cors_origins: list[str] = ["*"]

    # Runtime
    agent_runtime_ttl_seconds: int = 60  # 60s inactivity TTL for agent runtimes
    # Max concurrent cached runtimes. Each costs ~15-20MB (with shared clients).
    # Recommendation: (pod_memory_mb - 150) / 20, e.g. 512MB pod → 18 runtimes.
    agent_runtime_max_cache_size: int = 20


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()

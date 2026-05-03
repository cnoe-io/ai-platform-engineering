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
    vendor_connections_collection: str = "vendor_connections"

    # Webex OAuth (per-user) — used by MCP servers with auth.type=user_oauth, provider=webex.
    # Refresh tokens are written by the UI on initial /api/integrations/webex/callback;
    # backend may rotate them via WEBEX_OAUTH_REFRESH_ENABLED.
    webex_oauth_client_id: str = ""
    webex_oauth_client_secret: str = ""
    webex_oauth_token_url: str = "https://webexapis.com/v1/access_token"
    # If true, backend will refresh near-expiry Webex tokens itself.
    # If false, backend treats expired tokens as "not connected" and surfaces an error.
    webex_oauth_refresh_enabled: bool = True
    # Refresh threshold: refresh when fewer than this many seconds remain.
    webex_oauth_refresh_threshold_seconds: int = 120

    # CORS
    cors_origins: list[str] = ["*"]

    # Runtime
    agent_runtime_ttl_seconds: int = 600  # 10 min inactivity TTL for agent runtimes


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()

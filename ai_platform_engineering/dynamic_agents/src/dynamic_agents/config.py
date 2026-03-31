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

    # OIDC / Auth (same env vars as UI and RAG server)
    auth_enabled: bool = True  # Set to false to disable auth for local dev
    oidc_issuer: str | None = None  # OIDC provider issuer URL
    oidc_client_id: str | None = None  # Used as audience for token validation
    oidc_discovery_url: str | None = None  # Optional: explicit discovery URL
    oidc_group_claim: str | None = None  # Claim name(s) for groups (comma-separated)
    oidc_required_admin_group: str | None = None  # Group name for admin access

    # CORS
    cors_origins: list[str] = ["*"]

    # Runtime
    agent_runtime_ttl_seconds: int = 3600  # 1 hour cache TTL for agent runtimes

    # Seed configuration path (for MCP servers and agents loaded at startup)
    seed_config_path: str | None = None

    # OpenShell sandbox
    openshell_gateway: str | None = None  # Override: connect directly to this endpoint
    openshell_gateway_name: str = "openshell"  # Gateway name used by auto-start
    openshell_default_timeout: int = 1800  # Default command timeout (30 min)
    openshell_cli_path: str = "openshell"  # Path to openshell CLI binary


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()

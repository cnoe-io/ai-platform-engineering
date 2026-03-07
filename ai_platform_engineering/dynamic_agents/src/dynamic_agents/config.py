"""Configuration settings for Dynamic Agents service."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

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

    # LLM
    default_model_id: str | None = None

    # Extension prompt
    default_extension_prompt_path: str | None = None

    # CORS
    cors_origins: list[str] = ["*"]

    # Runtime
    agent_runtime_ttl_seconds: int = 3600  # 1 hour cache TTL for agent runtimes

    @property
    def default_extension_prompt(self) -> str | None:
        """Load default extension prompt from file if configured."""
        if self.default_extension_prompt_path:
            path = Path(self.default_extension_prompt_path)
            if path.exists():
                return path.read_text()
        return None


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()

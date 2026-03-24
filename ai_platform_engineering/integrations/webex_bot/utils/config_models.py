"""Pydantic configuration models for the Webex bot."""

import os
from pydantic import BaseModel


class WebexConfig(BaseModel):
    """Webex bot configuration loaded from environment variables."""

    bot_token: str
    caipe_url: str = "http://caipe-supervisor:8000"
    enable_auth: bool = False
    mongodb_uri: str = ""
    mongodb_database: str = "caipe"
    caipe_ui_base_url: str = "http://localhost:3000"
    langfuse_enabled: bool = False
    space_auth_cache_ttl: int = 300

    @classmethod
    def from_env(cls) -> "WebexConfig":
        """Create configuration from environment variables."""
        bot_token = os.environ.get("WEBEX_BOT_TOKEN", "")
        if not bot_token:
            raise RuntimeError("WEBEX_BOT_TOKEN environment variable is required")

        return cls(
            bot_token=bot_token,
            caipe_url=os.environ.get("CAIPE_URL", "http://caipe-supervisor:8000"),
            enable_auth=os.environ.get("WEBEX_INTEGRATION_ENABLE_AUTH", "false").lower() == "true",
            mongodb_uri=os.environ.get("MONGODB_URI", ""),
            mongodb_database=os.environ.get("MONGODB_DATABASE", "caipe"),
            caipe_ui_base_url=os.environ.get("CAIPE_UI_BASE_URL", "http://localhost:3000"),
            langfuse_enabled=os.environ.get("LANGFUSE_SCORING_ENABLED", "false").lower() == "true",
            space_auth_cache_ttl=int(os.environ.get("WEBEX_SPACE_AUTH_CACHE_TTL", "300")),
        )

"""Webex bot configuration loading."""

from utils.config_models import WebexConfig


def load_config() -> WebexConfig:
    """Load Webex bot configuration from environment variables."""
    return WebexConfig.from_env()

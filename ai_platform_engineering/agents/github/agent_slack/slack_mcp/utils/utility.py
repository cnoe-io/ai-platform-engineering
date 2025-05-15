"""Utility functions for Slack MCP tools."""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def get_token(env: Optional[dict] = None) -> Optional[str]:
    """Get Slack bot token from environment or env dict."""
    token = (env or {}).get("SLACK_BOT_TOKEN") or os.getenv("SLACK_BOT_TOKEN")
    if not token:
        logger.error("SLACK_BOT_TOKEN is missing from both env and os.environ")
    else:
        logger.debug("Using SLACK_BOT_TOKEN: %s...", token[:10])
    return token
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
import requests
import json
from functools import lru_cache
from .config import config
from loguru import logger


def check_has_jira_info(channel_id):
    """Check if a channel has configuration."""
    return channel_id in config.channels


def get_current_channel_id(event):
    """Extract channel ID from a Slack event."""
    return event["channel"]


@lru_cache(maxsize=32)
def get_username_by_bot_id(bot_id):
    """
    Get bot username from bot ID using Slack API.
    Results are cached to avoid repeated API calls.
    """
    # Fetch from Slack API
    url = "https://slack.com/api/bots.info"
    headers = {
        "Authorization": "Bearer " + os.environ.get("SLACK_INTEGRATION_BOT_TOKEN", os.environ.get("SLACK_BOT_TOKEN", "")),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    payload = "bot={}".format(bot_id)

    try:
        response = requests.request("POST", url, headers=headers, data=payload)
    except requests.exceptions.RequestException as e:
        logger.warning(e)
        return ""

    response_dict = json.loads(response.text)
    if response_dict["ok"]:
        return response_dict["bot"]["name"]
    else:
        logger.info(response_dict)
        return ""


def get_message_author_info(event, client):
    """
    Get author name and email from a Slack event.
    Handles both regular user messages and bot messages.

    Returns:
        Tuple of (user_name, user_email)
    """
    user_id = event.get("user")
    bot_id = event.get("bot_id")

    if bot_id:
        user_name = get_username_by_bot_id(bot_id)
        user_email = None
    else:
        try:
            user_info = client.users_info(user=user_id)
            user_data = user_info.get("user", {})
            user_name = user_data.get("real_name") or user_data.get("name") or user_id
            user_email = user_data.get("profile", {}).get("email")
        except Exception as e:
            logger.error(f"Error getting user info: {e}")
            user_name = user_id
            user_email = None

    return user_name, user_email

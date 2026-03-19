# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Scoring utilities for submitting user feedback to Langfuse.
"""

import os
from typing import Optional
from loguru import logger

from .langfuse_client import FeedbackClient
from .session_manager import SessionManager
from .config_models import Config


def submit_feedback_score(
    thread_ts: str,
    user_id: str,
    channel_id: str,
    feedback_value: str,
    slack_client,
    session_manager: SessionManager,
    config: Config,
    feedback_client: Optional[FeedbackClient],
    comment: Optional[str] = None,
) -> bool:
    """
    Submit a feedback score to Langfuse with full context.

    Submits THREE scores:
      1. Channel-specific score (name: channel name, or "DM" for direct messages)
      2. Aggregated Slack score (name: "all slack channels")
      3. Aggregated cross-client score (name: "all") — shared with the web UI
    """
    if feedback_client is None:
        logger.debug("Langfuse feedback scoring disabled, skipping")
        return True

    trace_id = session_manager.get_trace_id(thread_ts)
    context_id = session_manager.get_context_id(thread_ts)

    if not trace_id:
        logger.warning(f"No trace_id found for thread {thread_ts}, skipping Langfuse feedback")
        return False

    # Get user email for author tracking
    user_email = None
    try:
        cached_user_info = session_manager.get_user_info(user_id)
        if cached_user_info:
            user_email = cached_user_info.get("user", {}).get("profile", {}).get("email")
        else:
            user_info_response = slack_client.users_info(user=user_id)
            if user_info_response:
                user_info = user_info_response.data
                session_manager.set_user_info(user_id, user_info)
                user_email = user_info.get("user", {}).get("profile", {}).get("email")
    except Exception as e:
        logger.warning(f"Could not get user email: {e}")

    # Get channel name from config; DMs won't be in config.channels
    channel_name = None
    is_dm = channel_id.startswith("D") if channel_id else False
    if channel_id in config.channels:
        channel_name = config.channels[channel_id].name

    # Construct Slack permalink (derived from Slack workspace)
    slack_workspace_url = os.environ.get("SLACK_WORKSPACE_URL", "")
    if slack_workspace_url:
        slack_permalink = (
            f"{slack_workspace_url}/archives/{channel_id}/p{thread_ts.replace('.', '')}"
        )
    else:
        slack_permalink = None

    # Score 1: Channel-specific score
    # For DMs, use "DM" as the score name; for unknown channels, fall back to "all slack channels"
    channel_score_name = channel_name if channel_name else ("DM" if is_dm else "all slack channels")
    display_channel_name = channel_name or ("DM" if is_dm else None)
    success_channel = feedback_client.submit_feedback(
        trace_id=trace_id,
        score_name=channel_score_name,
        value=feedback_value,
        user_id=user_id,
        user_email=user_email,
        comment=comment,
        session_id=context_id,
        channel_id=channel_id,
        channel_name=display_channel_name,
        slack_permalink=slack_permalink,
    )

    # Score 2: Aggregated score for all Slack channels
    success_all_slack = feedback_client.submit_feedback(
        trace_id=trace_id,
        score_name="all slack channels",
        value=feedback_value,
        user_id=user_id,
        user_email=user_email,
        comment=comment,
        session_id=context_id,
        channel_id=channel_id,
        channel_name=display_channel_name,
        slack_permalink=slack_permalink,
    )

    # Score 3: Aggregated score across all clients (Slack + Web UI)
    success_all = feedback_client.submit_feedback(
        trace_id=trace_id,
        score_name="all",
        value=feedback_value,
        user_id=user_id,
        user_email=user_email,
        comment=comment,
        session_id=context_id,
        channel_id=channel_id,
        channel_name=display_channel_name,
        slack_permalink=slack_permalink,
    )

    return success_channel and success_all_slack and success_all

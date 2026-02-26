# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Langfuse Feedback Client

Submits user feedback as Langfuse scores linked to conversation traces.
"""

import os
from typing import Optional
from loguru import logger
from langfuse import Langfuse


class FeedbackClient:
    """Client for submitting user feedback scores to Langfuse."""

    def __init__(self):
        """Initialize the Langfuse client from environment variables."""
        public_key = os.environ.get("LANGFUSE_PUBLIC_KEY")
        secret_key = os.environ.get("LANGFUSE_SECRET_KEY")
        host = os.environ.get("LANGFUSE_HOST")

        self._langfuse = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=host,
        )
        logger.info(f"Langfuse feedback client initialized (host: {host or 'default'})")

    def submit_feedback(
        self,
        trace_id: str,
        score_name: str,
        value: str,
        user_id: Optional[str] = None,
        user_email: Optional[str] = None,
        comment: Optional[str] = None,
        session_id: Optional[str] = None,
        channel_id: Optional[str] = None,
        channel_name: Optional[str] = None,
        slack_permalink: Optional[str] = None,
    ) -> bool:
        """Submit user feedback as a Langfuse score."""
        try:
            metadata = {}
            if user_id:
                metadata["user_id"] = user_id
            if user_email:
                metadata["user_email"] = user_email
            if session_id:
                metadata["session_id"] = session_id
            if channel_id:
                metadata["channel_id"] = channel_id
            if channel_name:
                metadata["channel_name"] = channel_name
            if slack_permalink:
                metadata["slack_permalink"] = slack_permalink

            self._langfuse.create_score(
                trace_id=trace_id,
                name=score_name,
                value=value,
                data_type="CATEGORICAL",
                comment=comment,
                metadata=metadata if metadata else None,
            )
            self._langfuse.flush()
            logger.info(
                f"Submitted feedback score: trace_id={trace_id}, "
                f"name={score_name}, value={value}, user={user_id}, email={user_email}, "
                f"session={session_id}, channel={channel_name or channel_id}, "
                f"permalink={slack_permalink}"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to submit feedback to Langfuse: {e}")
            return False

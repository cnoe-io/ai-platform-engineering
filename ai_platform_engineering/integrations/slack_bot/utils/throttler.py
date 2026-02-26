# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Slack API Rate Limiting Throttler

Prevents Slack API rate limits during streaming updates:
- Minimum interval between updates (default: 1.5s)
- Buffer content between updates
- Force update after max interval
- Retry with exponential backoff on 429 errors
"""

import time
from typing import Optional, Any
from dataclasses import dataclass
from loguru import logger


@dataclass
class ThrottlerConfig:
    """Configuration for the throttler"""

    min_interval: float = 1.5
    max_interval: float = 10.0
    initial_retry_delay: float = 1.0
    max_retry_delay: float = 30.0
    max_retries: int = 5


@dataclass
class ThrottlerState:
    """Internal state for the throttler"""

    last_update_time: float = 0.0
    buffered_content: str = ""
    update_count: int = 0
    consecutive_errors: int = 0


class SlackUpdateThrottler:
    """Throttles Slack message updates to avoid rate limiting."""

    def __init__(
        self,
        slack_client: Any,
        channel_id: str,
        message_ts: str,
        config: Optional[ThrottlerConfig] = None,
        thread_ts: Optional[str] = None,
    ):
        self.slack_client = slack_client
        self.channel_id = channel_id
        self.message_ts = message_ts
        self.config = config or ThrottlerConfig()
        self.thread_ts = thread_ts or message_ts
        self.state = ThrottlerState()
        self.state.last_update_time = time.time()

    def buffer_content(self, content: str, append: bool = True) -> None:
        if append:
            self.state.buffered_content += content
        else:
            self.state.buffered_content = content

    def get_buffered_content(self) -> str:
        return self.state.buffered_content

    def clear_buffer(self) -> None:
        self.state.buffered_content = ""

    def should_update(self) -> bool:
        elapsed = time.time() - self.state.last_update_time
        return elapsed >= self.config.min_interval

    def time_since_last_update(self) -> float:
        return time.time() - self.state.last_update_time

    def should_force_update(self) -> bool:
        return self.time_since_last_update() >= self.config.max_interval

    def update(self, blocks: list, text: str = "Working on your request...", force: bool = False) -> bool:
        if not force and not self.should_update():
            return False
        return self._execute_update(blocks, text)

    def force_update(self, blocks: list, text: str = "Response from CAIPE") -> bool:
        return self._execute_update(blocks, text)

    def _execute_update(self, blocks: list, text: str) -> bool:
        retry_delay = self.config.initial_retry_delay

        for attempt in range(self.config.max_retries + 1):
            try:
                self.slack_client.chat_update(
                    channel=self.channel_id,
                    ts=self.message_ts,
                    blocks=blocks,
                    text=text,
                )

                self.state.last_update_time = time.time()
                self.state.update_count += 1
                self.state.consecutive_errors = 0

                return True

            except Exception as e:
                error_str = str(e)

                if "ratelimited" in error_str.lower() or "429" in error_str:
                    self.state.consecutive_errors += 1

                    retry_after = self._extract_retry_after(e)
                    if retry_after:
                        retry_delay = retry_after

                    if attempt < self.config.max_retries:
                        logger.warning(
                            f"[{self.thread_ts}] Rate limited (attempt {attempt + 1}/{self.config.max_retries + 1}), "
                            f"retrying in {retry_delay:.1f}s"
                        )
                        time.sleep(retry_delay)
                        retry_delay = min(retry_delay * 2, self.config.max_retry_delay)
                        continue
                    else:
                        logger.error(
                            f"[{self.thread_ts}] Rate limit exceeded after {self.config.max_retries + 1} attempts"
                        )
                        return False
                else:
                    logger.warning(f"[{self.thread_ts}] Failed to update Slack message: {e}")
                    self.state.consecutive_errors += 1
                    return False

        return False

    def _extract_retry_after(self, error: Exception) -> Optional[float]:
        try:
            if hasattr(error, "response"):
                response = error.response
                if hasattr(response, "headers"):
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        return float(retry_after)
        except (ValueError, AttributeError):
            pass
        return None

    def get_stats(self) -> dict:
        return {
            "update_count": self.state.update_count,
            "consecutive_errors": self.state.consecutive_errors,
            "last_update_time": self.state.last_update_time,
            "buffered_content_length": len(self.state.buffered_content),
        }


def create_throttled_updater(
    slack_client: Any,
    channel_id: str,
    message_ts: str,
    thread_ts: Optional[str] = None,
    min_interval: float = 1.5,
) -> SlackUpdateThrottler:
    """Factory function to create a throttled updater with common defaults."""
    config = ThrottlerConfig(min_interval=min_interval)
    return SlackUpdateThrottler(
        slack_client=slack_client,
        channel_id=channel_id,
        message_ts=message_ts,
        config=config,
        thread_ts=thread_ts,
    )

"""Slack runtime response policy tests."""

from __future__ import annotations

from utils.slack_runtime_policy import (
    should_post_route_miss_notice,
    should_process_slack_payload,
)


def test_silence_env_stops_slack_payload_processing() -> None:
    assert should_process_slack_payload(silence_env=False) is True
    assert should_process_slack_payload(silence_env=True) is False


def test_route_miss_notice_requires_explicit_invocation() -> None:
    assert (
        should_post_route_miss_notice(
            silence_env=False,
            explicit_invocation=True,
        )
        is True
    )
    assert (
        should_post_route_miss_notice(
            silence_env=False,
            explicit_invocation=False,
        )
        is False
    )


def test_route_miss_notice_is_suppressed_in_setup_mode() -> None:
    assert (
        should_post_route_miss_notice(
            silence_env=True,
            explicit_invocation=True,
        )
        is False
    )

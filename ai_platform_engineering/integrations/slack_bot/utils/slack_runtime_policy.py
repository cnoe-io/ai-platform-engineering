"""Runtime response policy for Slack bot handlers."""

from __future__ import annotations


def should_process_slack_payload(*, silence_env: bool) -> bool:
  """Return whether Slack handlers should process inbound payloads."""
  return not silence_env


def should_post_route_miss_notice(*, silence_env: bool, explicit_invocation: bool) -> bool:
  """Return whether a route miss should be visible to the Slack user."""
  return not silence_env and explicit_invocation

"""Runtime response policy for Slack bot handlers."""

from __future__ import annotations


def should_post_route_miss_notice(*, explicit_invocation: bool) -> bool:
  """Return whether a route miss should be visible to the Slack user."""
  return explicit_invocation

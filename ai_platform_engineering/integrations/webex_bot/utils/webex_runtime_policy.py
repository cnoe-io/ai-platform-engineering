"""Runtime response policy for Webex bot handlers."""

from __future__ import annotations


def should_post_denial_notice(*, silence_env: bool, explicit_invocation: bool) -> bool:
    """Return whether an access denial should be visible to the Webex user."""
    return not silence_env and explicit_invocation

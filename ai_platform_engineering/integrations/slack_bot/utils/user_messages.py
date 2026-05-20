"""User-facing Slack bot message copy."""

from __future__ import annotations

TEAM_SESSION_UNAVAILABLE_MESSAGE = (
    "I couldn't start your CAIPE session for this channel. "
    "Please try again in a minute. If it still doesn't work, ask an admin "
    "to refresh this channel's team setup in CAIPE."
)

TEAM_SETUP_INCOMPLETE_MESSAGE = (
    "This {surface}'s team setup is incomplete. Ask an admin to refresh the "
    "{surface}'s team assignment in CAIPE, then try again."
)

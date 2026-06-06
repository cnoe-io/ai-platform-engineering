"""Webex chat-envelope augmentation.

Mirror of slack_bot.utils.chat_envelope. Webex doesn't have a workspace
concept analogous to Slack's team_id at the chat-envelope layer; we map
``space_id`` to the normalized ``channel_id`` field and leave
``workspace_id`` unset.

Spec 2026-05-24-derive-team-from-channel, FR-016 / FR-017.
"""

from typing import Literal, Mapping, MutableMapping, Optional

SurfaceKind = Literal["channel", "dm"]
_VALID_SURFACE_KINDS = ("channel", "dm")


def augment_webex_client_context(
    base: Mapping[str, object],
    *,
    space_id: Optional[str],
    thread_parent_id: Optional[str],
    surface_kind: SurfaceKind,
) -> MutableMapping[str, object]:
    """Return a new dict that copies ``base`` and adds the Phase 1 fields.

    Maps Webex-specific keys to the unified envelope:
      - ``space_id``         → ``channel_id``
      - ``thread_parent_id`` → ``thread_ts``  (string id of the parent message,
                                 not a timestamp — but normalized as such)
      - ``surface_kind``     → unchanged ('channel' for spaces with ≥3
                                 members, 'dm' for 1:1 rooms)

    Falsy ``space_id`` is treated as "no channel context" and the
    augmentation is a no-op.
    """
    if surface_kind not in _VALID_SURFACE_KINDS:
        raise ValueError(
            f"surface_kind must be one of {_VALID_SURFACE_KINDS!r}, got {surface_kind!r}"
        )

    augmented: MutableMapping[str, object] = dict(base)
    if not space_id:
        return augmented

    augmented["channel_id"] = space_id
    augmented["surface_kind"] = surface_kind
    if thread_parent_id:
        augmented["thread_ts"] = thread_parent_id
    return augmented

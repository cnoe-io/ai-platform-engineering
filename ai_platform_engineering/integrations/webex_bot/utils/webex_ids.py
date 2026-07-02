"""Validation helpers for Webex identifiers used in auth paths."""

from __future__ import annotations

import base64
import re

# Conservative allowlist aligned with admin BFF Webex space ID rules.
WEBEX_PERSON_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$")
WEBEX_SPACE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$")
WEBEX_ROOM_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")
_ROOM_URI_PREFIX = "ciscospark://us/ROOM/"


def _normalized_id(candidate: str) -> str:
    return candidate.strip()


def is_valid_webex_person_id(person_id: str) -> bool:
    """Return True when *person_id* is safe to use in Keycloak attribute queries."""
    candidate = _normalized_id(person_id)
    if not candidate or _CONTROL_CHARS_RE.search(candidate):
        return False
    return bool(WEBEX_PERSON_ID_RE.match(candidate))


def is_valid_webex_space_id(space_id: str) -> bool:
    """Return True when *space_id* is safe for Mongo/OpenFGA lookups."""
    candidate = _normalized_id(space_id)
    if not candidate or _CONTROL_CHARS_RE.search(candidate):
        return False
    return bool(WEBEX_SPACE_ID_RE.match(candidate))


def public_webex_room_id_from_uuid(raw_room_id: str) -> str:
    """Return the Webex public API room id for a raw room UUID."""

    candidate = _normalized_id(raw_room_id)
    if not WEBEX_ROOM_UUID_RE.match(candidate):
        return candidate
    payload = f"{_ROOM_URI_PREFIX}{candidate}".encode("utf-8")
    return base64.b64encode(payload).decode("ascii").rstrip("=")


def raw_webex_room_id_from_public_id(public_room_id: str) -> str | None:
    """Decode a Webex public room id into its raw room UUID, if possible."""

    candidate = _normalized_id(public_room_id)
    if not candidate:
        return None
    padding = "=" * (-len(candidate) % 4)
    try:
        decoded = base64.b64decode(candidate + padding, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    if not decoded.startswith(_ROOM_URI_PREFIX):
        return None
    raw_room_id = decoded.removeprefix(_ROOM_URI_PREFIX)
    if not WEBEX_ROOM_UUID_RE.match(raw_room_id):
        return None
    return raw_room_id


def canonicalize_webex_space_id(space_id: str) -> str:
    """Use raw Webex room UUIDs as CAIPE/OpenFGA canonical space IDs."""

    candidate = _normalized_id(space_id)
    decoded = raw_webex_room_id_from_public_id(candidate)
    return decoded or candidate

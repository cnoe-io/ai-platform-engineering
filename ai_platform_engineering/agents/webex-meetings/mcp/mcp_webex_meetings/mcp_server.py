# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

import functools
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastmcp.server.dependencies import get_http_headers
from mcp.shared.exceptions import McpError
from mcp.types import INTERNAL_ERROR, INVALID_PARAMS, ErrorData
from pydantic import BaseModel, Field

WEBEX_API_BASE = "https://webexapis.com/v1"
USERHUB_DEFAULT_SITE = "https://cisco.webex.com"
USERHUB_CALENDAR_PATH = "/webappng/api/v1/mymeetings/calendarView"
SENSITIVE_KEY_SUBSTRINGS = ("password", "hostkey")

logger = logging.getLogger(__name__)


# ──────────────────────────── auth helper ─────────────────────────────
def _bearer_from_request() -> str:
    """Pull the Bearer token out of the inbound MCP request's Authorization header.

    The dynamic-agents runtime (mcp_client._resolve_user_oauth_headers) sets
    this header per-request based on the chatting user's vendor_connections
    entry. We forward it untouched to webexapis.com.
    """
    # FastMCP strips `authorization` by default — must opt in via `include`.
    headers = get_http_headers(include={"authorization"})
    auth = headers.get("authorization") or headers.get("Authorization")
    if not auth:
        raise McpError(
            ErrorData(
                code=INVALID_PARAMS,
                message=(
                    "No Authorization header on inbound MCP request. "
                    "This MCP server must be invoked with auth.type=user_oauth, "
                    "provider=webex by the dynamic-agents runtime."
                ),
            )
        )
    return auth


# ─────────────────────────── pydantic args ────────────────────────────
class ListMeetings(BaseModel):
    from_iso: Annotated[
        str | None,
        Field(
            description=(
                "ISO-8601 lower bound for meeting start time, e.g. '2026-05-01T00:00:00Z'."
            ),
            default=None,
        ),
    ] = None
    to_iso: Annotated[
        str | None,
        Field(
            description="ISO-8601 upper bound for meeting start time.",
            default=None,
        ),
    ] = None
    host_email: Annotated[
        str | None,
        Field(
            description=(
                "Restrict to meetings hosted by this Webex user. Caller must be "
                "an admin or the user themselves to use this filter."
            ),
            default=None,
        ),
    ] = None
    meeting_type: Annotated[
        Literal["meetingSeries", "scheduledMeeting", "meeting"] | None,
        Field(
            description=(
                "meetingSeries=recurring template; scheduledMeeting=one occurrence; "
                "meeting=actual instance with state."
            ),
            default=None,
        ),
    ] = None
    max_results: Annotated[
        int,
        Field(description="Max meetings to return (1–100).", default=20, ge=1, le=100),
    ] = 20

    class Config:
        description = "List/search Webex meetings the authenticated user can see."


class UserHubCalendar(BaseModel):
    from_iso: Annotated[
        str | None,
        Field(
            description=(
                "Optional ISO-8601 lower bound for occurrence start time. "
                "Filtering is applied client-side after reading User Hub calendar rows."
            ),
            default=None,
        ),
    ] = None
    to_iso: Annotated[
        str | None,
        Field(
            description=(
                "Optional ISO-8601 upper bound for occurrence start time. "
                "Filtering is applied client-side after reading User Hub calendar rows."
            ),
            default=None,
        ),
    ] = None
    title: Annotated[
        str | None,
        Field(
            description="Optional case-insensitive title/subject substring filter.",
            default=None,
        ),
    ] = None
    site_url: Annotated[
        str,
        Field(
            description=(
                "Webex site base URL for the signed-in user's User Hub calendar, "
                "for example 'https://cisco.webex.com'."
            ),
            default=USERHUB_DEFAULT_SITE,
        ),
    ] = USERHUB_DEFAULT_SITE
    meeting_list_type: Annotated[
        str,
        Field(
            description=(
                "User Hub meetingListType query value. Use 'All' for the broadest "
                "calendar view, including external calendar-backed rows."
            ),
            default="All",
        ),
    ] = "All"
    max_results: Annotated[
        int,
        Field(description="Maximum calendar rows to request (1-500).", default=200, ge=1, le=500),
    ] = 200

    class Config:
        description = (
            "Read the signed-in user's Webex User Hub calendar feed. Best-effort "
            "fallback for Office365/Google-backed future occurrences that may not "
            "appear as public Webex scheduledMeeting rows."
        )


class ResolveMeetingLink(BaseModel):
    web_link: Annotated[
        str,
        Field(
            description=(
                "Full Webex join/calendar link to resolve through the official "
                "/v1/meetings?webLink=... API."
            )
        ),
    ]
    max_results: Annotated[
        int,
        Field(description="Maximum matching Webex meeting rows to return (1-100).", default=10, ge=1, le=100),
    ] = 10

    class Config:
        description = (
            "Resolve a Webex meeting link to official Webex meeting metadata, "
            "with password/host-key fields removed."
        )


class GetMeetingStatus(BaseModel):
    meeting_id: Annotated[str, Field(description="Webex meeting ID.")]
    include_participants: Annotated[
        bool,
        Field(
            description="If true, also fetch the meeting participant list.",
            default=False,
        ),
    ] = False

    class Config:
        description = (
            "Get a single Webex meeting's metadata; optionally include "
            "participants via /v1/meetingParticipants."
        )


class CreateMeeting(BaseModel):
    title: Annotated[str, Field(description="Meeting title (max 128 chars).")]
    start: Annotated[str, Field(description="ISO-8601 start time, e.g. '2026-05-08T14:00:00Z'.")]
    end: Annotated[str, Field(description="ISO-8601 end time.")]
    agenda: Annotated[str | None, Field(default=None, description="Meeting agenda text.")] = None
    invitees: Annotated[
        list[str] | None,
        Field(
            default=None,
            description="List of invitee email addresses.",
        ),
    ] = None
    recurrence: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "RFC 5545 RRULE string, e.g. 'FREQ=WEEKLY;BYDAY=MO;COUNT=10'."
            ),
        ),
    ] = None
    password: Annotated[
        str | None,
        Field(default=None, description="Optional meeting password."),
    ] = None
    enabled_auto_record_meeting: Annotated[
        bool,
        Field(
            default=False,
            description="Auto-record the meeting (transcripts require recording).",
        ),
    ] = False

    class Config:
        description = "Schedule a new Webex meeting. Sends invites to invitees."


class UpdateMeeting(BaseModel):
    meeting_id: Annotated[str, Field(description="Webex meeting ID to update.")]
    title: Annotated[str | None, Field(default=None)] = None
    start: Annotated[str | None, Field(default=None)] = None
    end: Annotated[str | None, Field(default=None)] = None
    agenda: Annotated[str | None, Field(default=None)] = None
    password: Annotated[str | None, Field(default=None)] = None
    invitees: Annotated[
        list[str] | None,
        Field(
            default=None,
            description=(
                "Replacement invitee list; sends update emails to added/removed users."
            ),
        ),
    ] = None
    enabled_auto_record_meeting: Annotated[bool | None, Field(default=None)] = None

    class Config:
        description = "Update an existing Webex meeting (PUT semantics)."


class DeleteMeeting(BaseModel):
    meeting_id: Annotated[str, Field(description="Webex meeting ID to delete.")]
    send_email: Annotated[
        bool,
        Field(default=True, description="Send cancellation emails to invitees."),
    ] = True

    class Config:
        description = "Delete a scheduled Webex meeting."


class ListRecordings(BaseModel):
    meeting_id: Annotated[
        str | None,
        Field(default=None, description="Filter recordings to a single meeting."),
    ] = None
    from_iso: Annotated[str | None, Field(default=None)] = None
    to_iso: Annotated[str | None, Field(default=None)] = None
    max_results: Annotated[int, Field(default=20, ge=1, le=100)] = 20

    class Config:
        description = "List Webex recordings the user has access to."


class ListTranscripts(BaseModel):
    meeting_id: Annotated[
        str | None,
        Field(default=None, description="Filter transcripts to a single meeting."),
    ] = None
    from_iso: Annotated[str | None, Field(default=None)] = None
    to_iso: Annotated[str | None, Field(default=None)] = None
    max_results: Annotated[int, Field(default=20, ge=1, le=100)] = 20
    download: Annotated[
        bool,
        Field(
            default=False,
            description=(
                "If true, also download each transcript's body (may be slow) "
                "and inline it as `body` on each item. Feed straight into "
                "mcp_pod_meeting.parse_webex_vtt."
            ),
        ),
    ] = False
    download_format: Annotated[
        Literal["vtt", "txt"],
        Field(default="vtt", description="Body format when download=true."),
    ] = "vtt"

    class Config:
        description = (
            "List Webex meeting transcripts the user can see; optionally "
            "inline-download each transcript body."
        )


class GetMeetingSummary(BaseModel):
    meeting_id: Annotated[str, Field(description="Webex meeting ID.")]

    class Config:
        description = (
            "Fetch the Webex AI Assistant–generated summary for a meeting. "
            "Returns 'not available' if the org/user does not have AI Assistant."
        )


# ──────────────────────────── error wrapper ───────────────────────────
def _handle_errors(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except McpError:
            raise
        except httpx.TimeoutException as e:
            logger.error(f"webex_meetings timeout: {e}")
            raise McpError(ErrorData(code=INTERNAL_ERROR, message="Webex API timeout."))
        except httpx.HTTPStatusError as e:
            logger.error(f"webex_meetings http {e.response.status_code}: {e.response.text[:300]}")
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=(
                        f"Webex API HTTP {e.response.status_code}: "
                        f"{e.response.text[:300]}"
                    ),
                )
            )
        except httpx.RequestError as e:
            logger.error(f"webex_meetings request error: {e}")
            raise McpError(ErrorData(code=INTERNAL_ERROR, message=f"Webex request error: {e}"))
        except ValueError as e:
            raise McpError(ErrorData(code=INVALID_PARAMS, message=str(e)))
        except Exception as e:
            logger.exception("webex_meetings unhandled exception")
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=f"Unhandled error in webex_meetings tool: {e}",
                )
            )

    return wrapper


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _normalize_userhub_site_url(site_url: str | None) -> str:
    raw = (site_url or USERHUB_DEFAULT_SITE).strip() or USERHUB_DEFAULT_SITE
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        raise ValueError("site_url must be an HTTPS Webex site URL.")
    if host != "webex.com" and not host.endswith(".webex.com"):
        raise ValueError("site_url must point to a Webex site host, e.g. https://cisco.webex.com.")
    return f"https://{parsed.netloc}"


def _webex_link_from_text(value: Any) -> str | None:
    if not value:
        return None
    for token in str(value).replace("\n", " ").split():
        candidate = token.strip(" <>[]()'\".,;")
        parsed = urlparse(candidate)
        host = (parsed.hostname or "").lower()
        if parsed.scheme in {"http", "https"} and (
            host == "webex.com" or host.endswith(".webex.com")
        ):
            return candidate
    return None


def _userhub_time_to_iso(value: Any) -> tuple[str | None, str | None, str | None]:
    if isinstance(value, dict):
        raw_datetime = value.get("dateTime") or value.get("datetime")
        timezone_name = value.get("timeZone") or value.get("timezone")
    elif isinstance(value, str):
        raw_datetime = value
        timezone_name = None
    else:
        return None, None, None

    if not raw_datetime:
        return None, timezone_name, None

    raw_text = str(raw_datetime)
    normalized = raw_text.replace(" ", "T", 1) if " " in raw_text and "T" not in raw_text else raw_text
    parsed: datetime | None = None
    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                parsed = datetime.strptime(raw_text, fmt)
                break
            except ValueError:
                continue

    if parsed is None:
        return raw_text, timezone_name, raw_text
    if parsed.tzinfo is not None:
        return parsed.isoformat(), timezone_name, raw_text
    if timezone_name:
        try:
            return parsed.replace(tzinfo=ZoneInfo(timezone_name)).isoformat(), timezone_name, raw_text
        except ZoneInfoNotFoundError:
            return raw_text, timezone_name, raw_text
    return raw_text, timezone_name, raw_text


def _organizer_email(organizer: Any) -> str | None:
    if not isinstance(organizer, dict):
        return None
    for key in ("email", "emailAddress", "mail", "userName"):
        value = organizer.get(key)
        if value:
            return str(value)
    return None


def _normalize_userhub_calendar_item(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {"raw": item}

    start_iso, start_tz, start_raw = _userhub_time_to_iso(item.get("startTime") or item.get("start"))
    end_iso, end_tz, end_raw = _userhub_time_to_iso(item.get("endTime") or item.get("end"))
    subject = item.get("subject") or item.get("title")
    location = item.get("location")

    return {
        "id": item.get("id"),
        "seriesId": item.get("seriesId"),
        "subject": subject,
        "source": item.get("externalType") or item.get("source"),
        "start": start_iso,
        "end": end_iso,
        "timezone": start_tz or end_tz,
        "startRaw": start_raw,
        "endRaw": end_raw,
        "location": location,
        "webLink": item.get("webLink") or _webex_link_from_text(location),
        "organizerEmail": _organizer_email(item.get("organizer")),
        "organizer": item.get("organizer"),
        "occurrenceType": item.get("occurrenceType"),
        "isCancelled": item.get("isCancelled"),
        "isAllDay": item.get("isAllDay"),
        "originalStartTime": item.get("originalStartTime"),
    }


def _sanitize_sensitive(obj: Any) -> Any:
    if isinstance(obj, dict):
        clean: dict[str, Any] = {}
        for key, value in obj.items():
            key_lower = key.lower()
            if any(part in key_lower for part in SENSITIVE_KEY_SUBSTRINGS):
                continue
            clean[key] = _sanitize_sensitive(value)
        return clean
    if isinstance(obj, list):
        return [_sanitize_sensitive(value) for value in obj]
    return obj


def _extract_items(payload: Any) -> list[Any] | None:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return None
    for key in ("items", "data", "meetings", "meetingList", "calendarItems", "entries"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return None


# ─────────────────────────── tool registration ────────────────────────
def register_tools(server) -> None:
    """Register all Webex Meetings tools on the FastMCP server."""

    logger.info("🔧 Registering webex_meetings tools (REST proxy)")

    async def _request(
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        bearer = _bearer_from_request()
        headers = {
            "Authorization": bearer,
            "Accept": "application/json",
        }
        if json is not None:
            headers["Content-Type"] = "application/json"
        # New client per call so each request is fully independent and we
        # don't leak the Authorization header across users.
        async with httpx.AsyncClient(base_url=WEBEX_API_BASE, timeout=30.0) as client:
            resp = await client.request(method, path, params=params, json=json, headers=headers)
            resp.raise_for_status()
            if resp.status_code == 204 or not resp.content:
                return {"ok": True}
            ctype = resp.headers.get("content-type", "")
            if "application/json" in ctype:
                return resp.json()
            return {"ok": True, "body": resp.text}

    async def _userhub_calendar_request(site_url: str, params: dict[str, Any]) -> Any:
        bearer = _bearer_from_request()
        headers = {
            "Authorization": bearer,
            "Accept": "application/json",
        }
        base_url = _normalize_userhub_site_url(site_url)
        async with httpx.AsyncClient(base_url=base_url, timeout=30.0) as client:
            resp = await client.get(USERHUB_CALENDAR_PATH, params=params, headers=headers)
            resp.raise_for_status()
            try:
                return resp.json()
            except ValueError as e:
                raise ValueError(
                    "User Hub calendar endpoint did not return JSON. "
                    "Check that site_url is the user's Webex site, e.g. https://cisco.webex.com."
                ) from e

    @server.tool(name="webex_list_meetings")
    @_handle_errors
    async def list_meetings(args: ListMeetings) -> dict[str, Any]:
        """List/search Webex meetings."""
        params: dict[str, Any] = {"max": args.max_results}
        if args.from_iso:
            params["from"] = args.from_iso
        if args.to_iso:
            params["to"] = args.to_iso
        if args.host_email:
            params["hostEmail"] = args.host_email
        if args.meeting_type:
            params["meetingType"] = args.meeting_type
        return await _request("GET", "/meetings", params=params)

    @server.tool(name="webex_userhub_calendar")
    @_handle_errors
    async def userhub_calendar(args: UserHubCalendar) -> dict[str, Any]:
        """Read the user's Webex User Hub calendar feed."""
        params: dict[str, Any] = {
            "meetingListType": args.meeting_list_type,
            "limit": args.max_results,
        }
        payload = await _userhub_calendar_request(args.site_url, params=params)
        raw_items = _extract_items(payload)
        if raw_items is None:
            shape = (
                {"type": "dict", "keys": sorted(payload.keys())[:20]}
                if isinstance(payload, dict)
                else {"type": type(payload).__name__}
            )
            return {
                "items": [],
                "rawCount": 0,
                "filteredCount": 0,
                "siteUrl": _normalize_userhub_site_url(args.site_url),
                "meetingListType": args.meeting_list_type,
                "unexpectedShape": shape,
                "note": (
                    "User Hub calendar feed is best-effort/internal and may include "
                    "external calendar rows not present in public Webex schedule APIs."
                ),
            }

        from_dt = _parse_iso_datetime(args.from_iso)
        to_dt = _parse_iso_datetime(args.to_iso)
        if args.from_iso and from_dt is None:
            raise ValueError("from_iso must be an ISO-8601 datetime with timezone, e.g. 2026-06-12T00:00:00Z.")
        if args.to_iso and to_dt is None:
            raise ValueError("to_iso must be an ISO-8601 datetime with timezone, e.g. 2026-06-26T00:00:00Z.")
        title_filter = (args.title or "").casefold()
        normalized_items: list[dict[str, Any]] = []
        for raw_item in raw_items:
            normalized = _normalize_userhub_calendar_item(raw_item)
            subject = str(normalized.get("subject") or "")
            if title_filter and title_filter not in subject.casefold():
                continue
            start_dt = _parse_iso_datetime(normalized.get("start"))
            if start_dt is not None:
                if from_dt is not None and start_dt < from_dt:
                    continue
                if to_dt is not None and start_dt >= to_dt:
                    continue
            normalized_items.append(normalized)

        normalized_items.sort(key=lambda item: item.get("start") or "")
        return {
            "items": normalized_items,
            "rawCount": len(raw_items),
            "filteredCount": len(normalized_items),
            "siteUrl": _normalize_userhub_site_url(args.site_url),
            "meetingListType": args.meeting_list_type,
            "note": (
                "User Hub calendar feed is best-effort/internal and may include "
                "Office365/Google-backed occurrences that are not exposed as public "
                "Webex scheduledMeeting rows. Resolve Webex links separately before "
                "treating a calendar row as official Webex metadata."
            ),
        }

    @server.tool(name="webex_resolve_meeting_link")
    @_handle_errors
    async def resolve_meeting_link(args: ResolveMeetingLink) -> dict[str, Any]:
        """Resolve a Webex link through the official meetings API."""
        parsed = urlparse(args.web_link)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or (
            host != "webex.com" and not host.endswith(".webex.com")
        ):
            raise ValueError("web_link must be a Webex HTTP(S) URL.")

        payload = await _request(
            "GET",
            "/meetings",
            params={"webLink": args.web_link, "max": args.max_results},
        )
        sanitized = _sanitize_sensitive(payload)
        if isinstance(sanitized, dict):
            sanitized["queryWebLink"] = args.web_link
            sanitized["note"] = (
                "Resolved through the official Webex /v1/meetings API; "
                "password and host-key fields were removed."
            )
            return sanitized
        return {
            "items": sanitized,
            "queryWebLink": args.web_link,
            "note": (
                "Resolved through the official Webex /v1/meetings API; "
                "password and host-key fields were removed."
            ),
        }

    @server.tool(name="webex_get_meeting_status")
    @_handle_errors
    async def get_meeting_status(args: GetMeetingStatus) -> dict[str, Any]:
        """Get a single Webex meeting's metadata + optional participants."""
        meeting = await _request("GET", f"/meetings/{args.meeting_id}")
        if args.include_participants:
            try:
                participants = await _request(
                    "GET",
                    "/meetingParticipants",
                    params={"meetingId": args.meeting_id, "max": 100},
                )
                meeting["participants"] = participants.get("items", participants)
            except McpError:
                # Participants list is best-effort; not every meeting state has them.
                meeting["participants"] = []
        return meeting

    @server.tool(name="webex_create_meeting")
    @_handle_errors
    async def create_meeting(args: CreateMeeting) -> dict[str, Any]:
        """Schedule a new Webex meeting."""
        body: dict[str, Any] = {
            "title": args.title,
            "start": args.start,
            "end": args.end,
            "enabledAutoRecordMeeting": args.enabled_auto_record_meeting,
        }
        if args.agenda is not None:
            body["agenda"] = args.agenda
        if args.invitees:
            body["invitees"] = [{"email": e} for e in args.invitees]
        if args.recurrence:
            body["recurrence"] = args.recurrence
        if args.password:
            body["password"] = args.password
        return await _request("POST", "/meetings", json=body)

    @server.tool(name="webex_update_meeting")
    @_handle_errors
    async def update_meeting(args: UpdateMeeting) -> dict[str, Any]:
        """Update an existing Webex meeting (PUT semantics)."""
        # Webex PUT requires the full body; fetch current first, then merge.
        current = await _request("GET", f"/meetings/{args.meeting_id}")
        body: dict[str, Any] = {
            "title": args.title or current.get("title"),
            "start": args.start or current.get("start"),
            "end": args.end or current.get("end"),
        }
        for src_field, body_field in (
            ("agenda", "agenda"),
            ("password", "password"),
            ("enabled_auto_record_meeting", "enabledAutoRecordMeeting"),
        ):
            value = getattr(args, src_field)
            if value is not None:
                body[body_field] = value
            elif body_field in current:
                body[body_field] = current[body_field]
        if args.invitees is not None:
            body["invitees"] = [{"email": e} for e in args.invitees]
        elif "invitees" in current:
            body["invitees"] = current["invitees"]
        return await _request("PUT", f"/meetings/{args.meeting_id}", json=body)

    @server.tool(name="webex_delete_meeting")
    @_handle_errors
    async def delete_meeting(args: DeleteMeeting) -> dict[str, Any]:
        """Delete a scheduled Webex meeting."""
        params = {"sendEmail": "true" if args.send_email else "false"}
        return await _request(
            "DELETE", f"/meetings/{args.meeting_id}", params=params
        )

    @server.tool(name="webex_list_recordings")
    @_handle_errors
    async def list_recordings(args: ListRecordings) -> dict[str, Any]:
        """List Webex meeting recordings."""
        params: dict[str, Any] = {"max": args.max_results}
        if args.meeting_id:
            params["meetingId"] = args.meeting_id
        if args.from_iso:
            params["from"] = args.from_iso
        if args.to_iso:
            params["to"] = args.to_iso
        return await _request("GET", "/recordings", params=params)

    @server.tool(name="webex_list_transcripts")
    @_handle_errors
    async def list_transcripts(args: ListTranscripts) -> dict[str, Any]:
        """List Webex transcripts; optionally download each body inline."""
        params: dict[str, Any] = {"max": args.max_results}
        if args.meeting_id:
            params["meetingId"] = args.meeting_id
        if args.from_iso:
            params["from"] = args.from_iso
        if args.to_iso:
            params["to"] = args.to_iso
        listing = await _request("GET", "/meetingTranscripts", params=params)
        items = listing.get("items", []) if isinstance(listing, dict) else []
        if args.download and items:
            bearer = _bearer_from_request()
            async with httpx.AsyncClient(
                base_url=WEBEX_API_BASE, timeout=60.0
            ) as client:
                for item in items:
                    tid = item.get("id")
                    if not tid:
                        continue
                    try:
                        # NOTE: Webex's transcript download endpoint returns
                        # 406 Not Acceptable if you send a strict text/vtt or
                        # text/plain Accept header. Send Accept: */* and let
                        # the server pick (it returns text either way).
                        r = await client.get(
                            f"/meetingTranscripts/{tid}/download",
                            params={"format": args.download_format},
                            headers={
                                "Authorization": bearer,
                                "Accept": "*/*",
                            },
                        )
                        r.raise_for_status()
                        item["body"] = r.text
                        item["bodyFormat"] = args.download_format
                    except httpx.HTTPStatusError as e:
                        item["body"] = None
                        item["bodyError"] = (
                            f"HTTP {e.response.status_code}: {e.response.text[:200]}"
                        )
            listing["items"] = items
        return listing

    # NOTE: webex_get_meeting_summary was removed. The Cisco /v1/meetings/summaries
    # endpoint we mirrored doesn't exist on the public Webex REST API — Webex
    # parses the path as /v1/meetings/{id}/ where id="summaries" and 400s with
    # "Invalid meeting id". The agent should rely on webex_list_transcripts
    # (download=true) + LLM summarization for now. Re-add this tool once Cisco
    # publishes a real public AI-summary endpoint.

    logger.info("✅ Registered webex_meetings tools")

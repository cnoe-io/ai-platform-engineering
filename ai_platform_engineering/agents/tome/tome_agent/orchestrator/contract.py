"""Wire contract shared by `ttt-backend` and `ttt-agent`.

Both halves of the system import from here; nothing in this module touches
sqlite, the agent SDK, or any MCP server. Keeping it dependency-free means
the agent image (which excludes the heavy backend deps) can still validate
incoming/outgoing payloads against the same schemas the backend produces.

Three groups of schemas:

1. **Agent inbound** — what the backend POSTs to the agent on `/chat` /
   `/ingest`, including the project snapshot the agent needs to build its
   system prompt.

2. **Agent → backend callbacks** — bodies the agent's persist hook and log
   appender POST back to `ttt-backend/internal/...`.

3. **SSE event types** — the wire format streamed from agent to backend
   (and proxied to the browser).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

# ---------- shared identity / project snapshot ----------


class RepoSnapshot(BaseModel):
    repo_id: int | None = None
    slug: str
    url: str
    default_branch: str = "main"


class WebexRoomSnapshot(BaseModel):
    slug: str
    name: str
    room_id: str = ""


class ConfluencePageScopeSnapshot(BaseModel):
    page_id: str
    page_title: str = ""
    include_descendants: bool = True


class ConfluenceSpaceSnapshot(BaseModel):
    slug: str
    name: str
    space_key: str
    base_url: str = ""
    root_page_id: str = ""
    root_page_title: str = ""
    include_descendants: bool = True
    page_scopes: list[ConfluencePageScopeSnapshot] = Field(default_factory=list)


class ChildProjectSnapshot(BaseModel):
    """A project tagged to a BHAG. The agent reads each child's on-disk wiki
    (materialized at `<TTT_PROJECT_ROOT>/<project_id>/` by the workspace sync)
    as one input to the BHAG/Area synthesis."""

    project_id: str  # CAIPE project id; also the on-disk workspace dir name
    slug: str = ""
    name: str = ""


class ProjectSnapshot(BaseModel):
    """Everything the agent needs to build its system prompt and run a turn.

    The backend resolves this once per request from sqlite + OAuth services
    and ships it in the `/chat` / `/ingest` body so the agent never has to
    look anything up itself."""

    project_id: str  # CAIPE project id (ObjectId hex / slug); not a UUID
    slug: str = ""  # CAIPE project slug; also the project's Mycelium Feed room name
    name: str
    charter: str = ""
    phase: str | None = None
    cadence: str | None = None
    project_type: Literal["project", "bhag", "area"] = "project"
    """Project kind. A `bhag` is a strategic goal whose wiki is synthesized by
    rolling up its `child_projects` plus directly attached sources. An `area`
    is a mid-tier grouping between a BHAG and projects and follows the same
    synthesis model."""
    repos: list[RepoSnapshot] = Field(default_factory=list)
    webex_rooms: list[WebexRoomSnapshot] = Field(default_factory=list)
    confluence_spaces: list[ConfluenceSpaceSnapshot] = Field(default_factory=list)
    child_projects: list[ChildProjectSnapshot] = Field(default_factory=list)
    """BHAG/Area only: child projects whose on-disk wikis feed synthesis."""
    readable_projects: list[ChildProjectSnapshot] = Field(default_factory=list)
    """OpenFGA-filtered projects available to cross-project read tools."""


SYNTHESIZED_PROJECT_TYPES = ("bhag", "area")
"""Project types whose primary action synthesizes child wikis and direct sources."""


def is_synthesized_type(project_type: str) -> bool:
    """True if `project_type` is a synthesized roll-up kind."""
    return project_type in SYNTHESIZED_PROJECT_TYPES


# ---------- agent inbound: /chat ----------


class ChatRequest(BaseModel):
    message: str
    sdk_session_id: str | None = None
    is_compact: bool = False
    """When true, ignore `message` and run the SDK's own `/compact` slash
    command against `sdk_session_id` (required) — summarizes the transcript
    in place rather than sending a user turn."""
    snapshot: ProjectSnapshot
    stable_pages: dict[str, str] = Field(default_factory=dict)
    """Map of `path -> markdown` for stable pages the chat prompt references
    (overview, team, architecture). Backend reads from sqlite
    before dispatching."""
    role: str = "editor"
    """The requesting user's effective role: 'viewer' or 'editor'. The agent
    container uses this to confirm its configured role (TTT_AGENT_ROLE) and
    adjust its system prompt accordingly."""
    actor_email: str | None = None
    """The chatting user's email. Used as the sender identity when the agent
    promotes a concern to the Feed (`feed_promote`), so the entry attributes
    to the actual person, not a generic "tome" handle."""
    actor_sub: str | None = None
    """The chatting user's OIDC subject (Keycloak sub). Forwarded in
    write-page callbacks so the internal API can enforce FGA can_write."""
    credentials: dict[str, dict[str, str]] = Field(default_factory=dict)
    """Per-request OAuth credentials forwarded from the caller. Keyed by
    provider slug (`github`, `atlassian`, `webex`). Each value carries
    `access_token` and optionally `expires_in` (string seconds, parse
    defensively as 0 = unknown), `cloud_id`, `site_url`. Stays in the
    request's ContextVar — never written to disk or logs."""


# ---------- agent inbound: /ingest ----------


class IngestRequest(BaseModel):
    run_id: UUID
    seed: str | None = None
    connector_data: dict[str, Any] = Field(default_factory=dict)
    snapshot: ProjectSnapshot
    is_greenfield: bool
    mode: Literal["full", "quick"] = "full"
    """"quick" skips the breadth-first source sweep and deep-research tool
    budget: the agent takes `seed` at face value and makes the targeted edit
    it describes, grounded by a few reads rather than a full research pass.
    Greenfield runs always use "full" — there's nothing to point-edit yet."""
    seed_stable_pages: bool = False
    """Opt-in (default false), greenfield only. When true the agent writes a
    best-effort DRAFT into the stable pages (charter/objectives/roadmap),
    clearly marked for human review. When false, stable pages are human-owned
    and the agent never writes them."""
    report_id: UUID
    """Backend pre-creates the `Report` row so persist-hook callbacks can
    tag revisions with it. Agent never invents these IDs."""
    credentials: dict[str, dict[str, str]] = Field(default_factory=dict)
    """Same wire shape as `ChatRequest.credentials`. The caller MUST resolve
    these synchronously before async dispatch — by the time `driveIngest`
    runs, the user's session is gone."""


# ---------- agent → backend callbacks ----------


class WritePageRequest(BaseModel):
    """POST /internal/projects/{id}/pages — the agent's persist hook."""
    path: str
    body: str
    message: str
    author: str
    report_id: UUID | None = None
    actor_sub: str | None = None
    """OIDC subject of the human who triggered this write (chat sessions only).
    The internal API checks FGA can_write for this subject when report_id is
    absent, blocking writes from callers without data-steward access."""


class AppendLogRequest(BaseModel):
    """POST /internal/projects/{id}/runs/{run_id}/log — ingest log line."""
    line: str


# ---------- SSE event wire format ----------

# Both /chat and /ingest stream `text/event-stream`. Each event has an `event`
# field naming the type and a `data` field carrying a JSON-serialized object.
# The agent emits `Event.from_chat()` / `Event.from_ingest()` and the backend
# either parses them (to update IngestRun.log) or proxies bytes through to
# the browser (chat).

ChatEventType = Literal[
    "token", "tool_call", "tool_result", "session", "done", "error", "lifecycle",
    "compact_boundary", "context_usage",
]

IngestEventType = Literal[
    "log",
    "tool_call",
    "tool_result",
    "page_written",
    "usage",
    "context_usage",
    "done",
    "error",
]


class ChatEventPayload(BaseModel):
    type: ChatEventType
    data: dict[str, Any]


class IngestEventPayload(BaseModel):
    type: IngestEventType
    data: dict[str, Any]


# ---------- agent /healthz, /readyz ----------


class HealthResponse(BaseModel):
    status: Literal["ok", "starting", "unhealthy"]
    started_at: datetime
    in_flight_runs: int = 0
    last_activity_at: datetime | None = None


__all__ = [
    "AppendLogRequest",
    "ChatEventPayload",
    "ChatEventType",
    "ChatRequest",
    "ChildProjectSnapshot",
    "ConfluenceSpaceSnapshot",
    "HealthResponse",
    "IngestEventPayload",
    "IngestEventType",
    "IngestRequest",
    "ProjectSnapshot",
    "RepoSnapshot",
    "WebexRoomSnapshot",
    "WritePageRequest",
]

# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""GitHub webhook management tools for the supervisor.

Spec #099 follow-up — lets the supervisor's main agent wire a GitHub
repo to an autonomous-agents webhook task in a single conversational
turn. Pairs with the Phase 3 ``create_autonomous_task`` tool so the
full user journey is:

    User: "Every time someone opens an issue on A-makarim/demo, message
           me on Webex and try to solve it."

    Supervisor (one turn):
      1. create_autonomous_task(trigger=webhook, prompt=<triage template>)
           -> returns task_id, callback_url, secret
      2. register_github_webhook(repo="A-makarim/demo",
                                 callback_url=<the above>,
                                 events=["issues"],
                                 secret=<same>)
           -> returns hook_id, verified event types
      3. Report success to the operator.

Why these are supervisor-level tools (not github sub-agent tools):

* Registering a webhook is intrinsically coupled to creating the
  autonomous task that receives it (the callback URL includes the
  task id). Keeping both concerns at the supervisor level means the
  LLM can atomically chain the two calls in one turn; no round trip
  through a sub-agent.
* No dependency on the github MCP server's tool list. Wrapping the
  REST API directly gives a stable contract across MCP versions.
* Symmetry with ``autonomous_tasks.py``.

Authentication:

Uses ``GITHUB_PERSONAL_ACCESS_TOKEN`` from the environment -- same
variable every other GitHub-touching piece of the stack reads. The
token needs the ``admin:repo_hook`` scope for POST/DELETE, or the
owner/admin role on the repository.

Error handling contract:

These tools never raise. Every failure path maps to a human-readable
string the LLM can relay to the operator. GitHub's REST API is
relatively predictable: 401 (bad token), 403 (missing scope), 404
(repo not found / no access), 422 (validation), 5xx (their side).
"""

from __future__ import annotations

import logging
import os
import secrets as _secrets
from typing import Any

import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

GITHUB_API_URL = "https://api.github.com"
# Accepted webhook event types we surface to the LLM. GitHub supports many
# more; this list is the common subset we expect operators to request for
# auto-triage / auto-notify workflows. The API itself accepts arbitrary
# strings so passing something not on this list is not a hard error,
# just an undocumented extension.
KNOWN_EVENTS = (
    "issues",
    "issue_comment",
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
    "push",
    "release",
    "workflow_run",
    "star",
    "fork",
    "*",  # GitHub's wildcard = every event
)


def _github_token() -> str | None:
    """Return the configured GitHub PAT or ``None`` if unset."""
    token = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN")
    return token.strip() if token else None


def _auth_headers() -> dict[str, str]:
    """Headers for any authenticated call to GitHub's REST API."""
    token = _github_token()
    if not token:
        # Callers must check this themselves; returning a header with an
        # empty Bearer value would give a misleading 401 instead of a
        # clear "token not configured" error.
        return {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _parse_repo(repo: str) -> tuple[str | None, str | None, str | None]:
    """Parse ``owner/name`` into ``(owner, name, error)``.

    The LLM occasionally hands us a full URL
    (e.g. ``https://github.com/A-makarim/CAIPE``). Accept both forms
    so the operator doesn't have to think about it.
    """
    if not repo or not isinstance(repo, str):
        return None, None, "repo must be a non-empty string like 'owner/name'"

    value = repo.strip()
    # Strip a leading https://github.com/ prefix if the LLM pasted the URL.
    for prefix in ("https://github.com/", "http://github.com/", "github.com/"):
        if value.startswith(prefix):
            value = value[len(prefix):]
            break

    # Strip trailing .git / slash so URLs like .../repo.git work.
    value = value.rstrip("/")
    if value.endswith(".git"):
        value = value[: -len(".git")]

    if "/" not in value:
        return None, None, f"'{repo}' is not in 'owner/name' form"

    owner, _, name = value.partition("/")
    if not owner or not name or "/" in name:
        return None, None, f"'{repo}' is not a valid 'owner/name' identifier"
    return owner, name, None


def _format_http_error(exc: httpx.HTTPStatusError) -> str:
    """Turn GitHub's error response into something an LLM can present.

    GitHub returns JSON like ``{"message": "...", "errors": [...]}``
    for most 4xx paths. Fall back to raw text for the rare cases that
    don't (rate limiting returns a plain-text message in some edge
    configurations).
    """
    status = exc.response.status_code
    message = ""
    try:
        body = exc.response.json()
    except ValueError:
        body = None

    if isinstance(body, dict):
        message = str(body.get("message") or "").strip()
        errors = body.get("errors")
        if isinstance(errors, list) and errors:
            # Collapse validation errors into a readable one-liner.
            bits: list[str] = []
            for e in errors:
                if isinstance(e, dict):
                    bits.append(
                        " ".join(
                            str(v)
                            for v in (e.get("resource"), e.get("field"), e.get("code"), e.get("message"))
                            if v
                        )
                    )
                else:
                    bits.append(str(e))
            if bits:
                message = f"{message} ({'; '.join(bits)})" if message else "; ".join(bits)

    if not message:
        message = exc.response.text or str(exc)

    # Tailor the hint for the most common operator-facing cases so the
    # LLM can offer useful remediation without thinking too hard.
    hint = ""
    if status == 401:
        hint = " (Check GITHUB_PERSONAL_ACCESS_TOKEN.)"
    elif status == 403:
        hint = (
            " (Token may lack the 'admin:repo_hook' scope, or the repo "
            "may require SSO authorization for this token.)"
        )
    elif status == 404:
        hint = " (Repo not found, or the token has no access to it.)"
    elif status == 422:
        hint = " (GitHub rejected the webhook config — likely a duplicate URL or bad event name.)"

    return f"HTTP {status}: {message}{hint}"


def _format_transport_error(exc: httpx.TransportError) -> str:
    """Format a network-layer error (DNS, connect refused, TLS, timeout)."""
    return (
        "Could not reach GitHub's API "
        f"({exc.__class__.__name__}: {exc}). "
        "Verify the machine has internet connectivity."
    )


def _format_hook(hook: dict[str, Any], repo: str) -> str:
    """One-line summary of a webhook for LLM-facing responses."""
    hook_id = hook.get("id", "?")
    config = hook.get("config") or {}
    url = config.get("url", "?")
    events = hook.get("events") or []
    events_str = ",".join(events) if events else "(none)"
    active = hook.get("active", True)
    state = "active" if active else "inactive"
    return f"  hook#{hook_id} on {repo} -> {url}  events=[{events_str}]  {state}"


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
def register_github_webhook(
    repo: str,
    callback_url: str,
    events: list[str] | None = None,
    secret: str | None = None,
    active: bool = True,
) -> str:
    """Register a webhook on a GitHub repository so events POST to ``callback_url``.

    This is how the supervisor wires a GitHub repository to an
    autonomous-agents webhook task. After calling
    ``create_autonomous_task(trigger=webhook, ...)`` to get a
    ``callback_url`` and ``secret``, call this tool to tell GitHub to
    start sending events there.

    Args:
        repo: Repository identifier, ``"owner/name"`` (e.g. ``"A-makarim/CAIPE"``).
            The tool also tolerates a full GitHub URL.
        callback_url: Where GitHub will POST event payloads. MUST be a
            public HTTPS URL reachable from GitHub's servers. In dev,
            use ngrok or similar (``https://<id>.ngrok.io/hooks/...``).
        events: List of GitHub event names to subscribe to. Defaults to
            ``["issues"]``. Use ``["*"]`` for all events. See
            ``KNOWN_EVENTS`` in this module for the common subset.
        secret: HMAC-SHA256 secret. GitHub uses this to sign each
            delivery with an ``X-Hub-Signature-256`` header so your
            receiver can verify the request is genuinely from GitHub.
            If ``None``, a fresh 32-byte hex secret is generated.
            The receiver MUST be configured with the same value; this
            is typically the secret returned by
            ``create_autonomous_task``.
        active: Whether the webhook fires on events. Default ``True``.
            Set ``False`` to register but temporarily suspend delivery.

    Returns:
        A human-readable status string the LLM can relay to the user.
        On success: includes the GitHub hook id, the configured URL,
        the events list, and the secret when it was auto-generated
        (so the operator can wire a receiver manually if needed).
        On failure: the GitHub error message plus a remediation hint.
    """
    owner, name, err = _parse_repo(repo)
    if err:
        return f"Could not register webhook: {err}"

    token = _github_token()
    if not token:
        return (
            "Could not register webhook: GITHUB_PERSONAL_ACCESS_TOKEN is not "
            "set in the environment. Configure it (with 'admin:repo_hook' "
            "scope) and retry."
        )

    if not callback_url or not isinstance(callback_url, str):
        return "Could not register webhook: callback_url must be a non-empty URL string"

    callback_url = callback_url.strip()
    if not callback_url.startswith(("http://", "https://")):
        return (
            "Could not register webhook: callback_url must start with http(s). "
            f"Got: {callback_url}"
        )

    if events is None or len(events) == 0:
        events = ["issues"]

    if secret is None:
        secret = _secrets.token_hex(32)
        secret_generated = True
    else:
        secret_generated = False

    payload = {
        "name": "web",  # GitHub's only accepted value for repo webhooks
        "active": bool(active),
        "events": list(events),
        "config": {
            "url": callback_url,
            "content_type": "json",
            "insecure_ssl": "0",
            "secret": secret,
        },
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                f"{GITHUB_API_URL}/repos/{owner}/{name}/hooks",
                headers=_auth_headers(),
                json=payload,
            )
            resp.raise_for_status()
            hook = resp.json()
    except httpx.HTTPStatusError as exc:
        return f"Could not register webhook on {owner}/{name}: {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Could not register webhook on {owner}/{name}: {_format_transport_error(exc)}"
    except ValueError as exc:
        return (
            f"Webhook registered but GitHub's response was not JSON: {exc}. "
            "Check github.com in the browser to verify."
        )

    hook_id = hook.get("id", "?")
    resolved_url = (hook.get("config") or {}).get("url", callback_url)
    resolved_events = hook.get("events") or events

    lines = [
        f"Webhook registered on {owner}/{name} (hook_id={hook_id}).",
        f"  events: {', '.join(resolved_events)}",
        f"  callback: {resolved_url}",
        "  signing: HMAC-SHA256 via X-Hub-Signature-256",
    ]
    if secret_generated:
        # Surface the secret exactly once so the operator can configure
        # their receiver if they're wiring this outside the autonomous
        # task flow. We intentionally do not log it.
        lines.append(
            f"  (auto-generated secret: {secret} — store it in the "
            "task's trigger config or WEBHOOK_SECRET)"
        )
    return "\n".join(lines)


@tool
def list_github_webhooks(repo: str) -> str:
    """List all webhooks currently registered on a GitHub repository.

    Useful when the operator asks "what's already wired up on this
    repo?" before adding a new one (avoids duplicate registrations
    that GitHub may or may not accept) or when cleaning up.

    Args:
        repo: ``"owner/name"`` or a full GitHub repo URL.

    Returns:
        A human-readable list of webhooks (id, callback URL, events,
        active state) or "No webhooks registered" if the repo is clean.
    """
    owner, name, err = _parse_repo(repo)
    if err:
        return f"Could not list webhooks: {err}"

    if not _github_token():
        return (
            "Could not list webhooks: GITHUB_PERSONAL_ACCESS_TOKEN is not "
            "set in the environment."
        )

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(
                f"{GITHUB_API_URL}/repos/{owner}/{name}/hooks",
                headers=_auth_headers(),
            )
            resp.raise_for_status()
            hooks = resp.json()
    except httpx.HTTPStatusError as exc:
        return f"Could not list webhooks on {owner}/{name}: {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Could not list webhooks on {owner}/{name}: {_format_transport_error(exc)}"
    except ValueError as exc:
        return f"Could not list webhooks on {owner}/{name}: response was not JSON ({exc})"

    if not isinstance(hooks, list):
        return f"Could not list webhooks on {owner}/{name}: unexpected response shape"

    if not hooks:
        return f"No webhooks registered on {owner}/{name}."

    lines = [f"Webhooks on {owner}/{name} ({len(hooks)} total):"]
    for hook in hooks:
        if isinstance(hook, dict):
            lines.append(_format_hook(hook, f"{owner}/{name}"))
    return "\n".join(lines)


@tool
def delete_github_webhook(repo: str, hook_id: int) -> str:
    """Delete a webhook from a GitHub repository by id.

    Args:
        repo: ``"owner/name"`` or a full GitHub repo URL.
        hook_id: Numeric id of the webhook. Get it from
            ``list_github_webhooks``.

    Returns:
        Success string on 204, a failure description otherwise.
    """
    owner, name, err = _parse_repo(repo)
    if err:
        return f"Could not delete webhook: {err}"

    if not _github_token():
        return (
            "Could not delete webhook: GITHUB_PERSONAL_ACCESS_TOKEN is not "
            "set in the environment."
        )

    if not isinstance(hook_id, int) or hook_id <= 0:
        return (
            f"Could not delete webhook: hook_id must be a positive integer, "
            f"got {hook_id!r}. Use list_github_webhooks to find the id."
        )

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.delete(
                f"{GITHUB_API_URL}/repos/{owner}/{name}/hooks/{hook_id}",
                headers=_auth_headers(),
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        return f"Could not delete webhook {hook_id} on {owner}/{name}: {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Could not delete webhook {hook_id} on {owner}/{name}: {_format_transport_error(exc)}"

    return f"Webhook {hook_id} deleted from {owner}/{name}."


@tool
def test_github_webhook(repo: str, hook_id: int) -> str:
    """Ask GitHub to send a test ``push`` event to an existing webhook.

    This triggers GitHub to redeliver the most recent ``push`` event
    (or synthesize one if the repo has no commits yet) to the
    configured callback URL. Useful for verifying end-to-end
    connectivity without waiting for real events.

    Args:
        repo: ``"owner/name"`` or a full GitHub repo URL.
        hook_id: Numeric id of the webhook to ping.

    Returns:
        Status string — "test delivery requested" on 204, error otherwise.
    """
    owner, name, err = _parse_repo(repo)
    if err:
        return f"Could not test webhook: {err}"

    if not _github_token():
        return (
            "Could not test webhook: GITHUB_PERSONAL_ACCESS_TOKEN is not "
            "set in the environment."
        )

    if not isinstance(hook_id, int) or hook_id <= 0:
        return f"Could not test webhook: hook_id must be a positive integer, got {hook_id!r}."

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                f"{GITHUB_API_URL}/repos/{owner}/{name}/hooks/{hook_id}/tests",
                headers=_auth_headers(),
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        return f"Could not test webhook {hook_id} on {owner}/{name}: {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Could not test webhook {hook_id} on {owner}/{name}: {_format_transport_error(exc)}"

    return (
        f"Test delivery requested for webhook {hook_id} on {owner}/{name}. "
        "Check the autonomous-agents logs or the 'Recent Deliveries' tab "
        "on the webhook's settings page on GitHub."
    )

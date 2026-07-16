# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Turn Slack file attachments into multimodal chat input.

When a user attaches files to a Slack message, the event carries a ``files``
array where each entry has a **private** download URL (``url_private`` /
``url_private_download``) plus metadata (``mimetype``, ``name``, ``size``).
Slack will only serve those bytes to a request that presents the bot token as
``Authorization: Bearer <token>`` — an unauthenticated fetch returns an HTML
login page, not the file.

This module downloads those bytes and base64-encodes them into the dict shape
the Dynamic Agents backend expects for ``ChatRequest.files`` (see the
``InputFile`` model): ``{"mime_type", "data", "name"}``. The backend's
``_build_user_content`` then maps each MIME type to the correct multimodal
content block (image vs document) and skips types Bedrock cannot ingest — so
this module is deliberately **type-agnostic**: it downloads whatever the user
attached and lets the backend decide what is usable.

The one transform that MUST happen here is url → base64: Bedrock's Converse API
accepts image/document data only as inline base64, never as a URL it fetches
itself. Since Slack's URLs are private (auth-gated) anyway, the model could not
reach them even if Bedrock allowed URLs.
"""

from __future__ import annotations

import base64
import logging
import os
from typing import Any, Mapping, Optional, Sequence

import requests

logger = logging.getLogger("caipe.slack_bot.file_ingest")

# Cap on a single file's raw (pre-base64) size. base64 inflates bytes ~33%, and
# every attached file rides inline in one LLM request, so an unbounded upload
# could blow the request size / cost. 20 MiB is comfortably above typical
# screenshots and PDFs while bounding worst case.
DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024

# Total cap across all files on one message, for the same reason.
DEFAULT_MAX_TOTAL_BYTES = 40 * 1024 * 1024

_DOWNLOAD_TIMEOUT_SECONDS = 30


def _resolve_bot_token(explicit: Optional[str]) -> Optional[str]:
    """Return the Slack bot token to authenticate file downloads.

    Precedence: an explicit token (e.g. the handler's ``client.token``), then
    the same env vars the Bolt app itself uses. Returns ``None`` when no token
    is available so the caller can skip ingestion rather than fire an
    unauthenticated request that would download a login page.
    """
    return (
        explicit
        or os.environ.get("SLACK_INTEGRATION_BOT_TOKEN")
        or os.environ.get("SLACK_BOT_TOKEN")
        or None
    )


def _download_one(url: str, token: str) -> bytes:
    """Fetch a single Slack private file URL with bot-token auth.

    Raises for any non-2xx response so the caller can skip that file. Slack
    serves an HTML login page (HTTP 200) for missing/invalid auth, so callers
    should also sanity-check the returned content type / size upstream.
    """
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=_DOWNLOAD_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    return resp.content


def download_slack_files(
    files: Optional[Sequence[Mapping[str, Any]]],
    *,
    bot_token: Optional[str] = None,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
) -> list[dict[str, Any]]:
    """Download Slack attachments into ``ChatRequest.files`` dicts.

    Args:
        files: The ``event["files"]`` array (or ``None``). Each entry is a
            Slack file object with ``url_private_download`` / ``url_private``,
            ``mimetype``, ``name``, and ``size``.
        bot_token: Slack bot token for the ``Authorization`` header. When
            omitted, resolved from the standard bot-token env vars.
        max_file_bytes: Skip any single file larger than this (raw bytes).
        max_total_bytes: Stop once the cumulative raw size would exceed this.

    Returns:
        A list of ``{"mime_type", "data" (base64), "name"}`` dicts, in the same
        order as the input, omitting any file that could not be downloaded,
        lacked a URL/MIME type, or exceeded the size caps. Returns ``[]`` when
        there is nothing usable (caller should send no ``files`` field).
    """
    if not files:
        return []

    token = _resolve_bot_token(bot_token)
    if not token:
        logger.warning(
            "[file_ingest] Slack attachments present but no bot token available; "
            "skipping %d file(s) — the model will not see them",
            len(files),
        )
        return []

    out: list[dict[str, Any]] = []
    total = 0
    for f in files:
        name = f.get("name")
        mime_type = f.get("mimetype")
        # url_private_download forces an attachment response; fall back to
        # url_private (inline) when the download variant is absent.
        url = f.get("url_private_download") or f.get("url_private")

        if not url or not mime_type:
            logger.warning(
                "[file_ingest] Skipping attachment (name=%r): missing url or mimetype",
                name,
            )
            continue

        # Trust Slack's declared size for a cheap pre-download guard; re-check
        # the actual byte count after download in case it is absent/wrong.
        declared = f.get("size")
        if isinstance(declared, int) and declared > max_file_bytes:
            logger.warning(
                "[file_ingest] Skipping %r: declared size %d exceeds per-file cap %d",
                name, declared, max_file_bytes,
            )
            continue

        try:
            data = _download_one(url, token)
        except Exception as exc:  # noqa: BLE001 — one bad file shouldn't sink the turn
            logger.warning(
                "[file_ingest] Failed to download %r: %s", name, exc
            )
            continue

        if len(data) > max_file_bytes:
            logger.warning(
                "[file_ingest] Skipping %r: downloaded size %d exceeds per-file cap %d",
                name, len(data), max_file_bytes,
            )
            continue

        if total + len(data) > max_total_bytes:
            logger.warning(
                "[file_ingest] Stopping ingestion at %r: total size would exceed cap %d",
                name, max_total_bytes,
            )
            break

        total += len(data)
        out.append(
            {
                "mime_type": mime_type,
                "data": base64.b64encode(data).decode("ascii"),
                "name": name,
            }
        )

    if out:
        logger.info("[file_ingest] Prepared %d/%d attachment(s) for the model", len(out), len(files))
    return out

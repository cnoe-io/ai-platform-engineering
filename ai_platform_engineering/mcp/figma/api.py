"""Small, typed-enough async client for the Figma REST API.

The client supports both Figma personal/plan access tokens (``X-Figma-Token``)
and OAuth access tokens (``Authorization: Bearer``).  When CAIPE forwards a
provider connection, the server resolves the per-request token from
``X-CAIPE-Provider-Token``; otherwise it falls back to ``FIGMA_ACCESS_TOKEN``.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from typing import Any

import httpx


DEFAULT_BASE_URL = "https://api.figma.com"
_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]+$")


class FigmaConfigurationError(RuntimeError):
  """Raised when the server cannot determine a Figma credential."""


class FigmaAPIError(RuntimeError):
  """Safe, user-facing representation of a Figma API failure."""

  def __init__(self, status_code: int, message: str) -> None:
    super().__init__(f"Figma API request failed ({status_code}): {message}")
    self.status_code = status_code
    self.message = message


def validate_identifier(value: str, field_name: str) -> str:
  """Validate a Figma path identifier without leaking arbitrary URL paths."""
  candidate = value.strip()
  if not candidate or not _IDENTIFIER.fullmatch(candidate):
    raise ValueError(f"{field_name} must be a non-empty Figma identifier")
  return candidate


# Figma's web app uses several visually similar URL shapes that are NOT
# interchangeable: a file link, a team link, a folder ("project") link, and
# personal views (recents/drafts/shared) that carry no resource ID the REST
# API accepts at all. There is no REST endpoint to list a caller's teams or
# files, so getting this classification wrong sends tools straight into a
# 403/404 with a URL segment that looked like an ID but wasn't one.
_FIGMA_HOST = r"(?:www\.)?figma\.com"
_FILE_URL = re.compile(rf"^https?://{_FIGMA_HOST}/(file|design|proto|board|slides)/([A-Za-z0-9]+)(?:[/?]|$)")
_TEAM_URL = re.compile(rf"^https?://{_FIGMA_HOST}/files/team/(\d+)(?:[/?]|$)")
_FOLDER_URL = re.compile(rf"^https?://{_FIGMA_HOST}/files/project/(\d+)(?:[/?]|$)")
_PERSONAL_VIEW_URL = re.compile(rf"^https?://{_FIGMA_HOST}/files/(?:recent|drafts|shared|\d+/recents-and-sharing)")


def parse_figma_url(url: str) -> dict[str, str | None]:
  """Classify a Figma URL and extract its file/team/folder identifier.

  Returns ``{"kind": ..., "id": ..., "reason": ...}`` where ``kind`` is one
  of ``"file"``, ``"team"``, ``"folder"``, or ``"unrecognized"``. ``id`` is
  ``None`` when unrecognized; ``reason`` explains why when it is.
  """
  candidate = url.strip()

  if _PERSONAL_VIEW_URL.match(candidate):
    return {
      "kind": "unrecognized",
      "id": None,
      "reason": (
        "This is a personal 'recently viewed'/'drafts'/'shared' view, not a resource link -- "
        "its URL segments are not valid file/team/folder IDs. Ask for a specific file, team, "
        "or folder link instead (open the item and copy the browser URL, or use its share link)."
      ),
    }

  team_match = _TEAM_URL.match(candidate)
  if team_match:
    return {"kind": "team", "id": team_match.group(1), "reason": None}

  folder_match = _FOLDER_URL.match(candidate)
  if folder_match:
    return {"kind": "folder", "id": folder_match.group(1), "reason": None}

  file_match = _FILE_URL.match(candidate)
  if file_match:
    return {"kind": "file", "id": file_match.group(2), "reason": None}

  return {
    "kind": "unrecognized",
    "id": None,
    "reason": "Doesn't match a known Figma file (/file, /design, /proto, /board, /slides), team, or folder URL.",
  }


class FigmaClient:
  """Async Figma API client with per-request authentication headers."""

  def __init__(
    self,
    access_token: str,
    *,
    auth_mode: str = "pat",
    retry_auth_mode: str | None = None,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 30.0,
    http_client: httpx.AsyncClient | None = None,
  ) -> None:
    token = access_token.strip()
    if not token:
      raise FigmaConfigurationError("No Figma access token is configured")
    mode = auth_mode.strip().lower()
    if mode not in {"pat", "oauth", "bearer"}:
      raise FigmaConfigurationError("FIGMA_AUTH_MODE must be 'pat' or 'oauth'")
    if retry_auth_mode is not None:
      retry_auth_mode = retry_auth_mode.strip().lower()
      if retry_auth_mode not in {"pat", "oauth", "bearer"}:
        raise FigmaConfigurationError("retry_auth_mode must be 'pat' or 'oauth'")
    self.access_token = token
    self.auth_mode = mode
    self.retry_auth_mode = retry_auth_mode
    self.base_url = base_url.rstrip("/")
    self.timeout = timeout
    self.http_client = http_client

  def _headers(self, auth_mode: str | None = None) -> dict[str, str]:
    if (auth_mode or self.auth_mode) in {"oauth", "bearer"}:
      return {
        "Authorization": f"Bearer {self.access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
      }
    return {
      "X-Figma-Token": self.access_token,
      "Accept": "application/json",
      "Content-Type": "application/json",
    }

  async def _send(self, method: str, url: str, params: Mapping[str, Any], json: Any, auth_mode: str) -> httpx.Response:
    request_kwargs: dict[str, Any] = {"method": method, "url": url, "headers": self._headers(auth_mode), "params": params}
    if json is not None:
      request_kwargs["json"] = json
    if self.http_client is not None:
      return await self.http_client.request(**request_kwargs)
    async with httpx.AsyncClient(timeout=self.timeout) as client:
      return await client.request(**request_kwargs)

  async def request(
    self,
    method: str,
    path: str,
    *,
    params: Mapping[str, Any] | None = None,
    json: Any = None,
  ) -> dict[str, Any]:
    """Call Figma and return its JSON object, with safe error handling.

    A forwarded ``X-CAIPE-Provider-Token`` may hold either a genuine per-user
    OAuth grant or an org-level static token relayed as-is; the header alone
    doesn't say which. When ``retry_auth_mode`` is set, a 401 on the primary
    auth mode is retried once with the same token under that mode before
    giving up.
    """
    url = f"{self.base_url}/{path.lstrip('/')}"
    clean_params = {key: value for key, value in (params or {}).items() if value is not None}

    response = await self._send(method, url, clean_params, json, self.auth_mode)
    if response.status_code == 401 and self.retry_auth_mode:
      response = await self._send(method, url, clean_params, json, self.retry_auth_mode)

    if response.is_success:
      if response.status_code == 204 or not response.content:
        return {"status": "success"}
      try:
        payload = response.json()
      except ValueError as exc:
        raise FigmaAPIError(response.status_code, "Figma returned a non-JSON response") from exc
      if not isinstance(payload, dict):
        raise FigmaAPIError(response.status_code, "Figma returned an unexpected response shape")
      return payload

    # Do not include response bodies verbatim: Figma error payloads can echo
    # request values and would make tool errors unnecessarily noisy.
    message = "request rejected"
    try:
      body = response.json()
      if isinstance(body, dict) and isinstance(body.get("message"), str):
        message = body["message"]
    except ValueError:
      pass
    raise FigmaAPIError(response.status_code, message[:500])


def client_from_environment() -> FigmaClient:
  """Build a client from the static fallback environment configuration."""
  token = os.getenv("FIGMA_ACCESS_TOKEN", "")
  return FigmaClient(
    token,
    auth_mode=os.getenv("FIGMA_AUTH_MODE", "pat"),
    base_url=os.getenv("FIGMA_BASE_URL", DEFAULT_BASE_URL),
    timeout=float(os.getenv("FIGMA_TIMEOUT_SECONDS", "30")),
  )

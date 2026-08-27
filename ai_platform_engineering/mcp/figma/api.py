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


class FigmaClient:
  """Async Figma API client with per-request authentication headers."""

  def __init__(
    self,
    access_token: str,
    *,
    auth_mode: str = "pat",
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
    self.access_token = token
    self.auth_mode = mode
    self.base_url = base_url.rstrip("/")
    self.timeout = timeout
    self.http_client = http_client

  def _headers(self) -> dict[str, str]:
    if self.auth_mode in {"oauth", "bearer"}:
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

  async def request(
    self,
    method: str,
    path: str,
    *,
    params: Mapping[str, Any] | None = None,
    json: Any = None,
  ) -> dict[str, Any]:
    """Call Figma and return its JSON object, with safe error handling."""
    request_kwargs: dict[str, Any] = {
      "method": method,
      "url": f"{self.base_url}/{path.lstrip('/')}",
      "headers": self._headers(),
      "params": {key: value for key, value in (params or {}).items() if value is not None},
    }
    if json is not None:
      request_kwargs["json"] = json

    if self.http_client is not None:
      response = await self.http_client.request(**request_kwargs)
    else:
      async with httpx.AsyncClient(timeout=self.timeout) as client:
        response = await client.request(**request_kwargs)

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

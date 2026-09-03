from __future__ import annotations

import httpx
import pytest

from api import FigmaAPIError, FigmaClient, FigmaConfigurationError, parse_figma_url, validate_identifier


@pytest.mark.asyncio
async def test_pat_request_uses_figma_token_header() -> None:
  seen: dict[str, object] = {}

  async def handler(request: httpx.Request) -> httpx.Response:
    seen["headers"] = dict(request.headers)
    seen["url"] = str(request.url)
    return httpx.Response(200, json={"name": "Example file"})

  async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
    client = FigmaClient("pat-token", http_client=http_client)
    result = await client.request("GET", "/v1/files/example", params={"depth": 2})

  assert result == {"name": "Example file"}
  assert seen["headers"]["x-figma-token"] == "pat-token"  # type: ignore[index]
  assert "depth=2" in str(seen["url"])


@pytest.mark.asyncio
async def test_oauth_request_uses_bearer_header() -> None:
  async def handler(request: httpx.Request) -> httpx.Response:
    assert request.headers["authorization"] == "Bearer oauth-token"
    return httpx.Response(200, json={"id": "user"})

  async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
    client = FigmaClient("oauth-token", auth_mode="oauth", http_client=http_client)
    assert await client.request("GET", "/v1/me") == {"id": "user"}


@pytest.mark.asyncio
async def test_oauth_401_retries_as_pat_when_configured() -> None:
  calls: list[dict[str, object]] = []

  async def handler(request: httpx.Request) -> httpx.Response:
    calls.append(dict(request.headers))
    if len(calls) == 1:
      assert request.headers["authorization"] == "Bearer figd_forwarded-token"
      return httpx.Response(401, json={"message": "request rejected"})
    assert request.headers["x-figma-token"] == "figd_forwarded-token"
    return httpx.Response(200, json={"id": "user"})

  async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
    client = FigmaClient(
      "figd_forwarded-token", auth_mode="oauth", retry_auth_mode="pat", http_client=http_client
    )
    result = await client.request("GET", "/v1/me")

  assert result == {"id": "user"}
  assert len(calls) == 2


@pytest.mark.asyncio
async def test_oauth_401_without_retry_mode_surfaces_error() -> None:
  calls: list[dict[str, object]] = []

  async def handler(request: httpx.Request) -> httpx.Response:
    calls.append(dict(request.headers))
    return httpx.Response(401, json={"message": "request rejected"})

  async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
    client = FigmaClient("oauth-token", auth_mode="oauth", http_client=http_client)
    with pytest.raises(FigmaAPIError, match="request rejected"):
      await client.request("GET", "/v1/me")

  assert len(calls) == 1


def test_invalid_retry_auth_mode_is_rejected() -> None:
  with pytest.raises(FigmaConfigurationError):
    FigmaClient("token", auth_mode="oauth", retry_auth_mode="basic")


@pytest.mark.asyncio
async def test_api_error_does_not_echo_response_body() -> None:
  async def handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(403, json={"message": "permission denied", "token": "secret-value"})

  async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
    client = FigmaClient("pat-token", http_client=http_client)
    with pytest.raises(FigmaAPIError, match="permission denied") as error:
      await client.request("GET", "/v1/me")

  assert "secret-value" not in str(error.value)


def test_identifier_validation_rejects_path_injection() -> None:
  assert validate_identifier("0:1", "node_id") == "0:1"
  with pytest.raises(ValueError):
    validate_identifier("../other-file", "file_key")


@pytest.mark.parametrize(
  "url,expected_id",
  [
    ("https://www.figma.com/file/mCSJhBUzt49P0iCbAG1SWR/My-File", "mCSJhBUzt49P0iCbAG1SWR"),
    ("https://figma.com/design/mCSJhBUzt49P0iCbAG1SWR/My-File?node-id=1-2", "mCSJhBUzt49P0iCbAG1SWR"),
    ("https://www.figma.com/proto/mCSJhBUzt49P0iCbAG1SWR/My-File", "mCSJhBUzt49P0iCbAG1SWR"),
    ("https://www.figma.com/board/mCSJhBUzt49P0iCbAG1SWR/My-Board", "mCSJhBUzt49P0iCbAG1SWR"),
    ("https://www.figma.com/slides/mCSJhBUzt49P0iCbAG1SWR/My-Slides", "mCSJhBUzt49P0iCbAG1SWR"),
  ],
)
def test_parse_figma_url_recognizes_file_links(url: str, expected_id: str) -> None:
  result = parse_figma_url(url)
  assert result == {"kind": "file", "id": expected_id, "reason": None}


def test_parse_figma_url_recognizes_team_link() -> None:
  result = parse_figma_url("https://www.figma.com/files/team/787107147284489960/My-Team")
  assert result == {"kind": "team", "id": "787107147284489960", "reason": None}


def test_parse_figma_url_recognizes_folder_link() -> None:
  result = parse_figma_url("https://www.figma.com/files/project/12345/My-Folder")
  assert result == {"kind": "folder", "id": "12345", "reason": None}


def test_parse_figma_url_flags_recently_viewed_as_unrecognized() -> None:
  result = parse_figma_url("https://www.figma.com/files/787107147284489960/recents-and-sharing/recently-viewed?fuid=1")
  assert result["kind"] == "unrecognized"
  assert result["id"] is None
  assert "recently viewed" in result["reason"]


@pytest.mark.parametrize(
  "url",
  [
    "https://www.figma.com/files/recent",
    "https://www.figma.com/files/drafts/822834698282408386",
    "https://example.com/not-figma-at-all",
  ],
)
def test_parse_figma_url_flags_other_non_resource_links(url: str) -> None:
  result = parse_figma_url(url)
  assert result["kind"] == "unrecognized"
  assert result["id"] is None

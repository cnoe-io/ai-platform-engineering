#!/usr/bin/env python3
"""CAIPE MCP server for the Figma REST API."""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from typing import Any

from dotenv import load_dotenv
from fastmcp import FastMCP
from mcp_agent_auth.middleware import MCPAuthMiddleware
from starlette.middleware import Middleware

from api import FigmaClient, FigmaConfigurationError, client_from_environment, validate_identifier


LOGGER = logging.getLogger("mcp-figma")


def _provider_token() -> tuple[str | None, bool]:
  """Return a forwarded CAIPE token and whether the header was present."""
  try:
    from fastmcp.server.dependencies import get_http_request

    request = get_http_request()
    header_present = "x-caipe-provider-token" in request.headers
    token = request.headers.get("x-caipe-provider-token", "").strip()
    return token or None, header_present
  except (ImportError, RuntimeError):
    return None, False


def get_client() -> FigmaClient:
  """Resolve the caller's Figma token before the static fallback.

  ``X-CAIPE-Provider-Token`` carries either a genuine per-user OAuth grant or
  an org-level static PAT relayed as a fallback; the header alone doesn't say
  which. Try it as an OAuth bearer token first and, if Figma rejects that
  with 401, retry the same token as a personal access token.
  """
  provider_token, header_present = _provider_token()
  if provider_token:
    return FigmaClient(
      provider_token,
      auth_mode="oauth",
      retry_auth_mode="pat",
      base_url=os.getenv("FIGMA_BASE_URL", "https://api.figma.com"),
      timeout=float(os.getenv("FIGMA_TIMEOUT_SECONDS", "30")),
    )
  if header_present:
    raise FigmaConfigurationError(
      "Figma account is not connected for this caller. Connect Figma in CAIPE Credentials and retry."
    )
  return client_from_environment()


def _params(**values: Any) -> Mapping[str, Any]:
  return {key: value for key, value in values.items() if value is not None}


async def get_file(
  file_key: str,
  *,
  version: str | None = None,
  node_ids: str | None = None,
  depth: int | None = None,
  geometry: str | None = None,
  plugin_data: str | None = None,
  branch_data: bool = False,
) -> dict[str, Any]:
  """Get a Figma file tree and metadata; use depth/node_ids for large files."""
  key = validate_identifier(file_key, "file_key")
  if depth is not None and depth < 1:
    raise ValueError("depth must be positive")
  return await get_client().request(
    "GET",
    f"/v1/files/{key}",
    params=_params(
      version=version,
      ids=node_ids,
      depth=depth,
      geometry=geometry,
      plugin_data=plugin_data,
      branch_data=str(branch_data).lower(),
    ),
  )


async def get_file_nodes(
  file_key: str,
  node_ids: str,
  *,
  version: str | None = None,
  depth: int | None = None,
  geometry: str | None = None,
  plugin_data: str | None = None,
) -> dict[str, Any]:
  """Get selected node subtrees from a Figma file."""
  key = validate_identifier(file_key, "file_key")
  if not node_ids.strip():
    raise ValueError("node_ids must not be empty")
  return await get_client().request(
    "GET",
    f"/v1/files/{key}/nodes",
    params=_params(ids=node_ids, version=version, depth=depth, geometry=geometry, plugin_data=plugin_data),
  )


async def render_file_nodes(
  file_key: str,
  node_ids: str,
  *,
  scale: float | None = None,
  image_format: str = "png",
  svg_outline_text: bool | None = None,
) -> dict[str, Any]:
  """Render selected file nodes and return temporary Figma image URLs."""
  key = validate_identifier(file_key, "file_key")
  if not node_ids.strip():
    raise ValueError("node_ids must not be empty")
  if scale is not None and not 0.01 <= scale <= 4:
    raise ValueError("scale must be between 0.01 and 4")
  if image_format not in {"jpg", "png", "svg", "pdf"}:
    raise ValueError("image_format must be one of jpg, png, svg, or pdf")
  return await get_client().request(
    "GET",
    f"/v1/images/{key}",
    params=_params(ids=node_ids, scale=scale, format=image_format, svg_outline_text=svg_outline_text),
  )


async def get_file_image_fills(file_key: str) -> dict[str, Any]:
  """Get temporary download URLs for image fills used by a file."""
  key = validate_identifier(file_key, "file_key")
  return await get_client().request("GET", f"/v1/files/{key}/images")


async def get_file_metadata(file_key: str) -> dict[str, Any]:
  """Get lightweight metadata for a Figma file."""
  key = validate_identifier(file_key, "file_key")
  return await get_client().request("GET", f"/v1/files/{key}/meta")


async def get_file_versions(file_key: str) -> dict[str, Any]:
  """Get a file's version history and pagination URLs."""
  key = validate_identifier(file_key, "file_key")
  return await get_client().request("GET", f"/v1/files/{key}/versions")


async def get_file_comments(file_key: str, *, as_markdown: bool = False) -> dict[str, Any]:
  """List comments on a Figma file."""
  key = validate_identifier(file_key, "file_key")
  return await get_client().request("GET", f"/v1/files/{key}/comments", params={"as_md": as_markdown})


async def add_file_comment(
  file_key: str,
  message: str,
  *,
  comment_id: str | None = None,
  client_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
  """Post a comment or reply to a Figma file."""
  key = validate_identifier(file_key, "file_key")
  if not message.strip():
    raise ValueError("message must not be empty")
  body: dict[str, Any] = {"message": message}
  if comment_id:
    body["comment_id"] = validate_identifier(comment_id, "comment_id")
  if client_meta is not None:
    body["client_meta"] = client_meta
  return await get_client().request("POST", f"/v1/files/{key}/comments", json=body)


async def get_current_user() -> dict[str, Any]:
  """Get the Figma user associated with the active token."""
  return await get_client().request("GET", "/v1/me")


async def list_team_folders(team_id: str) -> dict[str, Any]:
  """List top-level folders visible in a Figma team."""
  team = validate_identifier(team_id, "team_id")
  return await get_client().request("GET", f"/v2/teams/{team}/folders")


async def list_folder_subfolders(folder_id: str) -> dict[str, Any]:
  """List direct subfolders within a Figma folder."""
  folder = validate_identifier(folder_id, "folder_id")
  return await get_client().request("GET", f"/v2/folders/{folder}/folders")


async def list_folder_files(folder_id: str, *, branch_data: bool = False) -> dict[str, Any]:
  """List files directly inside a Figma folder."""
  folder = validate_identifier(folder_id, "folder_id")
  return await get_client().request(
    "GET", f"/v2/folders/{folder}/files", params={"branch_data": str(branch_data).lower()}
  )


async def get_folder_metadata(folder_id: str) -> dict[str, Any]:
  """Get lightweight metadata for a Figma folder."""
  folder = validate_identifier(folder_id, "folder_id")
  return await get_client().request("GET", f"/v2/folders/{folder}/meta")


async def list_team_components(
  team_id: str,
  *,
  page_size: int | None = None,
  after: int | None = None,
  before: int | None = None,
) -> dict[str, Any]:
  """List published components in a Figma team library."""
  team = validate_identifier(team_id, "team_id")
  return await get_client().request(
    "GET", f"/v1/teams/{team}/components", params=_params(page_size=page_size, after=after, before=before)
  )


async def list_team_styles(
  team_id: str,
  *,
  page_size: int | None = None,
  after: int | None = None,
  before: int | None = None,
) -> dict[str, Any]:
  """List published styles in a Figma team library."""
  team = validate_identifier(team_id, "team_id")
  return await get_client().request(
    "GET", f"/v1/teams/{team}/styles", params=_params(page_size=page_size, after=after, before=before)
  )


async def list_file_components(
  file_key: str,
  *,
  page_size: int | None = None,
  after: int | None = None,
  before: int | None = None,
) -> dict[str, Any]:
  """List published components in a file library."""
  key = validate_identifier(file_key, "file_key")
  return await get_client().request(
    "GET", f"/v1/files/{key}/components", params=_params(page_size=page_size, after=after, before=before)
  )


async def list_file_styles(
  file_key: str,
  *,
  page_size: int | None = None,
  after: int | None = None,
  before: int | None = None,
) -> dict[str, Any]:
  """List published styles in a file library."""
  key = validate_identifier(file_key, "file_key")
  return await get_client().request(
    "GET", f"/v1/files/{key}/styles", params=_params(page_size=page_size, after=after, before=before)
  )


async def get_file_dev_resources(file_key: str, *, node_ids: str | None = None) -> dict[str, Any]:
  """List developer resources attached to a Figma file or selected nodes."""
  key = validate_identifier(file_key, "file_key")
  return await get_client().request("GET", f"/v1/files/{key}/dev_resources", params=_params(node_ids=node_ids))


async def create_dev_resources(dev_resources: list[dict[str, Any]]) -> dict[str, Any]:
  """Create developer resources in one or more Figma files."""
  if not dev_resources:
    raise ValueError("dev_resources must not be empty")
  return await get_client().request("POST", "/v1/dev_resources", json={"dev_resources": dev_resources})


def _register_tools(mcp: FastMCP) -> None:
  for tool in (
    get_file,
    get_file_nodes,
    render_file_nodes,
    get_file_image_fills,
    get_file_metadata,
    get_file_versions,
    get_file_comments,
    add_file_comment,
    get_current_user,
    list_team_folders,
    list_folder_subfolders,
    list_folder_files,
    get_folder_metadata,
    list_team_components,
    list_team_styles,
    list_file_components,
    list_file_styles,
    get_file_dev_resources,
    create_dev_resources,
  ):
    mcp.tool()(tool)


def main() -> None:
  load_dotenv()
  logging.basicConfig(level=os.getenv("MCP_FIGMA_LOG_LEVEL", "WARNING").upper())
  mode = os.getenv("MCP_MODE", "STDIO").lower()
  host = os.getenv("MCP_HOST", "localhost")
  port = int(os.getenv("MCP_PORT", "8000"))
  server_name = os.getenv("SERVER_NAME", "FIGMA")
  mcp = FastMCP(f"{server_name} MCP Server")
  _register_tools(mcp)
  LOGGER.info("Starting Figma MCP server in %s mode on %s:%s", mode, host, port)
  if mode == "http":
    mcp.run(transport=mode, host=host, port=port, middleware=[Middleware(MCPAuthMiddleware)])
  else:
    mcp.run(transport=mode)


if __name__ == "__main__":
  main()

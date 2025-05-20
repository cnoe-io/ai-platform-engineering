"""Search operations for Confluence MCP"""

import logging
from typing import Any
from pydantic import BaseModel
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.api.client import make_api_request
import json
from typing import Annotated
from pydantic import Field
from mcp.server.fastmcp import Context

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-confluence")

async def search_confluence(
    ctx: Context,
    query: Annotated[
        str,
        Field(
            description=(
                "Search query - can be either a simple text (e.g. 'project documentation') or a CQL query string. "
                "Simple queries use 'siteSearch' by default, to mimic the WebUI search, with an automatic fallback "
                "to 'text' search if not supported. Examples of CQL:\n"
                "- Basic search: 'type=page AND space=DEV'\n"
                "- Personal space search: 'space=\"~username\"' (note: personal space keys starting with ~ must be quoted)\n"
                "- Search by title: 'title~\"Meeting Notes\"'\n"
                "- Use siteSearch: 'siteSearch ~ \"important concept\"'\n"
                "- Use text search: 'text ~ \"important concept\"'\n"
                "- Recent content: 'created >= \"2023-01-01\"'\n"
                "- Content with specific label: 'label=documentation'\n"
                "- Recently modified content: 'lastModified > startOfMonth(\"-1M\")'\n"
                "- Content modified this year: 'creator = currentUser() AND lastModified > startOfYear()'\n"
                "- Content you contributed to recently: 'contributor = currentUser() AND lastModified > startOfWeek()'\n"
                "- Content watched by user: 'watcher = \"user@domain.com\" AND type = page'\n"
                '- Exact phrase in content: \'text ~ "\\"Urgent Review Required\\"" AND label = "pending-approval"\'\n'
                '- Title wildcards: \'title ~ "Minutes*" AND (space = "HR" OR space = "Marketing")\'\n'
                'Note: Special identifiers need proper quoting in CQL: personal space keys (e.g., "~username"), '
                "reserved words, numeric IDs, and identifiers with special characters."
            )
        ),
    ],
    limit: Annotated[
        int,
        Field(
            description="Maximum number of results (1-50)",
            default=10,
            ge=1,
            le=50,
        ),
    ] = 10,
    spaces_filter: Annotated[
        str,
        Field(
            description=(
                "(Optional) Comma-separated list of space keys to filter results by. "
                "Overrides the environment variable CONFLUENCE_SPACES_FILTER if provided."
            ),
            default="",
        ),
    ] = "",
) -> str:
    """Search Confluence content using simple terms or CQL.

    Args:
        ctx: The FastMCP context.
        query: Search query - can be simple text or a CQL query string.
        limit: Maximum number of results (1-50).
        spaces_filter: Comma-separated list of space keys to filter by.

    Returns:
        JSON string representing a list of simplified Confluence page objects.
    """
    # Check if the query is a simple search term or already a CQL query
    if query and not any(
        x in query for x in ["=", "~", ">", "<", " AND ", " OR ", "currentUser()"]
    ):
        original_query = query
        try:
            query = f'siteSearch ~ "{original_query}"'
            logger.info(
                f"Converting simple search term to CQL using siteSearch: {query}"
            )
            success, response = await make_api_request(
                path="wiki/rest/api/content/search",
                method="GET",
                params={"cql": query, "limit": limit, "spaces": spaces_filter},
            )
            if not success:
                raise Exception(response.get("error", "Unknown error"))
        except Exception as e:
            logger.warning(f"siteSearch failed ('{e}'), falling back to text search.")
            query = f'text ~ "{original_query}"'
            logger.info(f"Falling back to text search with CQL: {query}")
            success, response = await make_api_request(
                path="wiki/rest/api/content/search",
                method="GET",
                params={"cql": query, "limit": limit, "spaces": spaces_filter},
            )
            if not success:
                raise Exception(response.get("error", "Unknown error"))
    else:
        success, response = await make_api_request(
            path="wiki/rest/api/content/search",
            method="GET",
            params={"cql": query, "limit": limit, "spaces": spaces_filter},
        )
        if not success:
            raise Exception(response.get("error", "Unknown error"))

    search_results = [
        {
            "id": page.get("id"),
            "title": page.get("title"),
            "url": page.get("_links", {}).get("webui"),
        }
        for page in response.get("results", [])
    ]
    return json.dumps(search_results, indent=2, ensure_ascii=False)
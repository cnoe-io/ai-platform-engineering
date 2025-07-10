"""Search operations for Confluence MCP"""

import logging
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-confluence")

async def search_confluence(
    query: str,
    limit: int = 10,
    spaces_filter: str = ""
) -> dict:
    """
    Search Confluence content using simple terms or CQL.

    Args:
        query: Search query - can be simple text or a CQL query string
        limit: Maximum number of results (1-50)
        spaces_filter: Comma-separated list of space keys to filter by

    Returns:
        Response JSON from Confluence API or error dict
    """
    # Check if the query is a simple search term or already a CQL query
    if query and not any(
        x in query for x in ["=", "~", ">", "<", " AND ", " OR ", "currentUser()"]
    ):
        original_query = query
        try:
            # Try siteSearch first (mimics the web UI search)
            query = f'siteSearch ~ "{original_query}"'
            logger.info(f"Converting simple search term to CQL using siteSearch: {query}")
            success, response = await make_api_request(
                path="wiki/rest/api/content/search",
                method="GET",
                params={"cql": query, "limit": limit, "spaces": spaces_filter}
            )
            
            if not success:
                raise Exception(response.get("error", "Unknown error"))
                
        except Exception as e:
            # Fall back to text search if siteSearch fails
            logger.warning(f"siteSearch failed ('{e}'), falling back to text search.")
            query = f'text ~ "{original_query}"'
            logger.info(f"Falling back to text search with CQL: {query}")
            success, response = await make_api_request(
                path="wiki/rest/api/content/search",
                method="GET",
                params={"cql": query, "limit": limit, "spaces": spaces_filter}
            )
            
            if not success:
                logger.error(f"Text search failed: {response}")
                return response
    else:
        # Use the provided CQL query directly
        success, response = await make_api_request(
            path="wiki/rest/api/content/search",
            method="GET",
            params={"cql": query, "limit": limit, "spaces": spaces_filter}
        )
        
        if not success:
            logger.error(f"CQL search failed: {response}")
            return response

    # Format the search results into a simpler structure
    if success:
        search_results = {
            "results": [
                {
                    "id": page.get("id"),
                    "title": page.get("title"),
                    "url": page.get("_links", {}).get("webui"),
                    "type": page.get("type"),
                    "space": page.get("space", {}).get("key") if page.get("space") else None
                }
                for page in response.get("results", [])
            ],
            "limit": limit,
            "size": len(response.get("results", [])),
            "query": query
        }
        return search_results
    else:
        return response
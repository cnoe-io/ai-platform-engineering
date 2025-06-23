# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Tools for /pet/findByTags operations"""

import logging
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from mcp_petstore.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def findPetsByTags(tags: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Finds Pets by tags.

    Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for testing.

    Returns:
        API response data
    """
    logger.debug(f"Making GET request to /pet/findByTags")
    params = {}
    data = None
    # Add parameters to request
    if tags is not None:
        params["tags"] = tags
    success, response = await make_api_request(
        "/pet/findByTags",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

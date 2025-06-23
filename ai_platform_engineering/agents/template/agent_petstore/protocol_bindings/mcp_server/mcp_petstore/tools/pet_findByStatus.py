# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Tools for /pet/findByStatus operations"""

import logging
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from mcp_petstore.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def findPetsByStatus(status: Optional[str] = None) -> Dict[str, Any]:
    """
    Finds Pets by status.

    Multiple status values can be provided with comma separated strings.

    Returns:
        API response data
    """
    logger.debug(f"Making GET request to /pet/findByStatus")
    params = {}
    data = None
    # Add parameters to request
    if status is not None:
        params["status"] = status
    success, response = await make_api_request(
        "/pet/findByStatus",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

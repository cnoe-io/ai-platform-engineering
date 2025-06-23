# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Tools for /store/inventory operations"""

import logging
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from mcp_petstore.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def getInventory() -> Dict[str, Any]:
    """
    Returns pet inventories by status.

    Returns a map of status codes to quantities.

    Returns:
        API response data
    """
    logger.debug(f"Making GET request to /store/inventory")
    params = {}
    data = None
    # Add parameters to request
    
    success, response = await make_api_request(
        "/store/inventory",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Tools for /pet operations"""

import logging
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from mcp_petstore.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def updatePet() -> Dict[str, Any]:
    """
    Update an existing pet.

    Update an existing pet by Id.

    Returns:
        API response data
    """
    logger.debug(f"Making PUT request to /pet")
    params = {}
    data = None
    # Add parameters to request
    
    success, response = await make_api_request(
        "/pet",
        method="PUT",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def addPet() -> Dict[str, Any]:
    """
    Add a new pet to the store.

    Add a new pet to the store.

    Returns:
        API response data
    """
    logger.debug(f"Making POST request to /pet")
    params = {}
    data = None
    # Add parameters to request
    
    success, response = await make_api_request(
        "/pet",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

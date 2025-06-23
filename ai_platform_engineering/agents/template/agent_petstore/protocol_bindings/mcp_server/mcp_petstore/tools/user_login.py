# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Tools for /user/login operations"""

import logging
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from mcp_petstore.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def loginUser(username: Optional[str] = None, password: Optional[str] = None) -> Dict[str, Any]:
    """
    Logs user into the system.

    Log into the system.

    Returns:
        API response data
    """
    logger.debug(f"Making GET request to /user/login")
    params = {}
    data = None
    # Add parameters to request
    if username is not None:
        params["username"] = username
    if password is not None:
        params["password"] = password
    success, response = await make_api_request(
        "/user/login",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

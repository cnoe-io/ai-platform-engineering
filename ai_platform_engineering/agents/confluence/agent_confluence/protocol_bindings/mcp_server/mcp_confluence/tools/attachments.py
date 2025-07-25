
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /attachments operations"""

import logging
import os
from typing import Dict, Any, List
from agent_confluence.protocol_bindings.mcp_server.mcp_confluence.api.client import make_api_request

# Configure logging - use LOG_LEVEL from environment or default to INFO
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
numeric_level = getattr(logging, log_level, logging.INFO)
logging.basicConfig(level=numeric_level)
logger = logging.getLogger("mcp_tools")


async def get_attachments(param_sort: str = None, param_cursor: str = None, param_status: List[str] = None, param_mediaType: str = None, param_filename: str = None, param_limit: int = None) -> Dict[str, Any]:
    """
    Get attachments

    OpenAPI Description:
        Returns all attachments. The number of results is limited by the `limit` parameter and additional results (if available)
will be available through the `next` URL present in the `Link` response header.

**[Permissions](https://confluence.atlassian.com/x/_AozKw) required**:
Permission to view the container of the attachment.

    Args:
    
        param_sort (str): Used to sort the result by a particular field.
    
        param_cursor (str): Used for pagination, this opaque cursor will be returned in the `next` URL in the `Link` response header. Use the relative URL in the `Link` header to retrieve the `next` set of results.
    
        param_status (List[str]): Filter the results to attachments based on their status. By default, `current` and `archived` are used.
    
        param_mediaType (str): Filters on the mediaType of attachments. Only one may be specified.
    
        param_filename (str): Filters on the file-name of attachments. Only one may be specified.
    
        param_limit (int): Maximum number of attachments per result to return. If more results exist, use the `Link` header to retrieve a relative URL that will return the next set of results.
    

    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
    logger.debug("Making GET request to /attachments")

    params = {}
    data = {}
     
    # Only add parameters if they have values
    if param_sort is not None:
        params["sort"] = param_sort   
    if param_cursor is not None:
        params["cursor"] = param_cursor   
    if param_status is not None:
        params["status"] = param_status   
    if param_mediaType is not None:
        params["mediaType"] = param_mediaType   
    if param_filename is not None:
        params["filename"] = param_filename   
    if param_limit is not None:
        params["limit"] = param_limit  

                

    success, response = await make_api_request(
        "/content",
        method="GET",
        params=params,
        data=data
    )

    if not success:
        error_details = response.get('error', 'Request failed')
        error_message = f"Failed to get content attachments: {error_details}"
        logger.error(error_message)
        raise Exception(error_message)
    return response

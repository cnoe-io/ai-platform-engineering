"""Tools for /mgmt/v1/apikey/validate operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def api_keys_controller_validate() -> Dict[str, Any]:
    '''
    Validates the API key by making a GET request to the API endpoint.

    This function sends a request to the '/mgmt/v1/apikey/validate' endpoint to
    validate the current API key. It constructs the necessary parameters and data
    for the request and handles the response.

    Args:
        None

    Returns:
        Dict[str, Any]: The JSON response from the API call, which includes
        validation details of the API key. If the request fails, it returns a
        dictionary with an error message.

    Raises:
        Exception: If the API request fails or returns an error, an exception is
        raised with the error details.
    '''
    logger.debug("Making GET request to /mgmt/v1/apikey/validate")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/apikey/validate", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response
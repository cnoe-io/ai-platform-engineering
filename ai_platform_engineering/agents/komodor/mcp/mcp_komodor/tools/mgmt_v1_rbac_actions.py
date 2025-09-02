"""Tools for /mgmt/v1/rbac/actions operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def actions_controller_v1_get_all() -> Dict[str, Any]:
    '''
    Fetches all actions from the RBAC management API.

    This asynchronous function makes a GET request to the /mgmt/v1/rbac/actions endpoint
    to retrieve all available actions within the RBAC management system.

    Args:
        None

    Returns:
        Dict[str, Any]: The JSON response from the API call containing the list of actions.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with
        the error details.
    '''
    logger.debug("Making GET request to /mgmt/v1/rbac/actions")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/actions", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def actions_controller_v1_post(
    body_action: str, body_description: str, body_k8sRuleset: List[str]
) -> Dict[str, Any]:
    '''
    Makes an asynchronous POST request to the /mgmt/v1/rbac/actions endpoint.

    Args:
        body_action (str): The action to be performed, specified as a string.
        body_description (str): A description of the action, specified as a string.
        body_k8sRuleset (List[str]): A list of Kubernetes rulesets associated with the action.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the result of the action or an error message.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making POST request to /mgmt/v1/rbac/actions")

    params = {}
    data = {}

    flat_body = {}
    if body_action is not None:
        flat_body["action"] = body_action
    if body_description is not None:
        flat_body["description"] = body_description
    if body_k8sRuleset is not None:
        flat_body["k8sRuleset"] = body_k8sRuleset
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/actions", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response
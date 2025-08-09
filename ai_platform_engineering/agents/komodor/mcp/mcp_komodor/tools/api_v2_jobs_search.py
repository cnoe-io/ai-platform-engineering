"""Tools for /api/v2/jobs/search operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def post_api_v2_jobs_search(
    body_scope_cluster: str = None,
    body_scope_namespaces: List[str] = None,
    body_types: List[str] = None,
    body_status: str = None,
    body_pagination_pageSize: int = None,
    body_pagination_page: int = None,
) -> Dict[str, Any]:
    '''
    Search for jobs and cron jobs.

    Search for jobs based on the provided criteria. If no criteria is provided, the default is to return all jobs.

    Args:
        body_scope_cluster (str, optional): The cluster identifier. Defaults to None.
        body_scope_namespaces (List[str], optional): A list of namespaces within the cluster. Defaults to None.
        body_types (List[str], optional): The type of the job. Defaults to None.
        body_status (str, optional): The status of the job. Defaults to None.
        body_pagination_pageSize (int, optional): The number of results returned per page. Defaults to None.
        body_pagination_page (int, optional): The page number. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making POST request to /api/v2/jobs/search")

    params = {}
    data = {}

    flat_body = {}
    if body_scope_cluster is not None:
        flat_body["scope_cluster"] = body_scope_cluster
    if body_scope_namespaces is not None:
        flat_body["scope_namespaces"] = body_scope_namespaces
    if body_types is not None:
        flat_body["types"] = body_types
    if body_status is not None:
        flat_body["status"] = body_status
    if body_pagination_pageSize is not None:
        flat_body["pagination_pageSize"] = body_pagination_pageSize
    if body_pagination_page is not None:
        flat_body["pagination_page"] = body_pagination_page
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/api/v2/jobs/search", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response
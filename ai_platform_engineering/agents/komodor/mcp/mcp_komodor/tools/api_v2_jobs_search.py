"""Tools for /api/v2/jobs/search operations"""

import logging
from typing import Any, List, Literal, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_api_v2_jobs_search(
  body_scope_cluster: Optional[str] = None,
  body_scope_namespaces: Optional[List[str]] = None,
  body_types: List[Literal["job", "cronjob"]] = None,
  body_status: Literal["failed", "running", "completed", "resumed", "suspended", "unknown"] = None,
  body_pagination_page_size: Optional[int] = None,
  body_pagination_page: Optional[int] = None,
) -> Any:
  """
  Search for jobs and cron jobs

  OpenAPI Description:
      Search for jobs based on the provided criteria. If no criteria is provided, the default is to return all jobs.

  Args:

      body_scope_cluster (str): The cluster identifier

      body_scope_namespaces (List[str]): A list of namespaces within the cluster

      body_types (List[Literal['job', 'cronjob']]): The type of the job

      body_status (Literal['failed', 'running', 'completed', 'resumed', 'suspended', 'unknown']): The status of the job

      body_pagination_page_size (int): Page the number of results returned by page size

      body_pagination_page (int): The page number


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
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
  if body_pagination_page_size is not None:
    flat_body["pagination_page_size"] = body_pagination_page_size
  if body_pagination_page is not None:
    flat_body["pagination_page"] = body_pagination_page
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/jobs/search", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response

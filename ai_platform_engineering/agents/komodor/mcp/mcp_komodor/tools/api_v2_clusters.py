"""Tools for /api/v2/clusters operations"""

import logging
from typing import Any, List, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_clusts(param_cluster_name: Optional[List[str]] = None, param_tags: Optional[List[str]] = None) -> Any:
  """
  Get list of clusters

  OpenAPI Description:
      Fetch a list of all clusters, optionally filtered by name or tags.

  Args:

      param_cluster_name (List[str]): List of cluster names to filter by.

      param_tags (List[str]): List of tags to filter by.


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/clusters")

  params = {}
  data = {}

  if param_cluster_name is not None:
    params["cluster_name"] = str(param_cluster_name).lower() if isinstance(param_cluster_name, bool) else param_cluster_name

  if param_tags is not None:
    params["tags"] = str(param_tags).lower() if isinstance(param_tags, bool) else param_tags

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/clusters", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response

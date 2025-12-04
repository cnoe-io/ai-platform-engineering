"""Tools for /api/v2/rbac/kubeconfig operations"""

import logging
from typing import Any, List, Literal, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_rbac_kubeconfig(
  param_cluster_name: Optional[List[str]] = None, param_kubeconfig_connection: Literal["direct", "proxy", "both"] = None
) -> Any:
  """
  Download Kubeconfig File

  OpenAPI Description:
      Download a kubeconfig file for the specified cluster names. If no cluster names are specified, the kubeconfig file for all available clusters will be returned.

  Args:

      param_cluster_name (List[str]): List of cluster names to filter by.

      param_kubeconfig_connection (Literal['direct', 'proxy', 'both']): The connection type to use for the kubeconfig file.


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/rbac/kubeconfig")

  params = {}
  data = {}

  if param_cluster_name is not None:
    params["cluster_name"] = str(param_cluster_name).lower() if isinstance(param_cluster_name, bool) else param_cluster_name

  if param_kubeconfig_connection is not None:
    params["kubeconfig_connection"] = (
      str(param_kubeconfig_connection).lower() if isinstance(param_kubeconfig_connection, bool) else param_kubeconfig_connection
    )

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/kubeconfig", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response

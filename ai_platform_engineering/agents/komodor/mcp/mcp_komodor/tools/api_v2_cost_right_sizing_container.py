"""Tools for /api/v2/cost/right-sizing/container operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_cost_container(param_cluster_name: str, param_namespace: str, param_service_kind: str, param_service_name: str) -> Any:
  """
  Get cost right-sizing summary per container.

  OpenAPI Description:
      Get cost right-sizing summary per container.

  Args:

      param_cluster_name (str): The name of the cluster.

      param_namespace (str): The name of the namespace.

      param_service_kind (str): The service kind (e.g. Deployment, StatefulSet, CronJob etc.)

      param_service_name (str): The service name


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/cost/right-sizing/container")

  params = {}
  data = {}

  if param_cluster_name is not None:
    params["cluster_name"] = str(param_cluster_name).lower() if isinstance(param_cluster_name, bool) else param_cluster_name

  if param_namespace is not None:
    params["namespace"] = str(param_namespace).lower() if isinstance(param_namespace, bool) else param_namespace

  if param_service_kind is not None:
    params["service_kind"] = str(param_service_kind).lower() if isinstance(param_service_kind, bool) else param_service_kind

  if param_service_name is not None:
    params["service_name"] = str(param_service_name).lower() if isinstance(param_service_name, bool) else param_service_name

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/cost/right-sizing/container", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response

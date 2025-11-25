"""Tools for /api/v2/integrations/kubernetes/{id} operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def del_del_api_id(path_id: str) -> Any:
  """
  Delete Kubernetes Integration by ID

  OpenAPI Description:
      Delete a specific Kubernetes integration by its ID

  Args:

      path_id (str): The ID of the Kubernetes integration to delete


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /api/v2/integrations/kubernetes/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/integrations/kubernetes/{path_id}", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response

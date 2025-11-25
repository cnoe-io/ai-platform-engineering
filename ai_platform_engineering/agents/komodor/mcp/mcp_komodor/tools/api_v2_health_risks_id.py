"""Tools for /api/v2/health/risks/{id} operations"""

import logging
from typing import Any, Literal
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_health_risk_data(path_id: str) -> Any:
  """
  Get health risk data.

  OpenAPI Description:
      Get health risk data.

  Args:

      path_id (str): OpenAPI parameter corresponding to 'path_id'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/health/risks/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/health/risks/{path_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def put_upd_health_risk_status(
  path_id: str, body_status: Literal["open", "confirmed", "resolved", "dismissed", "ignored", "manually_resolved"] = None
) -> Any:
  """
  Update the status of a health risk.

  OpenAPI Description:
      Update the status of a health risk.

  Args:

      path_id (str): OpenAPI parameter corresponding to 'path_id'

      body_status (Literal['open', 'confirmed', 'resolved', 'dismissed', 'ignored', 'manually_resolved']): OpenAPI parameter corresponding to 'body_status'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /api/v2/health/risks/{id}")

  params = {}
  data = {}

  flat_body = {}
  if body_status is not None:
    flat_body["status"] = body_status
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/health/risks/{path_id}", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response

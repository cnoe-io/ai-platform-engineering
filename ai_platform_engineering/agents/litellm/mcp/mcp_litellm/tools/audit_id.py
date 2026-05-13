"""Tools for /audit/{id} operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_audit_log_id_audit_id_get(path_id: str) -> Any:
  """
      Get Audit Log By Id

      OpenAPI Description:
          Get detailed information about a specific audit log entry by its ID.

  Args:
      id (str): The unique identifier of the audit log entry

  Returns:
      AuditLogResponse: Detailed information about the audit log entry

  Raises:
      HTTPException: If the audit log is not found or if there's a database connection error

      Args:

          path_id (str): OpenAPI parameter corresponding to 'path_id'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /audit/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/audit/{path_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

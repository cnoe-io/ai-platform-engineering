"""Tools for /api/v2/users/effective-permissions operations"""

import logging
from typing import Any, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_api_perms(param_id: Optional[str] = None, param_email: Optional[str] = None) -> Any:
  """
  Get User's Effective Permissions

  OpenAPI Description:
      Get user's effective permissions by either user id or email.

  Args:

      param_id (str): OpenAPI parameter corresponding to 'param_id'

      param_email (str): OpenAPI parameter corresponding to 'param_email'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/users/effective-permissions")

  params = {}
  data = {}

  if param_id is not None:
    params["id"] = str(param_id).lower() if isinstance(param_id, bool) else param_id

  if param_email is not None:
    params["email"] = str(param_email).lower() if isinstance(param_email, bool) else param_email

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/users/effective-permissions", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response

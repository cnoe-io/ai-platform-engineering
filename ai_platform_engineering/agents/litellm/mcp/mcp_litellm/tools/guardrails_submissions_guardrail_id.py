"""Tools for /guardrails/submissions/{guardrail_id} operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_guardrail_get(path_guardrail_id: str) -> Any:
  """
  Get Guardrail Submission

  OpenAPI Description:
      Get a single guardrail submission by id. Non-admins may only access submissions for teams they belong to.

  Args:

      path_guardrail_id (str): OpenAPI parameter corresponding to 'path_guardrail_id'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /guardrails/submissions/{guardrail_id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/guardrails/submissions/{path_guardrail_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

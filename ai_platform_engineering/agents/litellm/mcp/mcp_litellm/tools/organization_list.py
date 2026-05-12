"""Tools for /organization/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_organization_get(param_org_id: str | None = None, param_org_alias: str | None = None) -> Any:
  """
      List Organization

      OpenAPI Description:
          Get a list of organizations with optional filtering.

  Parameters:
      org_id: Optional[str]
          Filter organizations by exact organization_id match
      org_alias: Optional[str]
          Filter organizations by partial organization_alias match (case-insensitive)

  Example:
  ```
  curl --location --request GET 'http://0.0.0.0:4000/organization/list?org_alias=my-org'         --header 'Authorization: Bearer <litellm-api-key>'
  ```

  Example with org_id:
  ```
  curl --location --request GET 'http://0.0.0.0:4000/organization/list?org_id=123e4567-e89b-12d3-a456-426614174000'         --header 'Authorization: Bearer <litellm-api-key>'
  ```

      Args:

          param_org_id (str): Filter organizations by exact organization_id match

          param_org_alias (str): Filter organizations by partial organization_alias match. Supports case-insensitive search.


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /organization/list")

  params = {}
  data = {}

  if param_org_id is not None:
    params["org_id"] = str(param_org_id).lower() if isinstance(param_org_id, bool) else param_org_id

  if param_org_alias is not None:
    params["org_alias"] = str(param_org_alias).lower() if isinstance(param_org_alias, bool) else param_org_alias

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/organization/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

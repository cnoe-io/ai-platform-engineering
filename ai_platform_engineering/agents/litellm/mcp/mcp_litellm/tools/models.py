"""Tools for /models operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_model_ls_models_get(
  param_return_wildcard_routes: str | None = None,
  param_team_id: str | None = None,
  param_include_model_access_groups: str | None = None,
  param_only_model_access_groups: str | None = None,
  param_include_metadata: str | None = None,
  param_fallback_type: str | None = None,
  param_scope: str | None = None,
) -> Any:
  """
      Model List

      OpenAPI Description:
          Use `/model/info` - to get detailed model information, example - pricing, mode, etc.

  This is just for compatibility with openai projects like aider.

  Query Parameters:
  - include_metadata: Include additional metadata in the response with fallback information
  - fallback_type: Type of fallbacks to include ("general", "context_window", "content_policy")
                  Defaults to "general" when include_metadata=true
  - scope: Optional scope parameter. Currently only accepts "expand".
           When scope=expand is passed, proxy admins, team admins, and org admins
           will receive all proxy models as if they are a proxy admin.

      Args:

          param_return_wildcard_routes (str): OpenAPI parameter corresponding to 'param_return_wildcard_routes'

          param_team_id (str): OpenAPI parameter corresponding to 'param_team_id'

          param_include_model_access_groups (str): OpenAPI parameter corresponding to 'param_include_model_access_groups'

          param_only_model_access_groups (str): OpenAPI parameter corresponding to 'param_only_model_access_groups'

          param_include_metadata (str): OpenAPI parameter corresponding to 'param_include_metadata'

          param_fallback_type (str): OpenAPI parameter corresponding to 'param_fallback_type'

          param_scope (str): OpenAPI parameter corresponding to 'param_scope'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /models")

  params = {}
  data = {}

  if param_return_wildcard_routes is not None:
    params["return_wildcard_routes"] = (
      str(param_return_wildcard_routes).lower() if isinstance(param_return_wildcard_routes, bool) else param_return_wildcard_routes
    )

  if param_team_id is not None:
    params["team_id"] = str(param_team_id).lower() if isinstance(param_team_id, bool) else param_team_id

  if param_include_model_access_groups is not None:
    params["include_model_access_groups"] = (
      str(param_include_model_access_groups).lower()
      if isinstance(param_include_model_access_groups, bool)
      else param_include_model_access_groups
    )

  if param_only_model_access_groups is not None:
    params["only_model_access_groups"] = (
      str(param_only_model_access_groups).lower() if isinstance(param_only_model_access_groups, bool) else param_only_model_access_groups
    )

  if param_include_metadata is not None:
    params["include_metadata"] = str(param_include_metadata).lower() if isinstance(param_include_metadata, bool) else param_include_metadata

  if param_fallback_type is not None:
    params["fallback_type"] = str(param_fallback_type).lower() if isinstance(param_fallback_type, bool) else param_fallback_type

  if param_scope is not None:
    params["scope"] = str(param_scope).lower() if isinstance(param_scope, bool) else param_scope

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/models", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

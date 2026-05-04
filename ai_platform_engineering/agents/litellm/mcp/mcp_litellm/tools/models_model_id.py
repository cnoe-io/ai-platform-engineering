"""Tools for /models/{model_id} operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_model_info_models_model_id_get(path_model_id: str) -> Any:
  """
      Model Info

      OpenAPI Description:
          Retrieve information about a specific model accessible to your API key.

  Returns model details only if the model is available to your API key/team.
  Returns 404 if the model doesn't exist or is not accessible.

  Follows OpenAI API specification for individual model retrieval.
  https://platform.openai.com/docs/api-reference/models/retrieve

      Args:

          path_model_id (str): OpenAPI parameter corresponding to 'path_model_id'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /models/{model_id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/models/{path_model_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

"""Tools for /model/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_model_info_v1_model_info_get(param_litellm_model_id: str | None = None) -> Any:
  """
      Model Info V1

      OpenAPI Description:
          Provides more info about each model in /models, including config.yaml descriptions (except api key and api base)

  Parameters:
      litellm_model_id: Optional[str] = None (this is the value of `x-litellm-model-id` returned in response headers)

      - When litellm_model_id is passed, it will return the info for that specific model
      - When litellm_model_id is not passed, it will return the info for all models

  Returns:
      Returns a dictionary containing information about each model.

  Example Response:
  ```json
  {
      "data": [
                  {
                      "model_name": "fake-openai-endpoint",
                      "litellm_params": {
                          "api_base": "https://exampleopenaiendpoint-production.up.railway.app/",
                          "model": "openai/fake"
                      },
                      "model_info": {
                          "id": "112f74fab24a7a5245d2ced3536dd8f5f9192c57ee6e332af0f0512e08bed5af",
                          "db_model": false
                      }
                  }
              ]
  }

  ```

      Args:

          param_litellm_model_id (str): OpenAPI parameter corresponding to 'param_litellm_model_id'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /model/info")

  params = {}
  data = {}

  if param_litellm_model_id is not None:
    params["litellm_model_id"] = str(param_litellm_model_id).lower() if isinstance(param_litellm_model_id, bool) else param_litellm_model_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/model/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

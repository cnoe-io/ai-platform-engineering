"""Tools for /guardrails/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_guardrails_get() -> Any:
  """
      List Guardrails

      OpenAPI Description:
          List the guardrails that are available on the proxy server

  👉 [Guardrail docs](https://docs.litellm.ai/docs/proxy/guardrails/quick_start)

  Example Request:
  ```bash
  curl -X GET "http://localhost:4000/guardrails/list" -H "Authorization: Bearer <your_api_key>"
  ```

  Example Response:
  ```json
  {
      "guardrails": [
          {
          "guardrail_name": "bedrock-pre-guard",
          "guardrail_info": {
              "params": [
              {
                  "name": "toxicity_score",
                  "type": "float",
                  "description": "Score between 0-1 indicating content toxicity level"
              },
              {
                  "name": "pii_detection",
                  "type": "boolean"
              }
              ]
          }
          }
      ]
  }
  ```

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /guardrails/list")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/guardrails/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

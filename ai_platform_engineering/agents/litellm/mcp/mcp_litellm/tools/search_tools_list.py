"""Tools for /search_tools/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_search_get() -> Any:
  """
      List Search Tools

      OpenAPI Description:
          List all search tools that are available in the database and config file.

  Example Request:
  ```bash
  curl -X GET "http://localhost:4000/search_tools/list" -H "Authorization: Bearer <litellm-api-key>"
  ```

  Example Response:
  ```json
  {
      "search_tools": [
          {
              "search_tool_id": "123e4567-e89b-12d3-a456-426614174000",
              "search_tool_name": "litellm-search",
              "litellm_params": {
                  "search_provider": "perplexity",
                  "api_key": "sk-***",
                  "api_base": "https://api.perplexity.ai"
              },
              "search_tool_info": {
                  "description": "Perplexity search tool"
              },
              "created_at": "2023-11-09T12:34:56.789Z",
              "updated_at": "2023-11-09T12:34:56.789Z",
              "is_from_config": false
          },
          {
              "search_tool_name": "config-search-tool",
              "litellm_params": {
                  "search_provider": "tavily",
                  "api_key": "tvly-***"
              },
              "is_from_config": true
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
  logger.debug("Making GET request to /search_tools/list")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/search_tools/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

"""Tools for /search_tools/ui/available_providers operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_available_get() -> Any:
  """
    Get Available Search Providers

    OpenAPI Description:
        Get the list of available search providers with their configuration fields.

Auto-discovers search providers and their UI-friendly names from transformation configs.

Example Request:
```bash
curl -X GET "http://localhost:4000/search_tools/ui/available_providers" \
    -H "Authorization: Bearer <litellm-api-key>"
```

Example Response:
```json
{
    "providers": [
        {
            "provider_name": "perplexity",
            "ui_friendly_name": "Perplexity"
        },
        {
            "provider_name": "tavily",
            "ui_friendly_name": "Tavily"
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
  logger.debug("Making GET request to /search_tools/ui/available_providers")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/search_tools/ui/available_providers", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

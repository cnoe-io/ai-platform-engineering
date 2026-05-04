"""Tools for /model_group/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_model_group_get(param_model_group: str | None = None) -> Any:
  """
      Model Group Info

      OpenAPI Description:
          Get information about all the deployments on litellm proxy, including config.yaml descriptions (except api key and api base)

  - /model_group/info returns all model groups. End users of proxy should use /model_group/info since those models will be used for /chat/completions, /embeddings, etc.
  - /model_group/info?model_group=rerank-english-v3.0 returns all model groups for a specific model group (`model_name` in config.yaml)



  Example Request (All Models):
  ```shell
  curl -X 'GET'     'http://localhost:4000/model_group/info'     -H 'accept: application/json'     -H 'x-api-key: sk-1234'
  ```

  Example Request (Specific Model Group):
  ```shell
  curl -X 'GET'     'http://localhost:4000/model_group/info?model_group=rerank-english-v3.0'     -H 'accept: application/json'     -H 'Authorization: Bearer sk-1234'
  ```

  Example Request (Specific Wildcard Model Group): (e.g. `model_name: openai/*` on config.yaml)
  ```shell
  curl -X 'GET'     'http://localhost:4000/model_group/info?model_group=openai/tts-1'
  -H 'accept: application/json'     -H 'Authorization: Bearersk-1234'
  ```

  Learn how to use and set wildcard models [here](https://docs.litellm.ai/docs/wildcard_routing)

  Example Response:
  ```json
      {
          "data": [
              {
              "model_group": "rerank-english-v3.0",
              "providers": [
                  "cohere"
              ],
              "max_input_tokens": null,
              "max_output_tokens": null,
              "input_cost_per_token": 0.0,
              "output_cost_per_token": 0.0,
              "mode": null,
              "tpm": null,
              "rpm": null,
              "supports_parallel_function_calling": false,
              "supports_vision": false,
              "supports_function_calling": false,
              "supported_openai_params": [
                  "stream",
                  "temperature",
                  "max_tokens",
                  "logit_bias",
                  "top_p",
                  "frequency_penalty",
                  "presence_penalty",
                  "stop",
                  "n",
                  "extra_headers"
              ]
              },
              {
              "model_group": "gpt-3.5-turbo",
              "providers": [
                  "openai"
              ],
              "max_input_tokens": 16385.0,
              "max_output_tokens": 4096.0,
              "input_cost_per_token": 1.5e-06,
              "output_cost_per_token": 2e-06,
              "mode": "chat",
              "tpm": null,
              "rpm": null,
              "supports_parallel_function_calling": false,
              "supports_vision": false,
              "supports_function_calling": true,
              "supported_openai_params": [
                  "frequency_penalty",
                  "logit_bias",
                  "logprobs",
                  "top_logprobs",
                  "max_tokens",
                  "max_completion_tokens",
                  "n",
                  "presence_penalty",
                  "seed",
                  "stop",
                  "stream",
                  "stream_options",
                  "temperature",
                  "top_p",
                  "tools",
                  "tool_choice",
                  "function_call",
                  "functions",
                  "max_retries",
                  "extra_headers",
                  "parallel_tool_calls",
                  "response_format"
              ]
              },
              {
              "model_group": "llava-hf",
              "providers": [
                  "openai"
              ],
              "max_input_tokens": null,
              "max_output_tokens": null,
              "input_cost_per_token": 0.0,
              "output_cost_per_token": 0.0,
              "mode": null,
              "tpm": null,
              "rpm": null,
              "supports_parallel_function_calling": false,
              "supports_vision": true,
              "supports_function_calling": false,
              "supported_openai_params": [
                  "frequency_penalty",
                  "logit_bias",
                  "logprobs",
                  "top_logprobs",
                  "max_tokens",
                  "max_completion_tokens",
                  "n",
                  "presence_penalty",
                  "seed",
                  "stop",
                  "stream",
                  "stream_options",
                  "temperature",
                  "top_p",
                  "tools",
                  "tool_choice",
                  "function_call",
                  "functions",
                  "max_retries",
                  "extra_headers",
                  "parallel_tool_calls",
                  "response_format"
              ]
              }
          ]
          }
  ```

      Args:

          param_model_group (str): OpenAPI parameter corresponding to 'param_model_group'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /model_group/info")

  params = {}
  data = {}

  if param_model_group is not None:
    params["model_group"] = str(param_model_group).lower() if isinstance(param_model_group, bool) else param_model_group

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/model_group/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response

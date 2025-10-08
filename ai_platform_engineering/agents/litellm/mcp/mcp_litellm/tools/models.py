import httpx
import json
import os
import logging


from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")

async def list_models() -> str:
    """List all available models in LiteLLM with detailed information.

    Returns:
        JSON string with list of models and their configuration details
    """

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/model/info", method="GET", data=data)


    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    
    # Return the whole LiteLLM response
    return json.dumps({"success": True, "result": response}, indent=2)



async def list_model_names() -> str:
    """List only the names of available models in LiteLLM (simplified output).

    Returns:
        JSON string with just the model names and count
    """

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/model/info", method="GET", data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    

    # Extract model names directly from data[].model_name
    model_names = [model["model_name"] for model in response["data"]]

    # Return just the list of model names
    return json.dumps(
        {
            "success": True,
            "result": {"models": model_names, "count": len(model_names)},
        },
        indent=2,
    )
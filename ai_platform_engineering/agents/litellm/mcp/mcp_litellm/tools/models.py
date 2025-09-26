import httpx
import json
import os


# Configuration - these would need to be set from environment or config
LITELLM_PROXY_URL = os.getenv("LITELLM_PROXY_URL", "http://0.0.0.0:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-1234")


async def list_models() -> str:
    """List all available models in LiteLLM with detailed information.

    Returns:
        JSON string with list of models and their configuration details
    """

    # Set headers including master key for authentication
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{LITELLM_PROXY_URL}/model/info", headers=headers
            )

            if response.status_code != 200:
                return json.dumps(
                    {
                        "success": False,
                        "error": f"API Error {response.status_code}: {response.text}",
                    },
                    indent=2,
                )

            model_data = response.json()

            # Return the whole LiteLLM response
            return json.dumps({"success": True, "result": model_data}, indent=2)

    except Exception as e:
        return json.dumps(
            {
                "success": False,
                "error": f"Error fetching models from LiteLLM: {str(e)}",
            },
            indent=2,
        )


async def list_model_names() -> str:
    """List only the names of available models in LiteLLM (simplified output).

    Returns:
        JSON string with just the model names and count
    """

    # Set headers including master key for authentication
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{LITELLM_PROXY_URL}/model/info", headers=headers
            )

            if response.status_code != 200:
                return json.dumps(
                    {
                        "success": False,
                        "error": f"API Error {response.status_code}: {response.text}",
                    },
                    indent=2,
                )

            model_data = response.json()

            # Extract model names directly from data[].model_name
            model_names = [model["model_name"] for model in model_data["data"]]

            # Return just the list of model names
            return json.dumps(
                {
                    "success": True,
                    "result": {"models": model_names, "count": len(model_names)},
                },
                indent=2,
            )

    except Exception as e:
        return json.dumps(
            {
                "success": False,
                "error": f"Error fetching model names from LiteLLM: {str(e)}",
            },
            indent=2,
        )

import httpx
import json
import os


# Configuration - these would need to be set from environment or config
LITELLM_PROXY_URL = os.getenv("LITELLM_PROXY_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-1234")


async def list_users() -> str:
    """Resource: Get all users

    This resource provides access to the complete list of users in LiteLLM.
    Resources are read-only and can be referenced by other tools or clients.

    Returns:
        JSON string with list of users and their details
    """

    # Set headers including master key for authentication
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{LITELLM_PROXY_URL}/user/list", headers=headers
            )

            if response.status_code != 200:
                return json.dumps(
                    {
                        "success": False,
                        "error": f"API Error {response.status_code}: {response.text}",
                    },
                    indent=2,
                )

            user_data = response.json()

            # Return the whole LiteLLM response
            return json.dumps({"success": True, "result": user_data}, indent=2)

    except Exception as e:
        return json.dumps(
            {"success": False, "error": f"Error fetching users from LiteLLM: {str(e)}"},
            indent=2,
        )

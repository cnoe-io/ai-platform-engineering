import httpx
import json
import os


# Configuration - these would need to be set from environment or config
LITELLM_PROXY_URL = os.getenv("LITELLM_PROXY_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-1234")


async def create_user(name: str, email: str) -> str:
    """Create a new user in LiteLLM.

    Args:
        name: The user's display name
        email: The user's email address

    Returns:
        JSON string with user creation result including user_id
    """

    # Prepare request body for LiteLLM /user/new endpoint
    user_payload = {
        "user_alias": name,
        "user_email": email,
        "auto_create_key": False,
        "teams": [],  # Avoid null teams
        "metadata": {
            "username": name  # Store name in metadata as workaround
        },
    }

    # Set headers including master key for authentication
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
    }

    try:
        # Call the LiteLLM /user/new endpoint
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{LITELLM_PROXY_URL}/user/new", json=user_payload, headers=headers
            )

            if resp.status_code != 200:
                return json.dumps(
                    {
                        "success": False,
                        "error": f"API Error {resp.status_code}: {resp.text}",
                    },
                    indent=2,
                )

            user_response = resp.json()

            # Map the LiteLLM user response to a plain dictionary (not Pydantic model)
            metadata = user_response.get("metadata", {})
            result = {
                "user_id": user_response["user_id"],
                "name": metadata.get("username"),
                "email": user_response.get("user_email"),
                "projects": user_response.get("teams") or [],
            }

            return json.dumps({"success": True, "result": result}, indent=2)

    except Exception as e:
        return json.dumps(
            {"success": False, "error": f"Error creating user: {str(e)}"}, indent=2
        )

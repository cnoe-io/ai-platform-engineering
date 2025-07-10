"""Atlassian API client

This module provides a client for interacting with the Atlassian API.
It handles authentication, request formatting, and response parsing.
"""

import os
import logging
from typing import Optional, Dict, Tuple, Any
import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Constants
# Update the base URL to be specific to Jira API



# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
)
logger = logging.getLogger("atlassian_mcp")



def get_env() -> Optional[str]:
    """Retrieve the environment variables."""
    token = os.getenv("ATLASSIAN_TOKEN")
    if not token:
        logger.warning("ATLASSIAN_TOKEN is not set in environment variables.")
    return token

async def make_api_request(
    path: str,
    method: str = "GET",
    token: Optional[str] = None,
    params: Dict[str, Any] = {},
    data: Dict[str, Any] = {},
    timeout: int = 30,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Make a request to the Atlassian API

    Args:
        path: API path to request (without base URL)
        method: HTTP method (default: GET)
        token: API token (defaults to environment variable)
        params: Query parameters for the request (optional)
        data: JSON data for POST/PATCH/PUT requests (optional)
        timeout: Request timeout in seconds (default: 30)

    Returns:
        Tuple of (success, data) where data is either the response JSON or an error dict
    """
    logger.debug(f"Preparing {method} request to {path}")

    # Use the utility function to retrieve the token if not provided
    token = token or get_env()
    email = str(os.getenv("ATLASSIAN_EMAIL"))
    url = str(os.getenv("ATLASSIAN_API_URL"))
    if not token:
        logger.error("No API token available. Request cannot proceed.")
        return (
            False,
            {"error": "Token is required. Please set the ATLASSIAN_TOKEN environment variable."},
        )

    import base64

    auth_str = f"{email}:{token}"
    encoded_auth = base64.b64encode(auth_str.encode()).decode()

    headers = {
        "Authorization": f"Basic {encoded_auth}",
        "Accept": "application/json"
    }


    logger.debug(f"Request headers: {headers}")
    logger.debug(f"Request parameters: {params}")
    if data:
        logger.debug(f"Request data: {data}")

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            url = f"{url}/{path}"
            logger.debug(f"Full request URL: {url}")

            method_map = {
                "GET": client.get,
                "POST": client.post,
                "PUT": client.put,
                "PATCH": client.patch,
                "DELETE": client.delete,
            }

            if method not in method_map:
                logger.error(f"Unsupported HTTP method: {method}")
                return (False, {"error": f"Unsupported method: {method}"})

            if method in ["POST", "PUT", "PATCH"]:
                response = await method_map[method](
                    url,
                    headers=headers,
                    params=params,
                    json=data
                )
            else:
                response = await method_map[method](
                    url,
                    headers=headers,
                    params=params
                )


            logger.debug(f"Response status code: {response.status_code}")

            if response.status_code in [200, 201, 202, 204]:
                if response.status_code == 204:
                    logger.debug("Request successful (204 No Content)")
                    return (True, {"status": "success"})
                try:
                    return (True, response.json())
                except ValueError:
                    logger.warning("Request successful but could not parse JSON response")
                    return (True, {"status": "success", "raw_response": response.text})
            else:
                error_message = f"API request failed: {response.status_code}"
                try:
                    error_data = response.json()
                    logger.error(f"Error details: {error_data}")
                    return (False, {"error": error_message, "details": error_data})
                except ValueError:
                    logger.error(f"Error response (not JSON): {response.text[:200]}")
                    return (False, {"error": f"{error_message} - {response.text[:200]}"})

    except httpx.RequestError as e:
        logger.error(f"Request error: {str(e)}")
        return (False, {"error": f"Request error: {str(e)}"})
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return (False, {"error": f"Unexpected error: {str(e)}"})
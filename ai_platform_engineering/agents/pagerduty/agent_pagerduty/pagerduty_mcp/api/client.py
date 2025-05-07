"""PagerDuty API client

This module provides a client for interacting with the PagerDuty API.
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
PAGERDUTY_API_URL = "https://api.pagerduty.com"
DEFAULT_TOKEN = os.getenv("PAGERDUTY_API_TOKEN")

# Log token presence but not the token itself
if DEFAULT_TOKEN:
    logging.info("Default token provided (masked for security)")

logger = logging.getLogger("pagerduty_mcp")

async def make_api_request(
    path: str,
    method: str = "GET",
    token: Optional[str] = None,
    params: Dict[str, Any] = {},
    data: Dict[str, Any] = {},
    timeout: int = 30,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Make a request to the PagerDuty API

    Args:
        path: API path to request (without base URL)
        method: HTTP method (default: GET)
        token: API token (defaults to DEFAULT_TOKEN)
        params: Query parameters for the request (optional)
        data: JSON data for POST/PATCH/PUT requests (optional)
        timeout: Request timeout in seconds (default: 30)

    Returns:
        Tuple of (success, data) where data is either the response JSON or an error dict
    """
    if not token:
        token = DEFAULT_TOKEN

    if not token:
        return (
            False,
            {
                "error": "Token is required. Please set the PAGERDUTY_API_TOKEN environment variable."
            },
        )

    try:
        headers = {
            "Authorization": f"Token token={token}",
            "Accept": "application/vnd.pagerduty+json;version=2",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            url = f"{PAGERDUTY_API_URL}/{path}"

            # Map HTTP methods to client methods
            method_map = {
                "GET": client.get,
                "POST": client.post,
                "PUT": client.put,
                "PATCH": client.patch,
                "DELETE": client.delete,
            }

            if method not in method_map:
                return (False, {"error": f"Unsupported method: {method}"})

            # Make the request
            response = await method_map[method](
                url,
                headers=headers,
                params=params,
                json=data if method in ["POST", "PUT", "PATCH"] else None,
            )

            # Handle different response codes
            if response.status_code in [200, 201, 202, 204]:
                if response.status_code == 204:  # No content
                    return (True, {"status": "success"})
                try:
                    return (True, response.json())
                except ValueError:
                    return (True, {"status": "success", "raw_response": response.text})
            else:
                error_message = f"API request failed: {response.status_code}"
                try:
                    error_data = response.json()
                    if "error" in error_data:
                        error_message = f"{error_message} - {error_data['error']}"
                    elif "message" in error_data:
                        error_message = f"{error_message} - {error_data['message']}"
                    return (False, {"error": error_message, "details": error_data})
                except ValueError:
                    error_text = response.text[:200] if response.text else ""
                    return (False, {"error": f"{error_message} - {error_text}"})

    except httpx.TimeoutException:
        return (False, {"error": f"Request timed out after {timeout} seconds"})
    except httpx.HTTPStatusError as e:
        return (False, {"error": f"HTTP error: {e.response.status_code} - {str(e)}"})
    except httpx.RequestError as e:
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        return (False, {"error": f"Request error: {error_message}"})
    except Exception as e:
        # Ensure no sensitive data is included in error messages
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        return (False, {"error": f"Unexpected error: {error_message}"}) 
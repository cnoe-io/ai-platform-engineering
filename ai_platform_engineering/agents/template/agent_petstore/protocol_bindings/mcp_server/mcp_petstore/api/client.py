# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""API client for making requests to the Pet Store API"""

import logging
import os
from typing import Optional, Dict, Tuple, Any
import httpx

# Constants
API_URL = os.getenv("MCP_API_URL", "https://petstore.swagger.io/v2")
DEFAULT_TOKEN = os.getenv("MCP_API_KEY", "special-key")

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_api")

# Log token presence but not the token itself
if DEFAULT_TOKEN:
    logger.info("API key is present. Using from environment or default value.")
else:
    logger.warning("No API key is set.")

async def make_api_request(
    path: str,
    method: str = "GET",
    token: Optional[str] = None,
    params: Dict[str, Any] = {},
    data: Dict[str, Any] = {},
    timeout: int = 30,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Make a request to the Pet Store API

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
    logger.debug(f"Making {method} request to {path}")

    if not token:
        logger.debug("No token provided, using default token")
        token = DEFAULT_TOKEN
        
    if not token:
        logger.error("No token available - neither provided nor found in environment")
        return (
            False,
            {"error": "API key is required. Please set the MCP_API_KEY environment variable."},
        )
        
    try:
        # For Pet Store API, we use api_key as query parameter or header
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        
        # Add API key to query parameters
        if "api_key" not in params:
            params["api_key"] = token
            
        logger.debug(f"Request headers prepared")
        logger.debug(f"Request parameters: {params}")
        if data:
            logger.debug(f"Request data: {data}")
            
        async with httpx.AsyncClient(timeout=timeout) as client:
            url = f"{API_URL}{path}"
            logger.debug(f"Full request URL: {url}")

            # Map HTTP methods to client methods
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

            # Make the request
            logger.debug(f"Executing {method} request")
            # Only include json parameter for methods that use request body
            request_kwargs = {
                "headers": headers,
                "params": params,
            }
            if method in ["POST", "PUT", "PATCH"]:
                request_kwargs["json"] = data
            response = await method_map[method](
                url,
                **request_kwargs
            )
            logger.debug(f"Response status code: {response.status_code}")

            # Handle different response codes
            if response.status_code in [200, 201, 202, 204]:
                if response.status_code == 204:  # No content
                    logger.debug("Request successful (204 No Content)")
                    return (True, {"status": "success"})
                try:
                    response_data = response.json()
                    logger.debug("Request successful, parsed JSON response")
                    return (True, response_data)
                except ValueError:
                    logger.warning("Request successful but could not parse JSON response")
                    return (True, {"status": "success", "raw_response": response.text})
            else:
                error_message = f"API request failed: {response.status_code}"
                logger.error(error_message)
                try:
                    error_data = response.json()
                    if "error" in error_data:
                        error_message = f"{error_message} - {error_data['error']}"
                    elif "message" in error_data:
                        error_message = f"{error_message} - {error_data['message']}"
                    logger.error(f"Error details: {error_data}")
                    return (False, {"error": error_message, "details": error_data})
                except ValueError:
                    error_text = response.text[:200] if response.text else ""
                    logger.error(f"Error response (not JSON): {error_text}")
                    return (False, {"error": f"{error_message} - {error_text}"})
    except httpx.TimeoutException:
        logger.error(f"Request timed out after {timeout} seconds")
        return (False, {"error": f"Request timed out after {timeout} seconds"})
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error: {e.response.status_code} - {str(e)}")
        return (False, {"error": f"HTTP error: {e.response.status_code} - {str(e)}"})
    except httpx.RequestError as e:
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        logger.error(f"Request error: {error_message}")
        return (False, {"error": f"Request error: {error_message}"})
    except Exception as e:
        # Ensure no sensitive data is included in error messages
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        logger.error(f"Unexpected error: {error_message}")
        return (False, {"error": f"Unexpected error: {error_message}"})

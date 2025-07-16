import os
import logging
from typing import Optional, Dict, Tuple, Any
import httpx

# Load environment variables
API_URL = os.getenv("VICTOROPS_API_URL")
API_TOKEN = os.getenv("X_VO_API_KEY")
API_TOKEN_ID = os.getenv("X_VO_API_ID")


if not API_URL:
    raise ValueError("VICTOROPS_API_URL environment variable is not set.")
if not API_TOKEN:
    raise ValueError("X_VO_API_KEY environment variable is not set.")
if not API_TOKEN_ID:
    raise ValueError("X_VO_API_ID environment variable is not set.")

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_victorops_mcpapi")



def assemble_nested_body(flat_body: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a flat dict with underscore‐separated keys into a nested dictionary."""
    nested = {}
    for key, value in flat_body.items():
        parts = key.split("_")
        d = nested
        for part in parts[:-1]:
            d = d.setdefault(part, {})
        d[parts[-1]] = value
    return nested


async def make_api_request(
    path: str,
    method: str = "GET",
    token: Optional[str] = None,
    token_id: Optional[str] = None,
    params: Dict[str, Any] = {},
    data: Dict[str, Any] = {},
    timeout: int = 30,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Make a request to the API

    Args:
        path: API path to request (without base URL)
        method: HTTP method (default: GET)
        token: API key (defaults to X-VO-Api-Key)
        token_id: API key id (defaults to X-VO-Api-Id)
        params: Query parameters for the request (optional)
        data: JSON data for POST/PATCH/PUT requests (optional)
        timeout: Request timeout in seconds (default: 30)

    Returns:
        Tuple of (success, data) where data is either the response JSON or an error dict
    """
    logger.debug(f"Making {method} request to {path}")

    if not token:
        logger.debug("No token provided, using default token")
        token = API_TOKEN

    if not token:
        logger.error("No token available - neither provided nor found in environment")
        return (
            False,
            {"error": "Token is required. Please set the API_TOKEN environment variable."},
        )

    if not token_id:
        logger.debug("No token provided, using default token")
        token_id = API_TOKEN_ID

    if not token_id:
        logger.error("No token available - neither provided nor found in environment")
        return (
            False,
            {"error": "Token is required. Please set the API_TOKEN_ID environment variable."},
        )

    try:
        headers = {
            "X-VO-Api-Id": token_id,
            "X-VO-Api-Key": token,
            "Accept": "application/json",
        }

        logger.debug("Request headers prepared (Authorization header masked)")
        logger.debug(f"Request parameters: {params}")
        if data:
            logger.debug(f"Request data: {data}")

        async with httpx.AsyncClient(timeout=timeout) as client:
            url = f"{API_URL}{path}"
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

            request_kwargs = {
                "headers": headers,
                "params": params,
            }
            if method in ["POST", "PUT", "PATCH"]:
                request_kwargs["json"] = data

            response = await method_map[method](url, **request_kwargs)
            logger.debug(f"Response status code: {response.status_code}")

            if response.status_code in [200, 201, 202, 204]:
                if response.status_code == 204:
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
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        logger.error(f"Unexpected error: {error_message}")
        return (False, {"error": f"Unexpected error: {error_message}"})

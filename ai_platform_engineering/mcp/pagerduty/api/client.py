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
DEFAULT_API_KEY = os.getenv("PAGERDUTY_API_KEY")

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("pagerduty_mcp")

# Log token presence but not the token itself
if DEFAULT_API_KEY:
    logger.info("Default token found in environment variables")
else:
    logger.warning("No default token found in environment variables")


def get_provider_header_token() -> Optional[str]:
    """Retrieve a CAIPE exchanged provider token without consuming the MCP auth JWT.

    The credential exchange delivers a per-user PagerDuty OAuth access token on the
    ``X-CAIPE-Provider-Token`` request header (the ``Authorization`` header is reserved
    for the AgentGateway/MCP auth JWT). Returns ``None`` outside an HTTP context.
    """
    try:
        from fastmcp.server.dependencies import get_http_request

        req = get_http_request()
        token = req.headers.get("x-caipe-provider-token", "").strip()
        return token or None
    except Exception:
        return None


def get_static_api_key() -> Optional[str]:
    """Return the static PagerDuty REST API key from the environment.

    This is resolved directly from ``PAGERDUTY_API_KEY`` rather than via the request's
    ``Authorization`` header: in an AgentGateway deployment that header carries the MCP
    auth JWT (a Keycloak token), which is *not* a PagerDuty credential. The static key
    always uses PagerDuty's ``Token token=`` scheme.
    """
    key = os.getenv("PAGERDUTY_API_KEY")
    return key or None


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
        token: API token (defaults to DEFAULT_API_KEY)
        params: Query parameters for the request (optional)
        data: JSON data for POST/PATCH/PUT requests (optional)
        timeout: Request timeout in seconds (default: 30)

    Returns:
        Tuple of (success, data) where data is either the response JSON or an error dict
    """
    logger.debug(f"Making {method} request to {path}")

    # A CAIPE-exchanged provider token (PagerDuty OAuth access token) arrives on the
    # X-CAIPE-Provider-Token header and must use Bearer auth. Static account/user API
    # keys (from env or an explicitly passed token) use PagerDuty's "Token token=" scheme.
    #
    # The static key is read from PAGERDUTY_API_KEY directly (not get_request_token):
    # in a gateway deployment the Authorization header carries the MCP auth JWT, which is
    # not a PagerDuty credential and would 403 if used as one.
    provider_header_token = get_provider_header_token()
    auth_scheme = "bearer" if provider_header_token and not token else "token"

    if not token:
        token = provider_header_token or get_static_api_key()

    if not token:
        logger.error("No token available - neither provided nor found in environment")
        return (
            False,
            {
                "error": "Token is required. Please set the PAGERDUTY_API_KEY environment variable."
            },
        )

    # Primary attempt with the resolved token/scheme.
    success, result, status_code = await _attempt_request(
        path=path,
        method=method,
        token=token,
        auth_scheme=auth_scheme,
        params=params,
        data=data,
        timeout=timeout,
    )
    if success:
        return (True, result)

    # Per-user OAuth fallback: a Bearer token sourced from the provider header may be
    # rejected (e.g. the PagerDuty OAuth app lacks the required read scopes), returning
    # 401/403. Fall back to the static account API key, which uses the "Token token="
    # scheme, so a misconfigured per-user connection degrades gracefully instead of
    # making the whole MCP unavailable.
    if status_code in (401, 403) and auth_scheme == "bearer":
        static_token = get_static_api_key()
        if static_token and static_token != token:
            logger.warning(
                "PagerDuty per-user OAuth token rejected (HTTP %s); "
                "falling back to static PAGERDUTY_API_KEY",
                status_code,
            )
            fb_success, fb_result, _ = await _attempt_request(
                path=path,
                method=method,
                token=static_token,
                auth_scheme="token",
                params=params,
                data=data,
                timeout=timeout,
            )
            return (fb_success, fb_result)

    return (success, result)


async def _attempt_request(
    path: str,
    method: str,
    token: str,
    auth_scheme: str,
    params: Dict[str, Any],
    data: Dict[str, Any],
    timeout: int,
) -> Tuple[bool, Dict[str, Any], Optional[int]]:
    """Execute a single PagerDuty API request.

    Returns a ``(success, payload, status_code)`` tuple. ``status_code`` is ``None``
    when the failure was a transport-level error (timeout / connection) so callers can
    distinguish an auth rejection (401/403) from a network problem when deciding whether
    to attempt a fallback.
    """
    try:
        authorization = f"Bearer {token}" if auth_scheme == "bearer" else f"Token token={token}"
        headers = {
            "Authorization": authorization,
            "Accept": "application/vnd.pagerduty+json;version=2",
            "Content-Type": "application/json",
        }

        # DO NOT accidentally log headers that contain API tokens
        logger.debug("Request headers prepared (Authorization header masked)")
        logger.debug(f"Request parameters: {params}")
        if data:
            logger.debug(f"Request data: {data}")

        async with httpx.AsyncClient(timeout=timeout) as client:
            url = f"{PAGERDUTY_API_URL}/{path}"
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
                return (False, {"error": f"Unsupported method: {method}"}, None)

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
                    return (True, {"status": "success"}, response.status_code)
                try:
                    response_data = response.json()
                    logger.debug("Request successful, parsed JSON response")
                    return (True, response_data, response.status_code)
                except ValueError:
                    logger.warning("Request successful but could not parse JSON response")
                    return (True, {"status": "success", "raw_response": response.text}, response.status_code)
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
                    return (False, {"error": error_message, "details": error_data}, response.status_code)
                except ValueError:
                    error_text = response.text[:200] if response.text else ""
                    logger.error(f"Error response (not JSON): {error_text}")
                    return (False, {"error": f"{error_message} - {error_text}"}, response.status_code)

    except httpx.TimeoutException:
        logger.error(f"Request timed out after {timeout} seconds")
        return (False, {"error": f"Request timed out after {timeout} seconds"}, None)
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error: {e.response.status_code} - {str(e)}")
        return (False, {"error": f"HTTP error: {e.response.status_code} - {str(e)}"}, e.response.status_code)
    except httpx.RequestError as e:
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        logger.error(f"Request error: {error_message}")
        return (False, {"error": f"Request error: {error_message}"}, None)
    except Exception as e:
        # Ensure no sensitive data is included in error messages
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        logger.error(f"Unexpected error: {error_message}")
        return (False, {"error": f"Unexpected error: {error_message}"}, None)
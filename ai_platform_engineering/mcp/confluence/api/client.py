"""Atlassian Confluence API client

This module provides a client for interacting with the Confluence API.
It handles authentication, request formatting, and response parsing.

Authentication modes:
- Bearer (OAuth 2.0): used when X-CAIPE-Provider-Token is forwarded by the
  agentgateway. Requests are routed to the Atlassian API gateway
  (https://api.atlassian.com/ex/confluence/<cloudId>). No static email needed.
- Basic: used when a static ATLASSIAN_TOKEN / CONFLUENCE_API_TOKEN env var is
  configured. Requires ATLASSIAN_EMAIL to form the Basic auth credential.
"""

# assisted-by claude code claude-sonnet-4-6

import asyncio
import hashlib
import logging
import os
import time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from mcp_agent_auth.token import get_request_token

# Load environment variables
load_dotenv()

# Atlassian 3LO OAuth access tokens (delivered via the CAIPE credential exchange
# on X-CAIPE-Provider-Token) must target the Atlassian API gateway rather than
# the site URL. Static API tokens (Basic auth) continue to target the site URL.
ATLASSIAN_OAUTH_GATEWAY = "https://api.atlassian.com"
ATLASSIAN_ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"
# Cache resolved cloud ids per access token so we do not call accessible-resources
# on every tool invocation. Keyed by a sha256 of the token; short TTL bounds drift.
_CLOUD_ID_CACHE: Dict[str, Tuple[str, float]] = {}
_CLOUD_ID_CACHE_TTL_S = 600.0

# Configure logging
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
numeric_level = getattr(logging, log_level, logging.INFO)
logging.basicConfig(
    level=numeric_level,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
)
logger = logging.getLogger("confluence_mcp")


def get_provider_header_token() -> Optional[str]:
    """Retrieve a CAIPE exchanged provider token without consuming the MCP auth JWT."""
    try:
        from fastmcp.server.dependencies import get_http_request

        req = get_http_request()
        token = req.headers.get("x-caipe-provider-token", "").strip()
        return token or None
    except RuntimeError:
        # No active HTTP request (STDIO mode).
        return None


def _request_has_caipe_provider_header() -> bool:
    """True when AgentGateway forwarded the provider-token route (value may be empty)."""
    try:
        from fastmcp.server.dependencies import get_http_request

        req = get_http_request()
        return "x-caipe-provider-token" in req.headers
    except RuntimeError:
        return False


def _caipe_provider_oauth_required() -> bool:
    """Return True when caller OAuth is required but no exchanged token was forwarded."""
    if get_provider_header_token():
        return False
    return _request_has_caipe_provider_header()


def get_env() -> Optional[str]:
    """Retrieve the Atlassian API token from request header or environment."""
    token = (
        get_request_token("ATLASSIAN_TOKEN")
        or get_request_token("ATLASSIAN_API_TOKEN")
        or get_request_token("CONFLUENCE_API_TOKEN")
        or get_request_token("CONFLUENCE_TOKEN")
    )
    if not token:
        for env_name in ("ATLASSIAN_TOKEN", "ATLASSIAN_API_TOKEN", "CONFLUENCE_API_TOKEN", "CONFLUENCE_TOKEN"):
            env_token = os.getenv(env_name)
            if env_token:
                return env_token
    if not token:
        logger.warning("ATLASSIAN_TOKEN is not set and no Authorization header provided.")
    return token


def _is_atlassian_gateway_url(url: str) -> bool:
    """Return True when url already targets the Atlassian API gateway."""
    return (urlparse(url).hostname or "").lower() == "api.atlassian.com"


def validate_prerequisites(
    token: Optional[str] = None,
) -> Tuple[bool, Dict[str, Any]]:
    """Validate required Confluence credentials and determine auth scheme."""
    provider_header_token = get_provider_header_token()
    caipe_gateway_caller = _caipe_provider_oauth_required() and not token

    if caipe_gateway_caller:
        logger.error(
            "Caller-scoped Atlassian OAuth required but X-CAIPE-Provider-Token is missing."
        )
        return (
            False,
            {
                "error": (
                    "Atlassian account not connected. Connect Atlassian in CAIPE Credentials, "
                    "then start a new chat."
                )
            },
        )

    resolved_token = token or provider_header_token
    if not resolved_token:
        resolved_token = get_env()

    auth_scheme = "bearer" if provider_header_token and not token else "basic"

    if not resolved_token:
        logger.error("No API token available. Request cannot proceed.")
        return (
            False,
            {"error": "Token is required. Please set the ATLASSIAN_TOKEN environment variable."},
        )

    resolved_url = str(
        os.getenv("CONFLUENCE_API_URL") or os.getenv("ATLASSIAN_API_URL") or os.getenv("CONFLUENCE_URL") or ""
    )
    if not resolved_url:
        logger.error("No Confluence API URL available. Request cannot proceed.")
        return (
            False,
            {
                "error": (
                    "CONFLUENCE_API_URL is required. Please set the CONFLUENCE_API_URL "
                    "environment variable (e.g., https://your-domain.atlassian.net)."
                )
            },
        )

    if auth_scheme == "basic":
        resolved_email = str(
            os.getenv("ATLASSIAN_EMAIL") or os.getenv("CONFLUENCE_EMAIL")
            or os.getenv("CONFLUENCE_USER") or os.getenv("CONFLUENCE_USERNAME") or ""
        )
        if not resolved_email:
            logger.error("No email available for Basic auth. Request cannot proceed.")
            return (
                False,
                {"error": "ATLASSIAN_EMAIL is required. Please set the ATLASSIAN_EMAIL environment variable."},
            )
    else:
        resolved_email = ""

    return True, {
        "token": resolved_token,
        "email": resolved_email,
        "url": resolved_url,
        "auth_scheme": auth_scheme,
    }


async def resolve_oauth_base_url(token: str, timeout: int = 10) -> Optional[str]:
    """Resolve the Atlassian API gateway base URL for an OAuth (provider) token.

    Atlassian 3LO access tokens must be used against
    ``https://api.atlassian.com/ex/confluence/<cloudId>`` rather than the site URL.
    The cloud id is read from an explicit ``ATLASSIAN_OAUTH_CLOUD_ID`` override
    when set, otherwise resolved from the accessible-resources endpoint and
    cached per token.

    Returns the gateway base URL, or ``None`` if it cannot be resolved (caller
    then falls back to the configured URL).
    """
    explicit_cloud_id = os.getenv("ATLASSIAN_OAUTH_CLOUD_ID")
    if explicit_cloud_id:
        return f"{ATLASSIAN_OAUTH_GATEWAY}/ex/confluence/{explicit_cloud_id}"

    cache_key = hashlib.sha256(token.encode()).hexdigest()
    cached = _CLOUD_ID_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and cached[1] > now:
        return f"{ATLASSIAN_OAUTH_GATEWAY}/ex/confluence/{cached[0]}"

    try:
        async with httpx.AsyncClient(timeout=timeout) as resolver_client:
            response = await resolver_client.get(
                ATLASSIAN_ACCESSIBLE_RESOURCES_URL,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
    except Exception as exc:
        logger.error(f"confluence: failed to resolve Atlassian cloud id: {exc}")
        return None

    if response.status_code != 200:
        logger.error(
            "confluence: accessible-resources returned %s; cannot resolve cloud id for the OAuth token",
            response.status_code,
        )
        return None

    try:
        resources = response.json()
    except ValueError:
        logger.error("confluence: accessible-resources response was not valid JSON")
        return None

    if not resources:
        logger.error("confluence: OAuth token has no accessible Atlassian sites (empty accessible-resources)")
        return None

    cloud_id = resources[0].get("id")
    if not cloud_id:
        logger.error("confluence: accessible-resources entry missing an id")
        return None

    _CLOUD_ID_CACHE[cache_key] = (cloud_id, now + _CLOUD_ID_CACHE_TTL_S)
    if len(resources) > 1:
        logger.info(
            "confluence: OAuth token has %d accessible sites; using the first (set ATLASSIAN_OAUTH_CLOUD_ID to pin)",
            len(resources),
        )
    return f"{ATLASSIAN_OAUTH_GATEWAY}/ex/confluence/{cloud_id}"


async def make_api_request(
    path: str,
    method: str = "GET",
    token: Optional[str] = None,
    params: Dict[str, Any] = {},
    data: Dict[str, Any] = {},
    timeout: int = 30,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Make a request to the Confluence API

    Args:
        path: API path to request (without base URL)
        method: HTTP method (default: GET)
        token: API token (overrides provider header and env; used for static/service-account calls)
        params: Query parameters for the request (optional)
        data: JSON data for POST/PATCH/PUT requests (optional)
        timeout: Request timeout in seconds (default: 30)

    Returns:
        Tuple of (success, data) where data is either the response JSON or an error dict
    """
    logger.debug(f"Preparing {method} request to {path}")

    ok, prerequisites = validate_prerequisites(token=token)
    if not ok:
        return False, prerequisites

    resolved_token = str(prerequisites["token"])
    resolved_email = str(prerequisites["email"])
    url = str(prerequisites["url"])
    auth_scheme = str(prerequisites.get("auth_scheme") or "basic")

    # OAuth provider tokens must target the Atlassian API gateway, not the site URL.
    if auth_scheme == "bearer" and not _is_atlassian_gateway_url(url):
        oauth_base_url = await resolve_oauth_base_url(resolved_token, timeout=timeout)
        if oauth_base_url:
            logger.debug("confluence: routing OAuth request to Atlassian gateway base URL")
            url = oauth_base_url
        else:
            logger.warning(
                "confluence: could not resolve Atlassian gateway base URL for the OAuth token; "
                "falling back to the configured site URL (this will likely fail with 401). "
                "Set ATLASSIAN_OAUTH_CLOUD_ID or ensure the token has accessible resources."
            )

    if auth_scheme == "bearer":
        authorization = f"Bearer {resolved_token}"
    else:
        import base64

        auth_str = f"{resolved_email}:{resolved_token}"
        encoded_auth = base64.b64encode(auth_str.encode()).decode()
        authorization = f"Basic {encoded_auth}"

    headers = {
        "Authorization": authorization,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    logger.debug("Request headers prepared (Authorization header masked)")
    logger.debug(f"Request parameters: {params}")
    if data:
        logger.debug(f"Request data: {data}")

    max_retries = 2
    retry_delay = 1

    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                base_url = url.rstrip("/")
                clean_path = path.lstrip("/")
                request_url = f"{base_url}/{clean_path}"
                logger.debug(f"Request: {method} {path}")

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
                        request_url, headers=headers, params=params, json=data
                    )
                else:
                    response = await method_map[method](
                        request_url, headers=headers, params=params
                    )

                logger.debug(f"Response status code: {response.status_code}")

                if response.status_code in [200, 201, 202, 204]:
                    if response.status_code == 204:
                        return (True, {"status": "success"})
                    content_type = response.headers.get("content-type", "").lower()
                    if "application/json" in content_type:
                        try:
                            return (True, response.json())
                        except ValueError:
                            return (True, {"status": "success", "raw_response": response.text})
                    else:
                        if response.text.strip():
                            return (True, {"status": "success", "raw_response": response.text})
                        return (True, {"status": "success"})
                else:
                    error_message = f"API request failed: {response.status_code}"
                    try:
                        error_data = response.json()
                        logger.error(f"Error details: {error_data}")
                        return (False, {"error": error_message, "details": error_data})
                    except ValueError:
                        logger.error(f"Error response (not JSON): {response.text[:200]}")
                        return (False, {"error": f"{error_message} - {response.text[:200]}"})

        except (httpx.NetworkError, httpx.RemoteProtocolError, httpx.ReadTimeout) as e:
            is_last_attempt = attempt == max_retries
            if is_last_attempt:
                logger.error(f"confluence: Network error after {max_retries} retries: {e}")
                return (False, {"error": "Confluence is temporarily unavailable. Please try again in a moment."})
            logger.warning(f"confluence: Network error (attempt {attempt + 1}/{max_retries + 1}): {e}. Retrying...")
            await asyncio.sleep(retry_delay * (attempt + 1))

        except httpx.RequestError as e:
            logger.error(f"Request error: {str(e)}")
            return (False, {"error": f"Request error: {str(e)}"})

        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            return (False, {"error": f"Unexpected error: {str(e)}"})

    logger.error("Confluence API request exhausted retry loop without returning a response.")
    return (False, {"error": "Confluence API request failed without a response."})

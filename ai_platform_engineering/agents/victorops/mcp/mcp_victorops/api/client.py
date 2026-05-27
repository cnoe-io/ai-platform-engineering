import json
import os
import logging
from typing import Optional, Dict, List, NamedTuple, Tuple, Any
import httpx

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_victorops")


class OrgCredentials(NamedTuple):
    api_url: str
    api_key: str
    api_id: str


def _build_org_registry() -> Dict[str, OrgCredentials]:
    """Build the org credential registry from environment variables.

    Reads VICTOROPS_ORGS (JSON) if set, otherwise falls back to the
    single-org env vars VICTOROPS_API_URL / X_VO_API_KEY / X_VO_API_ID.
    """
    registry: Dict[str, OrgCredentials] = {}

    orgs_json = os.getenv("VICTOROPS_ORGS")
    if orgs_json:
        try:
            orgs = json.loads(orgs_json)
        except json.JSONDecodeError as e:
            raise ValueError(f"VICTOROPS_ORGS is not valid JSON: {e}") from e

        for slug, cfg in orgs.items():
            missing = [k for k in ("api_url", "api_key", "api_id") if not cfg.get(k)]
            if missing:
                raise ValueError(
                    f"VICTOROPS_ORGS org '{slug}' is missing: {', '.join(missing)}"
                )
            registry[slug] = OrgCredentials(
                api_url=cfg["api_url"],
                api_key=cfg["api_key"],
                api_id=cfg["api_id"],
            )
        return registry

    # Fallback: single-org env vars → "default" org
    api_url = os.getenv("VICTOROPS_API_URL")
    api_key = os.getenv("X_VO_API_KEY")
    api_id = os.getenv("X_VO_API_ID")

    if not api_url:
        raise ValueError("VICTOROPS_API_URL environment variable is not set.")
    if not api_key:
        raise ValueError("X_VO_API_KEY environment variable is not set.")
    if not api_id:
        raise ValueError("X_VO_API_ID environment variable is not set.")

    registry["default"] = OrgCredentials(api_url=api_url, api_key=api_key, api_id=api_id)
    return registry


_org_registry = _build_org_registry()


def list_orgs() -> List[str]:
    """Return the slugs of all configured VictorOps organizations."""
    return list(_org_registry.keys())


def get_org_credentials(org_slug: Optional[str] = None) -> OrgCredentials:
    """Look up credentials for an org slug.

    When org_slug is None and only one org is configured, that org is used.
    When org_slug is None and multiple orgs exist, raises ValueError so the
    caller (the LLM) knows it must specify one.
    """
    if org_slug is None:
        if len(_org_registry) == 1:
            return next(iter(_org_registry.values()))
        raise ValueError(
            f"Multiple VictorOps orgs are configured ({', '.join(_org_registry.keys())}). "
            "Please specify an org_slug."
        )
    if org_slug not in _org_registry:
        raise ValueError(
            f"Unknown org_slug '{org_slug}'. "
            f"Available orgs: {', '.join(_org_registry.keys())}"
        )
    return _org_registry[org_slug]



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
    org_slug: Optional[str] = None,
    params: Dict[str, Any] = {},
    data: Dict[str, Any] = {},
    timeout: int = 30,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Make a request to the API

    Args:
        path: API path to request (without base URL)
        method: HTTP method (default: GET)
        org_slug: VictorOps organization slug (resolves credentials from registry)
        params: Query parameters for the request (optional)
        data: JSON data for POST/PATCH/PUT requests (optional)
        timeout: Request timeout in seconds (default: 30)

    Returns:
        Tuple of (success, data) where data is either the response JSON or an error dict
    """
    logger.debug(f"Making {method} request to {path}")

    creds = get_org_credentials(org_slug)

    try:
        headers = {
            "X-VO-Api-Id": creds.api_id,
            "X-VO-Api-Key": creds.api_key,
            "Accept": "application/json",
        }

        logger.debug("Request headers prepared (Authorization header masked)")
        logger.debug(f"Request parameters: {params}")
        if data:
            logger.debug(f"Request data: {data}")

        async with httpx.AsyncClient(timeout=timeout) as client:
            url = f"{creds.api_url}{path}"
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
        if creds.api_key and creds.api_key in error_message:
            error_message = error_message.replace(creds.api_key, "[REDACTED]")
        logger.error(f"Request error: {error_message}")
        return (False, {"error": f"Request error: {error_message}"})
    except Exception as e:
        error_message = str(e)
        if creds.api_key and creds.api_key in error_message:
            error_message = error_message.replace(creds.api_key, "[REDACTED]")
        logger.error(f"Unexpected error: {error_message}")
        return (False, {"error": f"Unexpected error: {error_message}"})

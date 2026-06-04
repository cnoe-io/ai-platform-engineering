# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
URL Content Fetching Tool

Fetches content from public URLs for documentation, APIs, and research.
Available to all agents (argocd, github, jira, etc.).
"""

import ipaddress
import socket
from typing import Literal
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from langchain_core.tools import tool

_REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
_MAX_FETCH_REDIRECTS = 10


# assisted-by claude code claude-sonnet-4-6
def _is_publicly_routable_ip(ip_address: str) -> bool:
    addr = ipaddress.ip_address(ip_address)
    return addr.is_global and not (
        addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_private
        or addr.is_reserved
        or addr.is_unspecified
    )


def _resolve_host_addresses(hostname: str) -> list[str]:
    try:
        return [str(ipaddress.ip_address(hostname))]
    except ValueError:
        pass

    results = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    return [sockaddr[0] for _family, _type, _proto, _canonname, sockaddr in results]


def _validate_public_url(url: str) -> tuple[bool, str]:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False, "Invalid URL - must start with http:// or https://"

    hostname = parsed.hostname or ""
    if not hostname:
        return False, "Invalid URL - missing hostname"

    try:
        addresses = _resolve_host_addresses(hostname)
    except (socket.gaierror, OSError) as e:
        return False, f"URL host must resolve only to publicly routable IP addresses: hostname could not be resolved: {e}"

    if not addresses:
        return False, "URL host must resolve only to publicly routable IP addresses: hostname did not resolve to any address"

    for address in addresses:
        try:
            if not _is_publicly_routable_ip(address):
                return False, f"URL host must resolve only to publicly routable IP addresses: {address} is not publicly routable"
        except ValueError:
            return False, f"URL host must resolve only to publicly routable IP addresses: {address} is not a valid IP address"

    return True, ""


def _get_public_url(url: str, timeout: int):
    current_url = url
    response = None
    for _redirect_count in range(_MAX_FETCH_REDIRECTS + 1):
        is_valid, error_msg = _validate_public_url(current_url)
        if not is_valid:
            return None, error_msg

        response = requests.get(current_url, timeout=timeout, allow_redirects=False)
        if getattr(response, "status_code", None) not in _REDIRECT_STATUS_CODES:
            return response, ""

        location = response.headers.get("location")
        if not location:
            return response, ""
        current_url = urljoin(current_url, location)

    return None, f"Too many redirects (>{_MAX_FETCH_REDIRECTS})"


@tool
def fetch_url(
    url: str,
    format: Literal["text", "raw"] = "text",
    timeout: int = 30
) -> str:
    """
    Fetch content from a public URL.

    Args:
        url: The URL to fetch (must be http:// or https://)
        format: 'text' (extract readable content) or 'raw' (raw HTML)
        timeout: Request timeout in seconds (default: 30)

    Returns:
        Fetched content as string, or "ERROR: <message>" on failure

    Example:
        content = fetch_url("https://docs.example.com/guide")

    Notes:
        - Only works with public URLs (no authentication)
        - For private repos, use: git("git clone https://...")
    """
    if not url.startswith(('http://', 'https://')):
        return "ERROR: Invalid URL - must start with http:// or https://"

    try:
        response, error_msg = _get_public_url(url, timeout)
        if error_msg:
            return f"ERROR: {error_msg}"
        if response is None:
            return "ERROR: No response received"

        response.raise_for_status()

        content_type = response.headers.get('content-type', '').lower()

        if 'application/json' in content_type:
            return response.text
        elif 'text/html' in content_type:
            if format == 'raw':
                return response.text
            else:
                soup = BeautifulSoup(response.text, 'html.parser')
                for script in soup(["script", "style"]):
                    script.decompose()
                return soup.get_text(separator='\n', strip=True)
        else:
            return response.text

    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response else 'Unknown'
        return f"ERROR: HTTP {status_code}: {e}"
    except requests.exceptions.Timeout:
        return f"ERROR: Request timeout after {timeout} seconds"
    except requests.exceptions.RequestException as e:
        return f"ERROR: Network error: {e}"
    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['fetch_url']

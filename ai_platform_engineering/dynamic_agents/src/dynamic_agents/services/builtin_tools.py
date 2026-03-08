"""Built-in tools for Dynamic Agents.

This module provides wrapper functions for built-in tools that can be
configured per-agent with access controls (e.g., domain restrictions).
"""

import logging
from typing import Literal
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def is_domain_allowed(url_domain: str, allowed_domains_str: str) -> tuple[bool, str]:
    """Check if a domain is allowed by the pattern string.

    Args:
        url_domain: The domain from the URL (e.g., "docs.cisco.com")
        allowed_domains_str: Comma-separated domain patterns

    Returns:
        Tuple of (is_allowed, error_message). error_message is empty if allowed.

    Examples:
        is_domain_allowed("docs.cisco.com", "*") -> (True, "")
        is_domain_allowed("docs.cisco.com", "*.cisco.com") -> (True, "")
        is_domain_allowed("docs.cisco.com", "cisco.com") -> (False, "...")
        is_domain_allowed("cisco.com", "cisco.com") -> (True, "")
        is_domain_allowed("evil.com", "*.cisco.com,*.google.com") -> (False, "...")
    """
    # Empty or whitespace-only = block all
    if not allowed_domains_str or not allowed_domains_str.strip():
        return False, "No domains are allowed (allowed_domains is empty)"

    patterns = [p.strip().lower() for p in allowed_domains_str.split(",") if p.strip()]
    if not patterns:
        return False, "No domains are allowed (allowed_domains is empty)"

    url_domain = url_domain.lower()

    for pattern in patterns:
        if pattern == "*":
            return True, ""  # Wildcard allows all
        elif pattern.startswith("*."):
            # Wildcard subdomain match: *.cisco.com
            base_domain = pattern[2:]  # Remove "*."
            if url_domain == base_domain or url_domain.endswith("." + base_domain):
                return True, ""
        else:
            # Exact match only
            if url_domain == pattern:
                return True, ""

    # Build helpful error message
    return False, f"Domain '{url_domain}' is not allowed. Allowed patterns: {allowed_domains_str}"


def _fetch_url_content(url: str, format: Literal["text", "raw"], timeout: int) -> str:
    """Fetch content from a URL (internal implementation).

    Args:
        url: The URL to fetch
        format: 'text' (extract readable content) or 'raw' (raw HTML)
        timeout: Request timeout in seconds

    Returns:
        Fetched content as string, or "ERROR: <message>" on failure
    """
    try:
        response = requests.get(url, timeout=timeout, allow_redirects=True)
        response.raise_for_status()

        content_type = response.headers.get("content-type", "").lower()

        if "application/json" in content_type:
            return response.text
        elif "text/html" in content_type:
            if format == "raw":
                return response.text
            else:
                soup = BeautifulSoup(response.text, "html.parser")
                for script in soup(["script", "style"]):
                    script.decompose()
                return soup.get_text(separator="\n", strip=True)
        else:
            return response.text

    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response else "Unknown"
        return f"ERROR: HTTP {status_code}: {e}"
    except requests.exceptions.Timeout:
        return f"ERROR: Request timeout after {timeout} seconds"
    except requests.exceptions.RequestException as e:
        return f"ERROR: Network error: {e}"
    except Exception as e:
        return f"ERROR: {e}"


def create_fetch_url_tool(allowed_domains: str = "*"):
    """Create a fetch_url tool with domain restrictions.

    Args:
        allowed_domains: Comma-separated domain patterns.
            - "*" allows all domains
            - "*.cisco.com" allows any subdomain of cisco.com
            - "cisco.com" allows only the exact domain
            - Empty string blocks all domains

    Returns:
        A LangChain tool that wraps fetch_url with domain ACL.
    """

    @tool
    def fetch_url(
        url: str,
        format: Literal["text", "raw"] = "text",
        timeout: int = 30,
    ) -> str:
        """Fetch content from a URL.

        Use this tool to retrieve content from web pages, APIs, or documentation sites.
        The content is extracted as readable text by default.

        Args:
            url: The URL to fetch (must be http:// or https://)
            format: 'text' (extract readable content) or 'raw' (raw HTML)
            timeout: Request timeout in seconds (default: 30)

        Returns:
            Fetched content as string, or error message on failure.

        Example:
            content = fetch_url("https://docs.example.com/guide")
        """
        # Validate URL format
        if not url.startswith(("http://", "https://")):
            return "ERROR: Invalid URL - must start with http:// or https://"

        # Check domain ACL
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            # Strip port if present
            if ":" in domain:
                domain = domain.split(":")[0]

            is_allowed, error_msg = is_domain_allowed(domain, allowed_domains)
            if not is_allowed:
                logger.warning(f"fetch_url domain blocked: {domain} (patterns: {allowed_domains})")
                return f"ERROR: {error_msg}"

        except Exception as e:
            return f"ERROR: Failed to parse URL: {e}"

        # Fetch the content
        logger.debug(f"fetch_url: fetching {url} (domain allowed)")
        return _fetch_url_content(url, format, timeout)

    return fetch_url


__all__ = ["create_fetch_url_tool", "is_domain_allowed"]

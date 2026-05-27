# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
URL Content Fetching Tool

Fetches content from public URLs for documentation, APIs, and research.
Available to all agents (argocd, github, jira, etc.).
"""

from typing import Literal

import requests
from bs4 import BeautifulSoup
from langchain_core.tools import tool


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
        response = requests.get(url, timeout=timeout, allow_redirects=True)
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

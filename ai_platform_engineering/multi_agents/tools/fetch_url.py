# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
URL Content Fetching Tool

This tool provides capabilities to fetch content from public URLs, useful for:
- Retrieving documentation from web pages
- Fetching API responses
- Reading public content for research
- Accessing external resources
"""

from typing import Dict, Any, Literal
from langchain_core.tools import tool
import requests
from bs4 import BeautifulSoup


@tool
def fetch_url(
    url: str,
    format: Literal["text", "raw"] = "text",
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Fetch content from a public URL.

    This tool retrieves content from public web pages, APIs, and other URL resources.
    Useful for accessing documentation, external resources, or API endpoints.

    Args:
        url: The URL to fetch (must be http:// or https://)
        format: Output format:
            - 'text': Plain text extracted from HTML using BeautifulSoup (default)
            - 'raw': Return raw HTML/response content
        timeout: Request timeout in seconds (default: 30)

    Returns:
        Dict containing:
        - success: Whether the fetch succeeded
        - content: The fetched content (if successful)
        - url: Final URL (after redirects)
        - status_code: HTTP status code
        - content_type: Response content type
        - format: Detected/converted format
        - size: Content size in characters
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        # Fetch a documentation page as text
        result = fetch_url("https://docs.example.com/guide", format="text")
        if result['success']:
            print(result['content'])

        # Fetch API endpoint
        result = fetch_url("https://api.example.com/data")

        # Fetch with custom timeout
        result = fetch_url("https://example.com", timeout=10)

    Notes:
        - Only works with public URLs (no authentication)
        - Respects redirects automatically
        - For HTML pages, 'text' format extracts readable content using BeautifulSoup
        - For JSON/API responses, returns as-is regardless of format
    """
    # Validate URL
    if not url.startswith(('http://', 'https://')):
        return {
            'success': False,
            'content': None,
            'url': url,
            'error': 'Invalid URL scheme - must start with http:// or https://',
            'message': 'Invalid URL: must start with http:// or https://'
        }

    try:
        # Step 1: Fetch the HTML content
        response = requests.get(url, timeout=timeout, allow_redirects=True)
        response.raise_for_status()

        content_type = response.headers.get('content-type', '').lower()

        # Step 2: Parse and extract content based on type
        if 'application/json' in content_type:
            content = response.text
            detected_format = 'json'
        elif 'text/html' in content_type:
            if format == 'raw':
                content = response.text
                detected_format = 'html'
            else:
                # Parse HTML with BeautifulSoup and extract text for LLM consumption
                soup = BeautifulSoup(response.text, 'html.parser')
                # Remove script and style elements
                for script in soup(["script", "style"]):
                    script.decompose()
                content = soup.get_text(separator='\n', strip=True)
                detected_format = 'text'
        else:
            # Plain text or other content
            content = response.text
            detected_format = 'text'

        return {
            'success': True,
            'content': content,
            'url': response.url,  # Final URL after redirects
            'status_code': response.status_code,
            'content_type': content_type,
            'format': detected_format,
            'size': len(content),
            'message': f'Successfully fetched {len(content)} characters from {url}'
        }

    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response else None
        return {
            'success': False,
            'content': None,
            'url': url,
            'status_code': status_code,
            'error': f'HTTP {status_code}: {str(e)}',
            'message': f'Failed to fetch URL: HTTP {status_code}'
        }
    except requests.exceptions.Timeout:
        return {
            'success': False,
            'content': None,
            'url': url,
            'error': f'Request timeout after {timeout} seconds',
            'message': f'Request timed out after {timeout} seconds'
        }
    except requests.exceptions.RequestException as e:
        return {
            'success': False,
            'content': None,
            'url': url,
            'error': str(e),
            'message': f'Network error: {str(e)}'
        }
    except Exception as e:
        return {
            'success': False,
            'content': None,
            'url': url,
            'error': str(e),
            'message': f'Unexpected error: {str(e)}'
        }


# Export for use in agent tool lists
__all__ = ['fetch_url']

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

import asyncio
from typing import Dict, Any, Optional, Literal
from langchain_core.tools import tool


async def _fetch_url_async(
    url: str,
    timeout: int = 30,
    format: str = "text"
) -> Dict[str, Any]:
    """
    Asynchronously fetch content from a URL.
    
    Args:
        url: The URL to fetch
        timeout: Request timeout in seconds
        format: Output format - 'text', 'markdown', or 'raw'
        
    Returns:
        Dict with content and metadata
        
    Raises:
        ImportError: If required libraries are not installed
        Exception: If fetch fails
    """
    try:
        import httpx
    except ImportError:
        raise ImportError(
            "httpx is not installed. Install it with: pip install httpx"
        )
    
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            
            content_type = response.headers.get('content-type', '').lower()
            
            # Get content based on content type
            if 'application/json' in content_type:
                content = response.text
                detected_format = 'json'
            elif 'text/html' in content_type:
                if format == 'markdown':
                    # Try to convert HTML to markdown
                    try:
                        import html2text
                        h = html2text.HTML2Text()
                        h.ignore_links = False
                        h.ignore_images = False
                        h.body_width = 0  # Don't wrap lines
                        content = h.handle(response.text)
                        detected_format = 'markdown'
                    except ImportError:
                        # html2text not available, return cleaned text
                        try:
                            from bs4 import BeautifulSoup
                            soup = BeautifulSoup(response.text, 'html.parser')
                            # Remove script and style elements
                            for script in soup(["script", "style"]):
                                script.decompose()
                            content = soup.get_text(separator='\n', strip=True)
                            detected_format = 'text'
                        except ImportError:
                            # BeautifulSoup not available, return raw
                            content = response.text
                            detected_format = 'html'
                elif format == 'text':
                    # Extract text from HTML
                    try:
                        from bs4 import BeautifulSoup
                        soup = BeautifulSoup(response.text, 'html.parser')
                        # Remove script and style elements
                        for script in soup(["script", "style"]):
                            script.decompose()
                        content = soup.get_text(separator='\n', strip=True)
                        detected_format = 'text'
                    except ImportError:
                        # BeautifulSoup not available, return raw
                        content = response.text
                        detected_format = 'html'
                else:  # raw
                    content = response.text
                    detected_format = 'html'
            else:
                # Plain text or other content
                content = response.text
                detected_format = 'text'
            
            return {
                'success': True,
                'content': content,
                'url': str(response.url),  # Final URL after redirects
                'status_code': response.status_code,
                'content_type': content_type,
                'format': detected_format,
                'size': len(content),
                'message': f'Successfully fetched {len(content)} characters from {url}'
            }
            
    except httpx.HTTPStatusError as e:
        return {
            'success': False,
            'content': None,
            'url': url,
            'status_code': e.response.status_code,
            'error': f'HTTP {e.response.status_code}: {e.response.reason_phrase}',
            'message': f'Failed to fetch URL: HTTP {e.response.status_code}'
        }
    except httpx.TimeoutException:
        return {
            'success': False,
            'content': None,
            'url': url,
            'error': f'Request timeout after {timeout} seconds',
            'message': f'Request timed out after {timeout} seconds'
        }
    except httpx.RequestError as e:
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


@tool
def fetch_url(
    url: str,
    format: Literal["text", "markdown", "raw"] = "text",
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Fetch content from a public URL.
    
    This tool retrieves content from public web pages, APIs, and other URL resources.
    Useful for accessing documentation, external resources, or API endpoints.
    
    Args:
        url: The URL to fetch (must be http:// or https://)
        format: Output format:
            - 'text': Plain text extracted from HTML (default)
            - 'markdown': Convert HTML to markdown format
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
        # Fetch a documentation page as markdown
        result = fetch_url("https://docs.example.com/guide", format="markdown")
        if result['success']:
            print(result['content'])
        
        # Fetch API endpoint
        result = fetch_url("https://api.example.com/data")
        
        # Fetch with custom timeout
        result = fetch_url("https://example.com", timeout=10)
    
    Notes:
        - Only works with public URLs (no authentication)
        - Respects redirects automatically
        - For HTML pages, 'text' format extracts readable content
        - For HTML pages, 'markdown' format converts to markdown (cleaner for LLMs)
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
    
    # Run async fetch
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    try:
        result = loop.run_until_complete(_fetch_url_async(url, timeout, format))
        return result
    except ImportError as e:
        return {
            'success': False,
            'content': None,
            'url': url,
            'error': str(e),
            'message': f'Required library not installed: {str(e)}'
        }
    except Exception as e:
        return {
            'success': False,
            'content': None,
            'url': url,
            'error': str(e),
            'message': f'Failed to fetch URL: {str(e)}'
        }


# Export for use in agent tool lists
__all__ = ['fetch_url']





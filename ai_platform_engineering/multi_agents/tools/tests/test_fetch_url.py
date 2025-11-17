# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the fetch_url tool.

Tests cover:
- URL validation
- Successful fetches (text, markdown, raw)
- HTTP error handling
- Timeout handling
- Content type detection
- HTML to markdown conversion
- HTML to text extraction
- Redirect following
"""

import unittest
from unittest.mock import AsyncMock, Mock, patch, MagicMock
from ai_platform_engineering.multi_agents.tools.fetch_url import fetch_url, _fetch_url_async


class TestFetchUrlValidation(unittest.TestCase):
    """Test URL validation and basic error handling."""

    def test_invalid_url_scheme(self):
        """Test rejection of non-http/https URLs."""
        result = fetch_url.invoke({
            "url": "ftp://example.com/file.txt"
        })

        self.assertFalse(result['success'])
        self.assertIn('error', result)
        self.assertIn('http://', result['message'].lower())
        print("✓ Invalid URL scheme rejected")

    def test_empty_url(self):
        """Test handling of empty URL."""
        result = fetch_url.invoke({"url": ""})

        self.assertFalse(result['success'])
        print("✓ Empty URL rejected")

    def test_malformed_url(self):
        """Test handling of malformed URL."""
        result = fetch_url.invoke({"url": "not-a-url"})

        self.assertFalse(result['success'])
        print("✓ Malformed URL rejected")


class TestFetchUrlSuccess(unittest.TestCase):
    """Test successful fetch operations with mocked responses."""

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_fetch_plain_text(self, mock_client):
        """Test fetching plain text content."""
        # Mock response
        mock_response = Mock()
        mock_response.text = "Hello, world!"
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/plain'}
        mock_response.url = "https://example.com/text.txt"
        mock_response.raise_for_status = Mock()

        # Mock async context manager
        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com/text.txt",
            "format": "text"
        })

        self.assertTrue(result['success'])
        self.assertEqual(result['content'], "Hello, world!")
        self.assertEqual(result['status_code'], 200)
        print("✓ Plain text fetch works")

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_fetch_json_content(self, mock_client):
        """Test fetching JSON content."""
        mock_response = Mock()
        mock_response.text = '{"key": "value"}'
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'application/json'}
        mock_response.url = "https://api.example.com/data"
        mock_response.raise_for_status = Mock()

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://api.example.com/data"
        })

        self.assertTrue(result['success'])
        self.assertIn('"key"', result['content'])
        self.assertEqual(result['format'], 'json')
        print("✓ JSON content fetch works")

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.BeautifulSoup')
    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_fetch_html_as_text(self, mock_client, mock_bs):
        """Test fetching HTML and converting to text."""
        html_content = "<html><body><h1>Title</h1><p>Paragraph</p></body></html>"

        mock_response = Mock()
        mock_response.text = html_content
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.url = "https://example.com/page.html"
        mock_response.raise_for_status = Mock()

        # Mock BeautifulSoup
        mock_soup = Mock()
        mock_soup.get_text.return_value = "Title\nParagraph"
        mock_soup.__call__ = Mock(return_value=[])  # For script/style removal
        mock_bs.return_value = mock_soup

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com/page.html",
            "format": "text"
        })

        self.assertTrue(result['success'])
        self.assertIn('Title', result['content'])
        print("✓ HTML to text conversion works")

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.html2text.HTML2Text')
    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_fetch_html_as_markdown(self, mock_client, mock_html2text):
        """Test fetching HTML and converting to markdown."""
        html_content = "<html><body><h1>Title</h1><p>Paragraph</p></body></html>"

        mock_response = Mock()
        mock_response.text = html_content
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.url = "https://example.com/page.html"
        mock_response.raise_for_status = Mock()

        # Mock html2text
        mock_converter = Mock()
        mock_converter.handle.return_value = "# Title\n\nParagraph"
        mock_html2text.return_value = mock_converter

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com/page.html",
            "format": "markdown"
        })

        self.assertTrue(result['success'])
        self.assertEqual(result['format'], 'markdown')
        print("✓ HTML to markdown conversion works")

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_fetch_raw_html(self, mock_client):
        """Test fetching raw HTML content."""
        html_content = "<html><body><h1>Title</h1></body></html>"

        mock_response = Mock()
        mock_response.text = html_content
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.url = "https://example.com/page.html"
        mock_response.raise_for_status = Mock()

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com/page.html",
            "format": "raw"
        })

        self.assertTrue(result['success'])
        self.assertIn('<html>', result['content'])
        self.assertEqual(result['format'], 'html')
        print("✓ Raw HTML fetch works")


class TestFetchUrlErrors(unittest.TestCase):
    """Test error handling for various failure scenarios."""

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_http_404_error(self, mock_client):
        """Test handling of 404 Not Found."""
        import httpx

        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.reason_phrase = "Not Found"

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "404",
                request=Mock(),
                response=mock_response
            )
        )
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com/notfound"
        })

        self.assertFalse(result['success'])
        self.assertEqual(result['status_code'], 404)
        self.assertIn('404', result['message'])
        print("✓ HTTP 404 error handled")

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_timeout_error(self, mock_client):
        """Test handling of timeout."""
        import httpx

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com/slow",
            "timeout": 5
        })

        self.assertFalse(result['success'])
        self.assertIn('timeout', result['message'].lower())
        print("✓ Timeout error handled")

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_network_error(self, mock_client):
        """Test handling of network errors."""
        import httpx

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(
            side_effect=httpx.RequestError("Connection refused")
        )
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com/unreachable"
        })

        self.assertFalse(result['success'])
        self.assertIn('error', result)
        print("✓ Network error handled")


class TestFetchUrlFeatures(unittest.TestCase):
    """Test additional features like redirects and custom timeout."""

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_follows_redirects(self, mock_client):
        """Test that redirects are followed."""
        mock_response = Mock()
        mock_response.text = "Final content"
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/plain'}
        mock_response.url = "https://example.com/final"  # After redirect
        mock_response.raise_for_status = Mock()

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com/redirect"
        })

        self.assertTrue(result['success'])
        self.assertEqual(result['url'], "https://example.com/final")
        print("✓ Redirects are followed")

    @patch('ai_platform_engineering.multi_agents.tools.fetch_url.httpx.AsyncClient')
    def test_custom_timeout(self, mock_client):
        """Test custom timeout parameter."""
        mock_response = Mock()
        mock_response.text = "Content"
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/plain'}
        mock_response.url = "https://example.com"
        mock_response.raise_for_status = Mock()

        mock_client_instance = Mock()
        mock_client_instance.get = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client.return_value = mock_client_instance

        result = fetch_url.invoke({
            "url": "https://example.com",
            "timeout": 10
        })

        self.assertTrue(result['success'])
        # Verify AsyncClient was created with custom timeout
        mock_client.assert_called_once()
        call_kwargs = mock_client.call_args[1]
        self.assertEqual(call_kwargs['timeout'], 10)
        print("✓ Custom timeout parameter works")

    def test_result_structure(self):
        """Test that result has correct structure."""
        result = fetch_url.invoke({
            "url": "invalid-url"
        })

        # Check required keys
        self.assertIn('success', result)
        self.assertIn('content', result)
        self.assertIn('url', result)
        self.assertIn('message', result)
        print("✓ Result structure is correct")


if __name__ == '__main__':
    unittest.main()
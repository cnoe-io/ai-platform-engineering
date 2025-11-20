# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the fetch_url tool.

Tests cover:
- URL validation
- Successful fetches (text, raw)
- HTTP error handling
- Timeout handling
- Content type detection
- HTML to text extraction
- Redirect following
"""

import unittest
from unittest.mock import Mock, patch
from ai_platform_engineering.multi_agents.tools.fetch_url import fetch_url


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

    @patch('requests.get')
    def test_fetch_plain_text(self, mock_get):
        """Test fetching plain text content."""
        # Mock response
        mock_response = Mock()
        mock_response.text = "Hello, world!"
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/plain'}
        mock_response.url = "https://example.com/text.txt"
        mock_response.raise_for_status = Mock()

        mock_get.return_value = mock_response

        result = fetch_url.invoke({
            "url": "https://example.com/text.txt",
            "format": "text"
        })

        self.assertTrue(result['success'])
        self.assertEqual(result['content'], "Hello, world!")
        self.assertEqual(result['status_code'], 200)
        print("✓ Plain text fetch works")

    @patch('requests.get')
    def test_fetch_json_content(self, mock_get):
        """Test fetching JSON content."""
        mock_response = Mock()
        mock_response.text = '{"key": "value"}'
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'application/json'}
        mock_response.url = "https://api.example.com/data"
        mock_response.raise_for_status = Mock()

        mock_get.return_value = mock_response

        result = fetch_url.invoke({
            "url": "https://api.example.com/data"
        })

        self.assertTrue(result['success'])
        self.assertIn('"key"', result['content'])
        self.assertEqual(result['format'], 'json')
        print("✓ JSON content fetch works")

    @patch('bs4.BeautifulSoup')
    @patch('requests.get')
    def test_fetch_html_as_text(self, mock_get, mock_bs):
        """Test fetching HTML and converting to text."""
        html_content = "<html><body><h1>Title</h1><p>Paragraph</p></body></html>"

        mock_response = Mock()
        mock_response.text = html_content
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.url = "https://example.com/page.html"
        mock_response.raise_for_status = Mock()

        mock_get.return_value = mock_response

        # Mock BeautifulSoup
        mock_soup = Mock()
        mock_soup.get_text.return_value = "Title\nParagraph"
        # Make soup callable - when called with ["script", "style"], return empty list
        mock_soup.return_value = []
        mock_bs.return_value = mock_soup

        result = fetch_url.invoke({
            "url": "https://example.com/page.html",
            "format": "text"
        })

        self.assertTrue(result['success'])
        self.assertIn('Title', result['content'])
        print("✓ HTML to text conversion works")

    @patch('requests.get')
    def test_fetch_raw_html(self, mock_get):
        """Test fetching raw HTML content."""
        html_content = "<html><body><h1>Title</h1></body></html>"

        mock_response = Mock()
        mock_response.text = html_content
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.url = "https://example.com/page.html"
        mock_response.raise_for_status = Mock()

        mock_get.return_value = mock_response

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

    @patch('requests.get')
    def test_http_404_error(self, mock_get):
        """Test handling of 404 Not Found."""
        import requests

        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.reason_phrase = "Not Found"

        # Create HTTPError with response
        http_error = requests.exceptions.HTTPError("404 Not Found")
        http_error.response = mock_response
        mock_get.side_effect = http_error

        result = fetch_url.invoke({
            "url": "https://example.com/notfound"
        })

        self.assertFalse(result['success'])
        self.assertEqual(result['status_code'], 404)
        self.assertIn('404', result['message'])
        print("✓ HTTP 404 error handled")

    @patch('requests.get')
    def test_timeout_error(self, mock_get):
        """Test handling of timeout."""
        import requests

        mock_get.side_effect = requests.exceptions.Timeout("Request timed out")

        result = fetch_url.invoke({
            "url": "https://example.com/slow",
            "timeout": 5
        })

        self.assertFalse(result['success'])
        self.assertIn('timed out', result['message'].lower())
        print("✓ Timeout error handled")

    @patch('requests.get')
    def test_network_error(self, mock_get):
        """Test handling of network errors."""
        import requests

        mock_get.side_effect = requests.exceptions.RequestException("Connection refused")

        result = fetch_url.invoke({
            "url": "https://example.com/unreachable"
        })

        self.assertFalse(result['success'])
        self.assertIn('error', result)
        print("✓ Network error handled")


class TestFetchUrlFeatures(unittest.TestCase):
    """Test additional features like redirects and custom timeout."""

    @patch('requests.get')
    def test_follows_redirects(self, mock_get):
        """Test that redirects are followed."""
        mock_response = Mock()
        mock_response.text = "Final content"
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/plain'}
        mock_response.url = "https://example.com/final"  # After redirect
        mock_response.raise_for_status = Mock()

        mock_get.return_value = mock_response

        result = fetch_url.invoke({
            "url": "https://example.com/redirect"
        })

        self.assertTrue(result['success'])
        self.assertEqual(result['url'], "https://example.com/final")
        print("✓ Redirects are followed")

    @patch('requests.get')
    def test_custom_timeout(self, mock_get):
        """Test custom timeout parameter."""
        mock_response = Mock()
        mock_response.text = "Content"
        mock_response.status_code = 200
        mock_response.headers = {'content-type': 'text/plain'}
        mock_response.url = "https://example.com"
        mock_response.raise_for_status = Mock()

        mock_get.return_value = mock_response

        result = fetch_url.invoke({
            "url": "https://example.com",
            "timeout": 10
        })

        self.assertTrue(result['success'])
        # Verify requests.get was called with custom timeout
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args[1]
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

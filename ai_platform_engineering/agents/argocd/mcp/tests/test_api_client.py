#!/usr/bin/env python3
"""
Test script for API client functionality
"""

import asyncio
import sys
import os
from unittest.mock import patch, AsyncMock, MagicMock

# Add the mcp_argocd directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from mcp_argocd.api.client import make_api_request, assemble_nested_body

async def test_make_api_request():
    """Test the make_api_request function by mocking httpx properly"""

    print("Testing make_api_request...")

    # Test 1: Successful GET request
    print("\n1. Testing successful GET request:")
    mock_response_data = {"items": [], "total": 0}

    with patch('mcp_argocd.api.client.httpx.AsyncClient') as mock_client_class:
        # Create a mock client instance
        mock_client = AsyncMock()
        mock_client_class.return_value.__aenter__.return_value = mock_client

        # Create a mock response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = mock_response_data
        mock_response.text = '{"items": [], "total": 0}'

        # Set up the mock client method
        mock_client.get.return_value = mock_response

        success, data = await make_api_request("/api/v1/applications")
        print(f"Success: {success}, Data: {data}")
        assert success, "Should return success=True"
        assert data == mock_response_data, "Should return correct data"
        print("✓ Successful GET request handled correctly")

    # Test 2: HTTP error response
    print("\n2. Testing HTTP error response:")
    with patch('mcp_argocd.api.client.httpx.AsyncClient') as mock_client_class:
        mock_client = AsyncMock()
        mock_client_class.return_value.__aenter__.return_value = mock_client

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.json.return_value = {"error": "Not found"}
        mock_response.text = '{"error": "Not found"}'

        mock_client.get.return_value = mock_response

        success, data = await make_api_request("/api/v1/nonexistent")
        print(f"Success: {success}, Data: {data}")
        assert not success, "Should return success=False"
        assert "error" in data, "Should contain error information"
        print("✓ HTTP error response handled correctly")

    # Test 3: POST request with data
    print("\n3. Testing POST request with data:")
    request_data = {"name": "test-app", "project": "default"}

    with patch('mcp_argocd.api.client.httpx.AsyncClient') as mock_client_class:
        mock_client = AsyncMock()
        mock_client_class.return_value.__aenter__.return_value = mock_client

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = {"created": True}
        mock_response.text = '{"created": true}'

        mock_client.post.return_value = mock_response

        success, data = await make_api_request("/api/v1/applications", method="POST", data=request_data)
        print(f"Success: {success}, Data: {data}")
        assert success, "Should return success=True"
        assert data["created"], "Should return correct response data"
        print("✓ POST request with data handled correctly")

    # Test 4: Connection error
    print("\n4. Testing connection error:")
    with patch('mcp_argocd.api.client.httpx.AsyncClient') as mock_client_class:
        mock_client = AsyncMock()
        mock_client_class.return_value.__aenter__.return_value = mock_client

        # Make the get method raise an exception
        mock_client.get.side_effect = Exception("Connection failed")

        success, data = await make_api_request("/api/v1/applications")
        print(f"Success: {success}, Data: {data}")
        assert not success, "Should return success=False"
        assert "error" in data, "Should contain error information"
        print("✓ Connection error handled correctly")

    print("\n✅ All make_api_request tests passed!")

def test_assemble_nested_body():
    """Test the assemble_nested_body function"""

    print("\nTesting assemble_nested_body...")

    # Test 1: Simple flat body
    print("\n1. Testing simple flat body:")
    flat_body = {"name": "test", "value": "123"}
    result = assemble_nested_body(flat_body)
    print(f"Input: {flat_body}")
    print(f"Output: {result}")
    assert result == flat_body, "Should return same dict for simple flat body"
    print("✓ Simple flat body handled correctly")

    # Test 2: Nested body with underscores
    print("\n2. Testing nested body with underscores:")
    flat_body = {
        "metadata_name": "test-app",
        "metadata_namespace": "default",
        "spec_project": "default",
        "spec_source_repoURL": "https://github.com/test/repo"
    }
    result = assemble_nested_body(flat_body)
    print(f"Input: {flat_body}")
    print(f"Output: {result}")

    expected = {
        "metadata": {
            "name": "test-app",
            "namespace": "default"
        },
        "spec": {
            "project": "default",
            "source": {
                "repoURL": "https://github.com/test/repo"
            }
        }
    }
    assert result == expected, "Should create nested structure from flat keys"
    print("✓ Nested body with underscores handled correctly")

    # Test 3: Empty body
    print("\n3. Testing empty body:")
    flat_body = {}
    result = assemble_nested_body(flat_body)
    print(f"Input: {flat_body}")
    print(f"Output: {result}")
    assert result == {}, "Should return empty dict for empty input"
    print("✓ Empty body handled correctly")

    print("\n✅ All assemble_nested_body tests passed!")

if __name__ == "__main__":
    asyncio.run(test_make_api_request())
    test_assemble_nested_body()

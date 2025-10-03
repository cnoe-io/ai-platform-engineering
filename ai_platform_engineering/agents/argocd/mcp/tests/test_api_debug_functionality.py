#!/usr/bin/env python3
"""
Test script to verify the API client debug functionality works
"""

import sys
import os
import asyncio
import tempfile
import json
from unittest.mock import patch, AsyncMock

# Add the mcp_argocd directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from mcp_argocd.api.client import make_api_request

def write_api_response_to_temp(success: bool, data: dict, endpoint: str, params: dict = None) -> str:
    """
    Write API response data to a temporary file for debugging purposes

    Args:
        success: Whether the API request was successful
        data: The response data
        endpoint: The API endpoint that was called
        params: The parameters used in the request

    Returns:
        Path to the temporary file created
    """
    debug_info = {
        "success": success,
        "endpoint": endpoint,
        "params": params or {},
        "data": data,
        "timestamp": "2025-01-02T12:00:00Z"  # Mock timestamp for testing
    }

    # Create a temporary file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(debug_info, f, indent=2)
        temp_file_path = f.name

    print(f"Debug info written to: {temp_file_path}")
    return temp_file_path

def test_debug_functionality():
    """Test the debug functionality with various data scenarios"""

    print("Testing API debug functionality...")

    # Test 1: None data
    print("\n1. Testing with None data:")
    temp_file = write_api_response_to_temp(True, None, "/api/v1/applications", {"test": "param"})

    # Test 2: Data with None items
    print("\n2. Testing with data containing None items:")
    temp_file = write_api_response_to_temp(True, {"items": None, "total": 0}, "/api/v1/applications")

    # Test 3: Data with empty items
    print("\n3. Testing with data containing empty items:")
    temp_file = write_api_response_to_temp(True, {"items": [], "total": 0}, "/api/v1/applications")

    # Test 4: Failed request
    print("\n4. Testing with failed request:")
    temp_file = write_api_response_to_temp(False, {"error": "Connection failed"}, "/api/v1/applications")

    if temp_file:
        print(f"\nDebug file created at: {temp_file}")
        print("You can check this file to see the API response structure.")

        # Try to read and display the content
        try:
            with open(temp_file, 'r') as f:
                content = f.read()
                print(f"\nLast debug file content:\n{content}")
        except Exception as e:
            print(f"Could not read debug file: {e}")

    print("\nAPI debug functionality test completed!")

async def test_api_client_debug():
    """Test the API client with mocked responses for debugging"""

    print("\nTesting API client debug scenarios...")

    # Mock the aiohttp session
    with patch('mcp_argocd.api.client.httpx.AsyncClient') as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json = AsyncMock(return_value={"items": [], "total": 0})
        mock_response.text = AsyncMock(return_value='{"items": [], "total": 0}')

        mock_client.return_value.__aenter__.return_value.get.return_value = mock_response

        # Test successful request
        success, data = await make_api_request("/api/v1/applications")
        print(f"Test 1 - Successful request: success={success}, data={data}")

        # Test with error response
        mock_response.status_code = 500
        mock_response.json = AsyncMock(return_value={"error": "Internal server error"})
        mock_response.text = AsyncMock(return_value='{"error": "Internal server error"}')

        success, data = await make_api_request("/api/v1/applications")
        print(f"Test 2 - Error response: success={success}, data={data}")

    print("API client debug test completed!")

if __name__ == "__main__":
    test_debug_functionality()
    asyncio.run(test_api_client_debug())


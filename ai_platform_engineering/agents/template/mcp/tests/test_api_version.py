#!/usr/bin/env python3
"""
Test script for API version functionality
"""

import asyncio
import sys
import os
from unittest.mock import patch

# Add the mcp_argocd directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from mcp_argocd.tools.api_version import version_service__version

async def test_version_service():
    """Test the version service functionality"""

    print("Testing version service...")

    # Test 1: Successful version request
    print("\n1. Testing successful version request:")
    mock_version_data = {
        "Version": "v2.8.4",
        "BuildDate": "2023-10-15T10:30:00Z",
        "GitCommit": "abc123def456",
        "GitTreeState": "clean",
        "GoVersion": "go1.20.8",
        "Compiler": "gc",
        "Platform": "linux/amd64"
    }

    with patch('mcp_argocd.tools.api_version.make_api_request') as mock_request:
        mock_request.return_value = (True, mock_version_data)

        result = await version_service__version()
        print(f"Result: {result}")
        assert result == mock_version_data, "Should return version data"
        assert "Version" in result, "Should contain version information"
        print("✓ Successful version request handled correctly")

    # Test 2: API request failure
    print("\n2. Testing API request failure:")
    with patch('mcp_argocd.tools.api_version.make_api_request') as mock_request:
        mock_request.return_value = (False, {"error": "Service unavailable"})

        result = await version_service__version()
        print(f"Result: {result}")
        assert "error" in result, "Should return error for failed request"
        assert "Service unavailable" in result["error"] or "Request failed" in result["error"]
        print("✓ API failure handled correctly")

    # Test 3: Empty response
    print("\n3. Testing empty response:")
    with patch('mcp_argocd.tools.api_version.make_api_request') as mock_request:
        mock_request.return_value = (True, {})

        result = await version_service__version()
        print(f"Result: {result}")
        assert result == {}, "Should return empty dict for empty response"
        print("✓ Empty response handled correctly")

    print("\n✅ All version service tests passed!")

if __name__ == "__main__":
    asyncio.run(test_version_service())

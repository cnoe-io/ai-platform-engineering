#!/usr/bin/env python3
"""
Test script to verify the NoneType handling in list_applications
"""

import asyncio
import sys
import os
from unittest.mock import patch

# Add the mcp_argocd directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from mcp_argocd.tools.api_v1_applications import list_applications

async def test_list_applications_with_none_data():
    """Test that list_applications handles None data gracefully"""

    print("Testing list_applications with None data handling...")

    # Test 1: None data response
    print("\n1. Testing with None data response:")
    with patch('mcp_argocd.tools.api_v1_applications.make_api_request') as mock_request:
        mock_request.return_value = (True, None)  # Simulate successful request but None data

        result = await list_applications(summary_only=True)
        print(f"Result: {result}")
        assert "error" in result, "Should return error for None data"
        assert result["error"] == "No data received from API", "Should have specific error message"
        print("✓ None data handled correctly")

    # Test 2: Data with None items
    print("\n2. Testing with data containing None items:")
    with patch('mcp_argocd.tools.api_v1_applications.make_api_request') as mock_request:
        mock_request.return_value = (True, {"items": None, "total": 5})

        result = await list_applications(summary_only=True)
        print(f"Result: {result}")
        assert result["items"] == [], "Should return empty list for None items"
        assert result["total"] == 0, "Should return 0 total for None items"
        assert result["summary_only"], "Should preserve summary_only flag"
        print("✓ None items handled correctly")

    # Test 3: Valid empty items list
    print("\n3. Testing with valid empty items list:")
    with patch('mcp_argocd.tools.api_v1_applications.make_api_request') as mock_request:
        mock_request.return_value = (True, {"items": [], "total": 0})

        result = await list_applications(summary_only=True)
        print(f"Result: {result}")
        assert result["items"] == [], "Should return empty list for empty items"
        assert result["total"] == 0, "Should return 0 total for empty items"
        print("✓ Empty items list handled correctly")

    # Test 4: Valid data with applications
    print("\n4. Testing with valid application data:")
    sample_data = {
        "items": [
            {
                "metadata": {"name": "test-app", "namespace": "default"},
                "spec": {
                    "project": "default",
                    "source": {"repoURL": "https://github.com/test/repo", "path": ".", "targetRevision": "HEAD"}
                },
                "status": {
                    "sync": {"status": "Synced"},
                    "health": {"status": "Healthy"},
                    "phase": "Running"
                }
            }
        ],
        "total": 1
    }

    with patch('mcp_argocd.tools.api_v1_applications.make_api_request') as mock_request:
        mock_request.return_value = (True, sample_data)

        result = await list_applications(summary_only=True)
        print(f"Result: {result}")
        assert len(result["items"]) == 1, "Should return one application"
        assert result["total"] == 1, "Should return correct total"
        assert result["items"][0]["name"] == "test-app", "Should extract application name correctly"
        print("✓ Valid data handled correctly")

    # Test 5: API request failure
    print("\n5. Testing with API request failure:")
    with patch('mcp_argocd.tools.api_v1_applications.make_api_request') as mock_request:
        mock_request.return_value = (False, {"error": "Connection failed"})

        result = await list_applications(summary_only=True)
        print(f"Result: {result}")
        assert "error" in result, "Should return error for failed request"
        assert "Connection failed" in result["error"] or "Failed to retrieve applications" in result["error"]
        print("✓ API failure handled correctly")

    print("\n✅ All None data handling tests passed!")

async def test_list_applications_summary_vs_full():
    """Test the difference between summary_only=True and summary_only=False"""

    print("\nTesting summary_only parameter...")

    sample_data = {
        "items": [
            {
                "metadata": {"name": "test-app", "namespace": "default"},
                "spec": {
                    "project": "default",
                    "source": {"repoURL": "https://github.com/test/repo", "path": ".", "targetRevision": "HEAD"}
                },
                "status": {
                    "sync": {"status": "Synced"},
                    "health": {"status": "Healthy"},
                    "phase": "Running"
                }
            }
        ],
        "total": 1
    }

    with patch('mcp_argocd.tools.api_v1_applications.make_api_request') as mock_request:
        mock_request.return_value = (True, sample_data)

        # Test summary_only=True
        result_summary = await list_applications(summary_only=True)
        print(f"Summary result keys: {list(result_summary.keys())}")
        assert "summary_only" in result_summary, "Should have summary_only flag"
        assert result_summary["summary_only"], "Should be marked as summary"

        # Test summary_only=False
        result_full = await list_applications(summary_only=False)
        print(f"Full result keys: {list(result_full.keys())}")
        assert result_full == sample_data, "Should return original data when summary_only=False"

    print("✅ Summary vs full data test passed!")

if __name__ == "__main__":
    asyncio.run(test_list_applications_with_none_data())
    asyncio.run(test_list_applications_summary_vs_full())


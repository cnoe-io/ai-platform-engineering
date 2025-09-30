#!/usr/bin/env python3
"""
Test script for projects functionality
"""

import asyncio
import sys
import os
from unittest.mock import patch

# Add the mcp_argocd directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from mcp_argocd.tools.api_v1_projects import project_list

async def test_project_list():
    """Test the project list functionality"""

    print("Testing project list...")

    # Test 1: Successful project list request
    print("\n1. Testing successful project list request:")
    mock_projects_data = {
        "items": [
            {
                "metadata": {"name": "default", "namespace": "argocd"},
                "spec": {
                    "description": "Default project",
                    "sourceRepos": ["*"],
                    "destinations": [{"server": "https://kubernetes.default.svc", "namespace": "*"}]
                }
            },
            {
                "metadata": {"name": "production", "namespace": "argocd"},
                "spec": {
                    "description": "Production project",
                    "sourceRepos": ["https://github.com/company/prod-apps"],
                    "destinations": [{"server": "https://kubernetes.default.svc", "namespace": "prod-*"}]
                }
            }
        ],
        "total": 2
    }

    with patch('mcp_argocd.tools.api_v1_projects.make_api_request') as mock_request:
        mock_request.return_value = (True, mock_projects_data)

        result = await project_list(summary_only=True)
        print(f"Result: {result}")
        assert "items" in result, "Should contain items"
        assert len(result["items"]) == 2, "Should return two projects"
        print("✓ Successful project list request handled correctly")

    # Test 2: Filter by project name
    print("\n2. Testing filter by project name:")
    with patch('mcp_argocd.tools.api_v1_projects.make_api_request') as mock_request:
        mock_request.return_value = (True, mock_projects_data)

        result = await project_list(param_name="default", summary_only=True)
        print(f"Result: {result}")
        # The API call should include the name parameter
        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert "name" in call_args[1]["params"], "Should include name parameter"
        print("✓ Project name filtering handled correctly")

    # Test 3: API request failure
    print("\n3. Testing API request failure:")
    with patch('mcp_argocd.tools.api_v1_projects.make_api_request') as mock_request:
        mock_request.return_value = (False, {"error": "Unauthorized"})

        result = await project_list(summary_only=True)
        print(f"Result: {result}")
        assert "error" in result, "Should return error for failed request"
        print("✓ API failure handled correctly")

    # Test 4: Empty projects list
    print("\n4. Testing empty projects list:")
    with patch('mcp_argocd.tools.api_v1_projects.make_api_request') as mock_request:
        mock_request.return_value = (True, {"items": [], "total": 0})

        result = await project_list(summary_only=True)
        print(f"Result: {result}")
        assert result["items"] == [], "Should return empty list"
        assert result["total"] == 0, "Should return zero total"
        print("✓ Empty projects list handled correctly")

    print("\n✅ All project list tests passed!")

if __name__ == "__main__":
    asyncio.run(test_project_list())

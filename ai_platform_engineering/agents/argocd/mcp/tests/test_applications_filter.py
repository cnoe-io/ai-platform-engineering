#!/usr/bin/env python3
"""
Test script to demonstrate the applications filtering functionality
"""

import sys
import os
import asyncio
import fnmatch
from unittest.mock import patch

# Add the mcp_argocd directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from mcp_argocd.tools.api_v1_applications import list_applications

def matches_filter(app_data: dict, filter_params: dict = None) -> bool:
    """
    Helper function to test if an application matches the given filter parameters

    Args:
        app_data: Application data dictionary
        filter_params: Dictionary of filter parameters

    Returns:
        True if the application matches all filter criteria, False otherwise
    """
    if not filter_params:
        return True

    for key, value in filter_params.items():
        app_value = app_data.get(key, "")

        # Handle wildcard matching for name field
        if key == "name" and "*" in value:
            if not fnmatch.fnmatch(app_value, value):
                return False
        else:
            # Exact match for other fields
            if app_value != value:
                return False

    return True

def test_filter_functionality():
    """Test the filter functionality with sample data"""

    print("Testing applications filter functionality...")

    # Sample application data (simplified format)
    sample_apps = [
        {
            "name": "app1",
            "project": "default",
            "sync_status": "Synced",
            "health_status": "Healthy",
            "namespace": "production"
        },
        {
            "name": "app2",
            "project": "test",
            "sync_status": "OutOfSync",
            "health_status": "Degraded",
            "namespace": "staging"
        },
        {
            "name": "app3",
            "project": "default",
            "sync_status": "Synced",
            "health_status": "Healthy",
            "namespace": "production"
        }
    ]

    # Test 1: No filter (should match all)
    print("\n1. No filter - should match all apps:")
    for app in sample_apps:
        matches = matches_filter(app, None)
        print(f"  {app['name']}: {matches}")

    # Test 2: Filter by sync_status
    print("\n2. Filter by sync_status='Synced':")
    filter_params = {"sync_status": "Synced"}
    for app in sample_apps:
        matches = matches_filter(app, filter_params)
        print(f"  {app['name']}: {matches} (sync_status: {app['sync_status']})")

    # Test 3: Filter by multiple criteria
    print("\n3. Filter by project='default' AND health_status='Healthy':")
    filter_params = {"project": "default", "health_status": "Healthy"}
    for app in sample_apps:
        matches = matches_filter(app, filter_params)
        print(f"  {app['name']}: {matches} (project: {app['project']}, health: {app['health_status']})")

    # Test 4: Filter with no matches
    print("\n4. Filter by sync_status='Unknown' (should match none):")
    filter_params = {"sync_status": "Unknown"}
    for app in sample_apps:
        matches = matches_filter(app, filter_params)
        print(f"  {app['name']}: {matches}")

    # Test 5: Name filter with wildcards
    print("\n5. Name filter with wildcards:")

    # Exact match
    filter_params = {"name": "app1"}
    print("  Exact match 'app1':")
    for app in sample_apps:
        matches = matches_filter(app, filter_params)
        print(f"    {app['name']}: {matches}")

    # Starts with
    filter_params = {"name": "app*"}
    print("  Starts with 'app*':")
    for app in sample_apps:
        matches = matches_filter(app, filter_params)
        print(f"    {app['name']}: {matches}")

    # Contains
    filter_params = {"name": "*pp*"}
    print("  Contains '*pp*':")
    for app in sample_apps:
        matches = matches_filter(app, filter_params)
        print(f"    {app['name']}: {matches}")

    # Ends with
    filter_params = {"name": "*3"}
    print("  Ends with '*3':")
    for app in sample_apps:
        matches = matches_filter(app, filter_params)
        print(f"    {app['name']}: {matches}")

    print("\nFilter functionality test completed!")

async def test_list_applications_filtering():
    """Test the list_applications function with filtering parameters"""

    print("\nTesting list_applications with filtering...")

    # Mock API response with sample applications
    mock_response = {
        "items": [
            {
                "metadata": {"name": "app1", "namespace": "default"},
                "spec": {
                    "project": "default",
                    "source": {"repoURL": "https://github.com/example/repo1", "path": ".", "targetRevision": "HEAD"}
                },
                "status": {
                    "sync": {"status": "Synced"},
                    "health": {"status": "Healthy"},
                    "phase": "Running"
                }
            },
            {
                "metadata": {"name": "app2", "namespace": "test"},
                "spec": {
                    "project": "test",
                    "source": {"repoURL": "https://github.com/example/repo2", "path": "charts", "targetRevision": "main"}
                },
                "status": {
                    "sync": {"status": "OutOfSync"},
                    "health": {"status": "Degraded"},
                    "phase": "Failed"
                }
            }
        ],
        "total": 2
    }

    # Mock the make_api_request function
    with patch('mcp_argocd.tools.api_v1_applications.make_api_request') as mock_request:
        mock_request.return_value = (True, mock_response)

        # Test filtering by project
        result = await list_applications(project="default", summary_only=True)
        print(f"Filter by project 'default': {len(result.get('items', []))} items")

        # Test filtering by name
        result = await list_applications(name="app1", summary_only=True)
        print(f"Filter by name 'app1': {len(result.get('items', []))} items")

        # Test filtering by repo
        result = await list_applications(repo="https://github.com/example/repo1", summary_only=True)
        print(f"Filter by repo: {len(result.get('items', []))} items")

        # Verify the API was called with correct parameters
        calls = mock_request.call_args_list
        print(f"API was called {len(calls)} times with different filter parameters")

    print("List applications filtering test completed!")

if __name__ == "__main__":
    test_filter_functionality()
    asyncio.run(test_list_applications_filtering())

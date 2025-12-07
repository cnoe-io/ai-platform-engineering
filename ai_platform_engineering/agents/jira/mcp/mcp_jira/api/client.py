"""Jira API client

This module provides a client for interacting with the Jira API.
It handles authentication, request formatting, and response parsing.
"""

import os
import logging
from typing import Optional, Dict, Tuple, Any
import httpx
from dotenv import load_dotenv

from mcp_jira.config import MCP_JIRA_MOCK_RESPONSE

# Load environment variables
load_dotenv()

# Constants
# Update the base URL to be specific to Jira API



# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
)
logger = logging.getLogger("jira_mcp")



def get_env() -> Optional[str]:
    """Retrieve the environment variables."""
    token = os.getenv("ATLASSIAN_TOKEN") or os.getenv("ATLASSIAN_API_TOKEN") or os.getenv("JIRA_API_TOKEN") or os.getenv("JIRA_TOKEN")
    if not token:
        logger.warning("ATLASSIAN_TOKEN is not set in environment variables.")
    return token

async def make_api_request(
    path: str,
    method: str = "GET",
    token: Optional[str] = None,
    params: Dict[str, Any] = {},
    data: Dict[str, Any] = {},
    timeout: int = 30,
    expand: Optional[str] = None,
    order_by: Optional[str] = None,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Make a request to the Jira API v3

    Args:
        path: API path to request (without base URL)
        method: HTTP method (default: GET)
        token: API token (defaults to environment variable)
        params: Query parameters for the request (optional)
        data: JSON data for POST/PATCH/PUT requests (optional)
        timeout: Request timeout in seconds (default: 30)
        expand: Fields to expand using v3 dot notation (optional)
        order_by: Field to order by with +/- prefix (optional)

    Returns:
        Tuple of (success, data) where data is either the response JSON or an error dict
    """
    # Return mock responses if in mock mode (except for user operations)
    if MCP_JIRA_MOCK_RESPONSE:
        # Don't mock user operations - always use real API for users
        is_user_operation = (
            "rest/api/3/user" in path or
            "rest/api/3/user/search" in path
        )

        if is_user_operation:
            logger.info(f"🎭 Mock mode: Skipping mock for user operation {method} {path} - using real API")
        else:
            logger.info(f"🎭 Mock mode: Returning mock response for {method} {path}")
            return _get_mock_response(path, method, params, data)

    logger.debug(f"Preparing {method} request to {path}")

    # Use the utility function to retrieve the token if not provided
    token = token or get_env()
    email = str(os.getenv("ATLASSIAN_EMAIL") or os.getenv("JIRA_EMAIL") or os.getenv("JIRA_USER") or "")
    url = str(os.getenv("ATLASSIAN_API_URL") or os.getenv("JIRA_API_URL") or "")

    if not token:
        logger.error("No API token available. Request cannot proceed.")
        return (
            False,
            {"error": "Token is required. Please set the ATLASSIAN_TOKEN environment variable."},
        )

    if not url:
        logger.error("No API URL available. Request cannot proceed.")
        return (
            False,
            {"error": "ATLASSIAN_API_URL is required. Please set the ATLASSIAN_API_URL environment variable (e.g., https://your-domain.atlassian.net)."},
        )

    if not email:
        logger.error("No email available. Request cannot proceed.")
        return (
            False,
            {"error": "ATLASSIAN_EMAIL is required. Please set the ATLASSIAN_EMAIL environment variable."},
        )

    # Validate URL doesn't contain example.com placeholder
    if "example.com" in url.lower() or "jira.example.com" in url.lower():
        logger.error(f"Invalid API URL detected: {url}. This appears to be a placeholder value.")
        return (
            False,
            {"error": f"Invalid ATLASSIAN_API_URL: '{url}'. Please set ATLASSIAN_API_URL to your actual Jira instance URL (e.g., https://your-domain.atlassian.net)."},
        )

    import base64

    auth_str = f"{email}:{token}"
    encoded_auth = base64.b64encode(auth_str.encode()).decode()

    headers = {
        "Authorization": f"Basic {encoded_auth}",
        "Accept": "application/json",
        "Content-Type": "application/json"
    }

    # Add v3-specific parameters
    if expand:
        params["expand"] = expand
    if order_by:
        params["orderBy"] = order_by

    # DO NOT accidentally log headers that contain API tokens
    # logger.debug(f"Request headers: {headers}")
    logger.debug(f"Request parameters: {params}")
    if data:
        logger.debug(f"Request data: {data}")

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            url = f"{url}/{path}"
            logger.debug(f"Full request URL: {url}")

            method_map = {
                "GET": client.get,
                "POST": client.post,
                "PUT": client.put,
                "PATCH": client.patch,
                "DELETE": client.delete,
            }

            if method not in method_map:
                logger.error(f"Unsupported HTTP method: {method}")
                return (False, {"error": f"Unsupported method: {method}"})

            if method in ["POST", "PUT", "PATCH"]:
                response = await method_map[method](
                    url,
                    headers=headers,
                    params=params,
                    json=data
                )
            else:
                response = await method_map[method](
                    url,
                    headers=headers,
                    params=params
                )


            logger.debug(f"Response status code: {response.status_code}")

            if response.status_code in [200, 201, 202, 204]:
                if response.status_code == 204:
                    logger.debug("Request successful (204 No Content)")
                    return (True, {"status": "success"})
                try:
                    return (True, response.json())
                except ValueError:
                    logger.warning("Request successful but could not parse JSON response")
                    return (True, {"status": "success", "raw_response": response.text})
            else:
                error_message = f"API request failed: {response.status_code}"
                try:
                    error_data = response.json()
                    logger.error(f"Error details: {error_data}")

                    # Handle v3 error format
                    if "errorMessages" in error_data or "errors" in error_data:
                        return (False, {
                            "error": error_message,
                            "errorMessages": error_data.get("errorMessages", []),
                            "errors": error_data.get("errors", {}),
                            "status": response.status_code
                        })
                    else:
                        return (False, {"error": error_message, "details": error_data})
                except ValueError:
                    logger.error(f"Error response (not JSON): {response.text[:200]}")
                    return (False, {"error": f"{error_message} - {response.text[:200]}"})

    except httpx.RequestError as e:
        logger.error(f"Request error: {str(e)}")
        return (False, {"error": f"Request error: {str(e)}"})
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return (False, {"error": f"Unexpected error: {str(e)}"})


def _get_mock_response(path: str, method: str, params: Dict, data: Dict) -> Tuple[bool, Dict[str, Any]]:
    """Generate mock responses based on the API path and method.

    Note: User operations (get_user, search_users) are NOT mocked and will use real API.
    """
    from mcp_jira.mock.responses import (
        get_mock_issue,
        get_mock_created_issue,
        get_mock_search_results,
        get_mock_transitions,
        get_mock_worklog,
        get_mock_batch_create_response,
        get_mock_issue_link_types,
        get_mock_success_response,
    )

    # Comments (check before generic issue path since comment URLs contain issue path)
    if "/comment" in path:
        if method == "GET":
            if path.count("/") > 5:  # Getting a specific comment
                return (True, {
                    "id": "10000",
                    "body": {
                        "type": "doc",
                        "version": 1,
                        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Specific comment"}]}]
                    },
                    "author": {"displayName": "Test User"},
                    "created": "2024-01-01T12:00:00.000Z"
                })
            else:  # Getting all comments for an issue
                return (True, {
                    "comments": [
                        {"id": "10000", "body": {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "First comment"}]}]}, "author": {"displayName": "John Doe"}},
                        {"id": "10001", "body": {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Second comment"}]}]}, "author": {"displayName": "Jane Smith"}}
                    ],
                    "total": 2
                })
        elif method == "POST":
            return (True, {
                "id": "10002",
                "body": {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "New comment"}]}]},
                "author": {"displayName": "Current User"}
            })
        elif method == "PUT":
            return (True, {
                "id": "10000",
                "body": {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Updated comment"}]}]}
            })
        elif method == "DELETE":
            return (True, {})

    # Issue operations
    elif "rest/api/3/issue/" in path and method == "GET":
        if "/transitions" in path:
            issue_key = path.split("/issue/")[1].split("/")[0]
            return (True, get_mock_transitions(issue_key))
        elif "/worklog" in path:
            return (True, {"worklogs": [get_mock_worklog()]})
        else:
            issue_key = path.split("/issue/")[1].split("?")[0]
            return (True, get_mock_issue(issue_key))

    # Create issue
    elif path == "rest/api/3/issue" and method == "POST":
        project_key = data.get("fields", {}).get("project", {}).get("key", "PROJ")
        summary = data.get("fields", {}).get("summary", "Mock Issue")
        issue_type = data.get("fields", {}).get("issuetype", {}).get("name", "Task")
        return (True, get_mock_created_issue(project_key, summary, issue_type))

    # Batch create
    elif path == "rest/api/3/issue/bulk" and method == "POST":
        issues = data.get("issueUpdates", [])
        return (True, get_mock_batch_create_response(issues))

    # Search
    elif "rest/api/3/search" in path:
        jql = params.get("jql", "")
        max_results = params.get("maxResults", 50)
        return (True, get_mock_search_results(jql, max_results))

    # Transitions
    elif "/transitions" in path and method == "POST":
        return (True, {})

    # Worklog
    elif "/worklog" in path and method == "POST":
        return (True, get_mock_worklog())

    # Issue links
    elif "rest/api/3/issueLink" in path:
        if method == "POST":
            return (True, {})
        elif method == "DELETE":
            return (True, {})

    # Issue link types
    elif "rest/api/3/issueLinkType" in path:
        return (True, get_mock_issue_link_types())

    # Delete issue
    elif "rest/api/3/issue/" in path and method == "DELETE":
        return (True, {"status": "success"})

    # Boards - check sub-endpoints first before generic board
    elif "rest/agile/1.0/board" in path:
        # Board issues
        if "/issue" in path and method == "GET":
            return (True, {
                "issues": [
                    {"key": "PROJ-1", "fields": {"summary": "Issue 1", "status": {"name": "To Do"}}},
                    {"key": "PROJ-2", "fields": {"summary": "Issue 2", "status": {"name": "In Progress"}}}
                ],
                "total": 2
            })
        # Board sprints
        elif "/sprint" in path and method == "GET":
            return (True, {
                "values": [
                    {"id": 1, "name": "Sprint 1", "state": "active"},
                    {"id": 2, "name": "Sprint 2", "state": "future"}
                ],
                "total": 2
            })
        # Board epics
        elif "/epic" in path and method == "GET":
            return (True, {
                "values": [
                    {"id": 100, "key": "PROJ-100", "name": "Epic 1"},
                    {"id": 101, "key": "PROJ-101", "name": "Epic 2"}
                ],
                "total": 2
            })
        # Board versions
        elif "/version" in path and method == "GET":
            return (True, {
                "values": [
                    {"id": "10000", "name": "Version 1.0", "released": True},
                    {"id": "10001", "name": "Version 2.0", "released": False}
                ],
                "total": 2
            })
        # Board projects
        elif "/project" in path and method == "GET":
            return (True, {
                "values": [
                    {"id": "10000", "key": "PROJ", "name": "Project 1"},
                    {"id": "10001", "key": "PROJ2", "name": "Project 2"}
                ],
                "total": 2
            })
        # Board configuration
        elif "/configuration" in path and method == "GET":
            return (True, {
                "id": 1,
                "name": "Board 1",
                "type": "scrum",
                "columnConfig": {"columns": [{"name": "To Do"}, {"name": "In Progress"}, {"name": "Done"}]}
            })
        # Board backlog
        elif "/backlog" in path and method == "GET":
            return (True, {
                "issues": [
                    {"key": "PROJ-1", "fields": {"summary": "Backlog Issue 1", "status": {"name": "To Do"}}},
                    {"key": "PROJ-2", "fields": {"summary": "Backlog Issue 2", "status": {"name": "To Do"}}}
                ],
                "total": 2
            })
        elif method == "GET" and "/board/" in path:
            # Get single board (no sub-endpoint)
            parts = path.split("/board/")[1].split("/")
            board_id = parts[0].split("?")[0]
            # Only return board if there's no sub-endpoint
            if len(parts) == 1 or (len(parts) == 2 and parts[1] == ""):
                return (True, {
                    "id": int(board_id),
                    "name": f"Board {board_id}",
                    "type": "scrum",
                    "self": f"https://example.atlassian.net/rest/agile/1.0/board/{board_id}"
                })
        elif method == "GET":
            # List boards
            return (True, {
                "maxResults": 50,
                "startAt": 0,
                "total": 2,
                "isLast": True,
                "values": [
                    {"id": 1, "name": "Board 1", "type": "scrum"},
                    {"id": 2, "name": "Board 2", "type": "kanban"}
                ]
            })
        elif method == "POST":
            # Create board
            return (True, {
                "id": 123,
                "name": data.get("name", "New Board"),
                "type": data.get("type", "scrum"),
                "self": "https://example.atlassian.net/rest/agile/1.0/board/123"
            })
        elif method == "DELETE":
            return (True, {})

    # Sprints
    elif "rest/agile/1.0/sprint" in path:
        # Sprint issues
        if "/issue" in path and method == "GET":
            return (True, {
                "issues": [
                    {"key": "PROJ-1", "fields": {"summary": "Issue 1", "status": {"name": "In Progress"}}},
                    {"key": "PROJ-2", "fields": {"summary": "Issue 2", "status": {"name": "Done"}}}
                ],
                "total": 2
            })
        elif method == "GET" and "/sprint/" in path:
            # Get single sprint
            sprint_id = path.split("/sprint/")[1].split("/")[0].split("?")[0]
            return (True, {
                "id": int(sprint_id),
                "name": f"Sprint {sprint_id}",
                "state": "active",
                "boardId": 1
            })
        elif method == "POST":
            # Create sprint
            return (True, {
                "id": 456,
                "name": data.get("name", "New Sprint"),
                "state": "future",
                "boardId": data.get("originBoardId", 1)
            })
        elif method == "PUT":
            # Update sprint
            sprint_id = path.split("/sprint/")[1].split("?")[0]
            return (True, {
                "id": int(sprint_id),
                "name": data.get("name", f"Updated Sprint {sprint_id}"),
                "state": data.get("state", "active")
            })
        elif method == "DELETE":
            return (True, {})

    # Comments
    elif "/comment" in path:
        if method == "GET" and "/comment/" in path and "/comment" == path.split("/")[-1]:
            # Get single comment
            return (True, {
                "id": "10000",
                "body": "This is a comment",
                "author": {"displayName": "John Doe"}
            })
        elif method == "GET":
            # List comments
            return (True, {
                "comments": [
                    {"id": "10000", "body": "Comment 1"},
                    {"id": "10001", "body": "Comment 2"}
                ],
                "total": 2
            })
        elif method == "POST":
            # Add comment
            return (True, {
                "id": "10002",
                "body": data.get("body", "New comment")
            })
        elif method == "PUT":
            # Update comment
            comment_id = path.split("/comment/")[1].split("?")[0]
            return (True, {
                "id": comment_id,
                "body": data.get("body", "Updated comment")
            })
        elif method == "DELETE":
            return (True, {})

    # Filters
    elif "rest/api/3/filter" in path:
        if method == "GET" and "/filter/" in path:
            # Get single filter
            filter_id = path.split("/filter/")[1].split("/")[0].split("?")[0]
            return (True, {
                "id": filter_id,
                "name": f"Filter {filter_id}",
                "jql": "project = PROJ",
                "viewUrl": f"https://example.atlassian.net/issues/?filter={filter_id}"
            })
        elif method == "GET":
            # Search filters
            return (True, {
                "maxResults": 50,
                "startAt": 0,
                "total": 2,
                "isLast": True,
                "values": [
                    {"id": "12345", "name": "Filter 1", "jql": "project = PROJ"},
                    {"id": "12346", "name": "Filter 2", "jql": "project = TEST"}
                ]
            })
        elif method == "POST":
            # Create filter
            return (True, {
                "id": "12347",
                "name": data.get("name", "New Filter"),
                "jql": data.get("jql", ""),
                "viewUrl": "https://example.atlassian.net/issues/?filter=12347"
            })
        elif method == "PUT":
            # Update filter
            filter_id = path.split("/filter/")[1].split("?")[0]
            return (True, {
                "id": filter_id,
                "name": data.get("name", "Updated Filter"),
                "jql": data.get("jql", "")
            })
        elif method == "DELETE":
            return (True, {})

    # Backlogs
    elif "rest/agile/1.0/backlog" in path:
        return (True, {
            "issues": [
                {
                    "key": "PROJ-1",
                    "fields": {
                        "summary": "Backlog Issue 1",
                        "status": {"name": "To Do"},
                        "issuetype": {"name": "Story"},
                        "priority": {"name": "High"}
                    }
                },
                {
                    "key": "PROJ-2",
                    "fields": {
                        "summary": "Backlog Issue 2",
                        "status": {"name": "To Do"},
                        "issuetype": {"name": "Task"},
                        "priority": {"name": "Medium"}
                    }
                }
            ],
            "total": 2
        })

    # Default success for any other operation
    logger.warning(f"🎭 Mock mode: No specific mock for {method} {path}, returning generic success")
    return (True, get_mock_success_response())
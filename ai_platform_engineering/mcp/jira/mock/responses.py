"""Mock Jira API responses for testing without real Jira instance."""

from datetime import datetime, timedelta
from typing import Dict, Any, List


def get_mock_issue(issue_key: str = "PROJ-123") -> Dict[str, Any]:
    """Generate a mock Jira issue response."""
    now = datetime.now()
    return {
        "id": "10001",
        "key": issue_key,
        "self": f"https://example.atlassian.net/rest/api/3/issue/{issue_key}",
        "fields": {
            "summary": f"Mock issue {issue_key}",
            "description": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": f"This is a mock description for {issue_key}"
                            }
                        ]
                    }
                ]
            },
            "status": {
                "id": "10000",
                "name": "To Do",
                "statusCategory": {
                    "id": 2,
                    "key": "new",
                    "colorName": "blue-gray",
                    "name": "To Do"
                }
            },
            "priority": {
                "id": "3",
                "name": "Medium"
            },
            "issuetype": {
                "id": "10001",
                "name": "Task",
                "subtask": False
            },
            "assignee": {
                "accountId": "mock-user-123",
                "displayName": "Mock User",
                "emailAddress": "mock.user@example.com"
            },
            "reporter": {
                "accountId": "mock-reporter-456",
                "displayName": "Mock Reporter",
                "emailAddress": "reporter@example.com"
            },
            "created": (now - timedelta(days=5)).isoformat(),
            "updated": now.isoformat(),
            "labels": ["mock", "test"],
            "project": {
                "id": "10000",
                "key": issue_key.split("-")[0],
                "name": "Mock Project"
            }
        }
    }


def get_mock_created_issue(project_key: str, summary: str, issue_type: str = "Task") -> Dict[str, Any]:
    """Generate a mock response for created issue."""
    issue_number = 100 + hash(summary) % 900  # Generate pseudo-random number
    issue_key = f"{project_key}-{issue_number}"

    return {
        "id": str(10000 + issue_number),
        "key": issue_key,
        "self": f"https://example.atlassian.net/rest/api/3/issue/{issue_key}",
    }


def get_mock_search_results(jql: str, max_results: int = 50) -> Dict[str, Any]:
    """Generate mock search results."""
    # Generate a few mock issues
    issues = [
        get_mock_issue(f"PROJ-{i}")
        for i in range(123, min(123 + max_results, 130))
    ]

    return {
        "expand": "schema,names",
        "startAt": 0,
        "maxResults": max_results,
        "total": len(issues),
        "issues": issues
    }


def get_mock_transitions(issue_key: str) -> Dict[str, Any]:
    """Generate mock transitions for an issue."""
    return {
        "transitions": [
            {
                "id": "11",
                "name": "To Do",
                "to": {
                    "id": "10000",
                    "name": "To Do"
                }
            },
            {
                "id": "21",
                "name": "In Progress",
                "to": {
                    "id": "10001",
                    "name": "In Progress"
                }
            },
            {
                "id": "31",
                "name": "Done",
                "to": {
                    "id": "10002",
                    "name": "Done"
                }
            }
        ]
    }


def get_mock_user(account_id: str = None, email: str = None) -> Dict[str, Any]:
    """Generate a mock user."""
    if email:
        account_id = f"mock-{hash(email) % 10000}"
        display_name = email.split("@")[0].replace(".", " ").title()
    else:
        account_id = account_id or "mock-user-123"
        display_name = "Mock User"
        email = "mock.user@example.com"

    return {
        "accountId": account_id,
        "displayName": display_name,
        "emailAddress": email,
        "active": True,
        "avatarUrls": {
            "48x48": "https://avatar-management.services.atlassian.com/default/48"
        }
    }


def get_mock_users_search(query: str) -> List[Dict[str, Any]]:
    """Generate mock user search results."""
    return [
        get_mock_user(email=f"{query.lower()}@example.com"),
        get_mock_user(email=f"{query.lower()}.test@example.com"),
    ]


def get_mock_worklog() -> Dict[str, Any]:
    """Generate mock worklog."""
    now = datetime.now()
    return {
        "id": "10000",
        "self": "https://example.atlassian.net/rest/api/3/issue/PROJ-123/worklog/10000",
        "author": get_mock_user(),
        "updateAuthor": get_mock_user(),
        "created": (now - timedelta(hours=2)).isoformat(),
        "updated": now.isoformat(),
        "started": (now - timedelta(hours=3)).isoformat(),
        "timeSpent": "2h",
        "timeSpentSeconds": 7200
    }


def get_mock_batch_create_response(issues: List[Dict]) -> Dict[str, Any]:
    """Generate mock batch create response."""
    created_issues = []
    for i, issue in enumerate(issues):
        project_key = issue["fields"]["project"]["key"]
        created_issues.append({
            "id": str(20000 + i),
            "key": f"{project_key}-{200 + i}",
            "self": f"https://example.atlassian.net/rest/api/3/issue/{project_key}-{200 + i}"
        })

    return {
        "issues": created_issues,
        "errors": []
    }


def get_mock_issue_link_types() -> Dict[str, Any]:
    """Generate mock issue link types."""
    return {
        "issueLinkTypes": [
            {
                "id": "10000",
                "name": "Blocks",
                "inward": "is blocked by",
                "outward": "blocks"
            },
            {
                "id": "10001",
                "name": "Relates",
                "inward": "relates to",
                "outward": "relates to"
            },
            {
                "id": "10002",
                "name": "Duplicate",
                "inward": "is duplicated by",
                "outward": "duplicates"
            }
        ]
    }


def get_mock_success_response() -> Dict[str, Any]:
    """Generic success response."""
    return {"status": "success"}



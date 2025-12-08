"""Project operations for Jira MCP"""

import json
import logging
from typing import Optional, Annotated
from pydantic import Field

from mcp_jira.api.client import make_api_request
from mcp_jira.models.jira.project import JiraProject

logger = logging.getLogger("mcp-jira")


async def get_project(
    project_key: Annotated[str, Field(description="The key of the Jira project (e.g., 'PROJ', 'SCRUM')")]
) -> str:
    """Get details of a specific Jira project by its key.

    This function retrieves detailed information about a single Jira project
    using the project key.

    Args:
        project_key: The key of the Jira project.

    Returns:
        JSON string representing the project details with success status.

    Example:
        >>> result = await get_project("PROJ")
        >>> print(result)
        {
            "success": true,
            "project": {
                "key": "PROJ",
                "name": "My Project",
                "projectTypeKey": "software",
                ...
            }
        }
    """
    logger.info(f"Fetching details for project: {project_key}")

    try:
        success, response = await make_api_request(
            path=f"rest/api/3/project/{project_key}",
            method="GET",
        )

        if not success:
            raise ValueError(f"Failed to fetch project '{project_key}': {response}")

        # Convert to JiraProject model and then to dict
        project = JiraProject.from_api_response(response)
        result = project.to_simplified_dict()

        logger.info(f"Successfully fetched project: {project_key}")
        return json.dumps(
            {
                "success": True,
                "project": result,
            },
            indent=2,
            ensure_ascii=False,
        )

    except Exception as e:
        error_message = str(e)
        logger.error(f"Failed to fetch project '{project_key}': {error_message}")
        return json.dumps(
            {
                "success": False,
                "error": error_message,
                "project_key": project_key,
            },
            indent=2,
            ensure_ascii=False,
        )


async def search_projects(
    query: Annotated[
        str,
        Field(
            description="The search query to filter projects by name or key (e.g., 'Platform', 'SCRUM')"
        ),
    ],
    start_at: Annotated[int, Field(description="The starting index (default: 0)", default=0)] = 0,
    max_results: Annotated[int, Field(description="Maximum number of results (default: 50)", default=50)] = 50,
) -> str:
    """Search for Jira projects by name or key.

    This function searches for projects matching the provided query string.
    It uses the Jira project search endpoint to find projects.

    Args:
        query: The search query to filter projects by name or key.
        start_at: The starting index for pagination (default: 0).
        max_results: Maximum number of results to return (default: 50).

    Returns:
        JSON string representing the list of matching projects with metadata.

    Example:
        >>> result = await search_projects("Platform")
        >>> print(result)
        {
            "success": true,
            "projects": [...],
            "total": 5,
            "start_at": 0,
            "max_results": 50
        }
    """
    logger.info(f"Searching for projects with query: {query}")

    try:
        params = {
            "query": query,
            "startAt": start_at,
            "maxResults": max_results,
        }

        success, response = await make_api_request(
            path="rest/api/3/project/search",
            method="GET",
            params=params,
        )

        if not success:
            raise ValueError(f"Failed to search projects with query '{query}': {response}")

        # Extract values from response
        values = response.get("values", [])
        total = response.get("total", 0)

        # Convert each project to JiraProject model
        projects = [JiraProject.from_api_response(proj).to_simplified_dict() for proj in values]

        logger.info(f"Found {len(projects)} projects matching query: {query}")
        return json.dumps(
            {
                "success": True,
                "projects": projects,
                "total": total,
                "start_at": start_at,
                "max_results": max_results,
                "query": query,
            },
            indent=2,
            ensure_ascii=False,
        )

    except Exception as e:
        error_message = str(e)
        logger.error(f"Failed to search projects with query '{query}': {error_message}")
        return json.dumps(
            {
                "success": False,
                "error": error_message,
                "query": query,
            },
            indent=2,
            ensure_ascii=False,
        )


async def list_projects(
    expand: Annotated[
        Optional[str],
        Field(
            description=(
                "Comma-separated list of fields to expand. "
                "Possible values: description, issueTypes, lead, projectCategory, url, "
                "archived, permissions, properties, roles, avatarUrls"
            ),
            default=None,
        ),
    ] = None,
    start_at: Annotated[int, Field(description="The starting index (default: 0)", default=0)] = 0,
    max_results: Annotated[int, Field(description="Maximum number of results (default: 50)", default=50)] = 50,
) -> str:
    """List all accessible Jira projects.

    This function retrieves all projects accessible to the authenticated user.
    Use this to get a complete list of all available projects.

    Args:
        expand: Optional comma-separated list of fields to expand.
        start_at: The starting index for pagination (default: 0).
        max_results: Maximum number of results to return (default: 50).

    Returns:
        JSON string representing the list of all accessible projects.

    Example:
        >>> result = await list_projects(expand="description,lead")
        >>> print(result)
        {
            "success": true,
            "projects": [...],
            "count": 25,
            "start_at": 0,
            "max_results": 50
        }
    """
    logger.info("Fetching list of all accessible projects")

    try:
        # Use /rest/api/3/project/search endpoint as per Jira API v3
        # This endpoint returns projects, not issues
        params = {
            "startAt": start_at,
            "maxResults": max_results,
        }
        if expand:
            params["expand"] = expand

        success, response = await make_api_request(
            path="rest/api/3/project/search",
            method="GET",
            params=params,
        )

        if not success:
            raise ValueError(f"Failed to fetch projects list: {response}")

        # The /project/search endpoint returns projects in a "values" array
        # Ensure we're extracting projects, not issues
        if isinstance(response, dict):
            projects_list = response.get("values", [])
            total = response.get("total", len(projects_list))
        elif isinstance(response, list):
            # Handle case where response is directly a list
            projects_list = response
            total = len(response)
        else:
            projects_list = []
            total = 0

        # Convert each project to JiraProject model
        # The /rest/api/3/project/search endpoint returns projects, not issues
        projects = []
        for proj in projects_list:
            if not isinstance(proj, dict):
                logger.warning(f"Skipping non-dict object: {type(proj)}")
                continue

            try:
                project_dict = JiraProject.from_api_response(proj).to_simplified_dict()
                projects.append(project_dict)
            except Exception as e:
                logger.warning(f"Failed to parse project object: {e}, skipping. Object: {proj.get('key', 'unknown')}")
                continue

        logger.info(f"Successfully fetched {len(projects)} projects (total: {total})")
        return json.dumps(
            {
                "success": True,
                "projects": projects,
                "total": total,
                "count": len(projects),
                "start_at": start_at,
                "max_results": max_results,
            },
            indent=2,
            ensure_ascii=False,
        )

    except Exception as e:
        error_message = str(e)
        logger.error(f"Failed to fetch projects list: {error_message}")
        return json.dumps(
            {
                "success": False,
                "error": error_message,
            },
            indent=2,
            ensure_ascii=False,
        )


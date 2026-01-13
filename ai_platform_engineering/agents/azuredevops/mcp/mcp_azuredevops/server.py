# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Azure DevOps MCP Server - Provides tools for interacting with Azure DevOps."""

import os
import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

# Initialize FastMCP server
mcp = FastMCP("Azure DevOps MCP Server")

# Configuration
AZDO_PAT = os.getenv("AZDO_PAT", "")
AZDO_ORG_URL = os.getenv("AZDO_ORG_URL", "")


def get_client() -> httpx.Client:
    """Create an authenticated HTTP client for Azure DevOps API."""
    import base64
    auth_string = base64.b64encode(f":{AZDO_PAT}".encode()).decode()
    return httpx.Client(
        base_url=f"{AZDO_ORG_URL}",
        headers={
            "Authorization": f"Basic {auth_string}",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    )


# ============================================
# PROJECT TOOLS
# ============================================

@mcp.tool()
def list_projects() -> dict:
    """List all projects in the Azure DevOps organization."""
    with get_client() as client:
        response = client.get("/_apis/projects?api-version=7.1")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_project(project_name: str) -> dict:
    """Get details of a specific project.

    Args:
        project_name: Name of the project to retrieve
    """
    with get_client() as client:
        response = client.get(f"/_apis/projects/{project_name}?api-version=7.1")
        response.raise_for_status()
        return response.json()


# ============================================
# PIPELINE TOOLS
# ============================================

@mcp.tool()
def list_pipelines(project: str) -> dict:
    """List all pipelines in a project.

    Args:
        project: Name of the project
    """
    with get_client() as client:
        response = client.get(f"/{project}/_apis/pipelines?api-version=7.1")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_pipeline(project: str, pipeline_id: int) -> dict:
    """Get details of a specific pipeline.

    Args:
        project: Name of the project
        pipeline_id: ID of the pipeline
    """
    with get_client() as client:
        response = client.get(f"/{project}/_apis/pipelines/{pipeline_id}?api-version=7.1")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def run_pipeline(project: str, pipeline_id: int, branch: str = "main") -> dict:
    """Run a pipeline.

    Args:
        project: Name of the project
        pipeline_id: ID of the pipeline to run
        branch: Branch to run the pipeline on (default: main)
    """
    with get_client() as client:
        response = client.post(
            f"/{project}/_apis/pipelines/{pipeline_id}/runs?api-version=7.1",
            json={"resources": {"repositories": {"self": {"refName": f"refs/heads/{branch}"}}}}
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def list_pipeline_runs(project: str, pipeline_id: int, top: int = 10) -> dict:
    """List recent runs of a pipeline.

    Args:
        project: Name of the project
        pipeline_id: ID of the pipeline
        top: Number of runs to return (default: 10)
    """
    with get_client() as client:
        response = client.get(f"/{project}/_apis/pipelines/{pipeline_id}/runs?api-version=7.1&$top={top}")
        response.raise_for_status()
        return response.json()


# ============================================
# REPOSITORY TOOLS
# ============================================

@mcp.tool()
def list_repositories(project: str) -> dict:
    """List all Git repositories in a project.

    Args:
        project: Name of the project
    """
    with get_client() as client:
        response = client.get(f"/{project}/_apis/git/repositories?api-version=7.1")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_repository(project: str, repository_id: str) -> dict:
    """Get details of a specific repository.

    Args:
        project: Name of the project
        repository_id: ID or name of the repository
    """
    with get_client() as client:
        response = client.get(f"/{project}/_apis/git/repositories/{repository_id}?api-version=7.1")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def list_branches(project: str, repository_id: str) -> dict:
    """List all branches in a repository.

    Args:
        project: Name of the project
        repository_id: ID or name of the repository
    """
    with get_client() as client:
        response = client.get(f"/{project}/_apis/git/repositories/{repository_id}/refs?filter=heads&api-version=7.1")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def list_commits(project: str, repository_id: str, branch: str = "main", top: int = 10) -> dict:
    """List recent commits in a repository.

    Args:
        project: Name of the project
        repository_id: ID or name of the repository
        branch: Branch name (default: main)
        top: Number of commits to return (default: 10)
    """
    with get_client() as client:
        response = client.get(
            f"/{project}/_apis/git/repositories/{repository_id}/commits?searchCriteria.itemVersion.version={branch}&$top={top}&api-version=7.1"
        )
        response.raise_for_status()
        return response.json()


# ============================================
# WORK ITEM TOOLS
# ============================================

@mcp.tool()
def get_work_item(work_item_id: int) -> dict:
    """Get details of a specific work item.

    Args:
        work_item_id: ID of the work item
    """
    with get_client() as client:
        response = client.get(f"/_apis/wit/workitems/{work_item_id}?api-version=7.1")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def query_work_items(project: str, query: str) -> dict:
    """Query work items using WIQL.

    Args:
        project: Name of the project
        query: WIQL query string
    """
    with get_client() as client:
        response = client.post(
            f"/{project}/_apis/wit/wiql?api-version=7.1",
            json={"query": query}
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def create_work_item(project: str, work_item_type: str, title: str, description: str = "") -> dict:
    """Create a new work item.

    Args:
        project: Name of the project
        work_item_type: Type of work item (e.g., Bug, Task, User Story)
        title: Title of the work item
        description: Description of the work item (optional)
    """
    with get_client() as client:
        operations = [
            {"op": "add", "path": "/fields/System.Title", "value": title},
        ]
        if description:
            operations.append({"op": "add", "path": "/fields/System.Description", "value": description})

        response = client.post(
            f"/{project}/_apis/wit/workitems/${work_item_type}?api-version=7.1",
            json=operations,
            headers={"Content-Type": "application/json-patch+json"}
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def update_work_item(work_item_id: int, field_updates: dict) -> dict:
    """Update a work item.

    Args:
        work_item_id: ID of the work item
        field_updates: Dictionary of field names to new values
    """
    with get_client() as client:
        operations = [
            {"op": "add", "path": f"/fields/{field}", "value": value}
            for field, value in field_updates.items()
        ]
        response = client.patch(
            f"/_apis/wit/workitems/{work_item_id}?api-version=7.1",
            json=operations,
            headers={"Content-Type": "application/json-patch+json"}
        )
        response.raise_for_status()
        return response.json()


# ============================================
# BUILD TOOLS
# ============================================

@mcp.tool()
def list_builds(project: str, top: int = 10) -> dict:
    """List recent builds in a project.

    Args:
        project: Name of the project
        top: Number of builds to return (default: 10)
    """
    with get_client() as client:
        response = client.get(f"/{project}/_apis/build/builds?$top={top}&api-version=7.1")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_build(project: str, build_id: int) -> dict:
    """Get details of a specific build.

    Args:
        project: Name of the project
        build_id: ID of the build
    """
    with get_client() as client:
        response = client.get(f"/{project}/_apis/build/builds/{build_id}?api-version=7.1")
        response.raise_for_status()
        return response.json()


# ============================================
# PULL REQUEST TOOLS
# ============================================

@mcp.tool()
def list_pull_requests(project: str, repository_id: str, status: str = "active") -> dict:
    """List pull requests in a repository.

    Args:
        project: Name of the project
        repository_id: ID or name of the repository
        status: Filter by status (active, completed, abandoned, all)
    """
    with get_client() as client:
        response = client.get(
            f"/{project}/_apis/git/repositories/{repository_id}/pullrequests?searchCriteria.status={status}&api-version=7.1"
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_pull_request(project: str, repository_id: str, pull_request_id: int) -> dict:
    """Get details of a specific pull request.

    Args:
        project: Name of the project
        repository_id: ID or name of the repository
        pull_request_id: ID of the pull request
    """
    with get_client() as client:
        response = client.get(
            f"/{project}/_apis/git/repositories/{repository_id}/pullrequests/{pull_request_id}?api-version=7.1"
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def create_pull_request(
    project: str,
    repository_id: str,
    source_branch: str,
    target_branch: str,
    title: str,
    description: str = ""
) -> dict:
    """Create a new pull request.

    Args:
        project: Name of the project
        repository_id: ID or name of the repository
        source_branch: Source branch name
        target_branch: Target branch name
        title: Title of the pull request
        description: Description of the pull request (optional)
    """
    with get_client() as client:
        response = client.post(
            f"/{project}/_apis/git/repositories/{repository_id}/pullrequests?api-version=7.1",
            json={
                "sourceRefName": f"refs/heads/{source_branch}",
                "targetRefName": f"refs/heads/{target_branch}",
                "title": title,
                "description": description,
            }
        )
        response.raise_for_status()
        return response.json()

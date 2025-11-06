#!/usr/bin/env python3
"""
Search tool for ArgoCD resources.

This module provides a unified search capability across all ArgoCD resources
(applications, projects, applicationsets, clusters) using keyword-based filtering
on names, descriptions, labels, annotations, etc.
"""

from typing import Dict, Any, List, Optional
import re
import logging
from mcp_argocd.tools.api_v1_applications import list_applications
from mcp_argocd.tools.api_v1_projects import project_list
from mcp_argocd.tools.api_v1_applicationsets import applicationset_list
from mcp_argocd.tools.api_v1_clusters import cluster_service__list

# Configure logging
logger = logging.getLogger(__name__)

# Safety limits to prevent OOM
MAX_SEARCH_RESULTS = 1000  # Never return more than 1000 items total across all resource types
WARN_SEARCH_RESULTS = 500  # Log warning if search returns more than this


async def search_argocd_resources(
    query: str,
    resource_types: List[str] = None,
    case_sensitive: bool = False,
    page: int = 1,
    page_size: int = 20
) -> Dict[str, Any]:
    """
    Search across all ArgoCD resources using keyword-based filtering.

    This tool searches for the query string across multiple fields:
    - Names (application, project, applicationset, cluster names)
    - Descriptions
    - Labels and annotations
    - Repository URLs
    - Namespaces
    - Server URLs (for clusters)

    Args:
        query (str): The search term to look for. Supports partial matches.
        resource_types (List[str], optional): Resource types to search.
            Valid values: ["applications", "projects", "applicationsets", "clusters"].
            Defaults to all types.
        case_sensitive (bool, optional): Whether the search should be case-sensitive.
            Defaults to False.
        page (int, optional): Page number for paginated results. Defaults to 1.
        page_size (int, optional): Number of results per page. Defaults to 20, max 100.

    Returns:
        Dict[str, Any]: Search results with the following structure:
            {
                "query": str,
                "results": {
                    "applications": [...],
                    "projects": [...],
                    "applicationsets": [...],
                    "clusters": [...]
                },
                "total_matches": int,
                "pagination": {
                    "page": int,
                    "page_size": int,
                    "total_items": int,
                    "total_pages": int,
                    "has_next": bool,
                    "has_prev": bool
                }
            }

    Examples:
        # Search for "my-app" across all resources
        search_argocd_resources("my-app")

        # Search only in applications and projects
        search_argocd_resources("production", resource_types=["applications", "projects"])

        # Case-sensitive search
        search_argocd_resources("MyApp", case_sensitive=True)

        # Get second page of results
        search_argocd_resources("test", page=2, page_size=10)
    """
    # Validate and set defaults
    if resource_types is None:
        resource_types = ["applications", "projects", "applicationsets", "clusters"]

    # Validate resource types
    valid_types = {"applications", "projects", "applicationsets", "clusters"}
    resource_types = [rt.lower() for rt in resource_types]
    invalid_types = [rt for rt in resource_types if rt not in valid_types]
    if invalid_types:
        return {
            "error": f"Invalid resource types: {invalid_types}. Valid types: {list(valid_types)}"
        }

    # Enforce pagination limits
    page = max(1, page)
    page_size = min(100, max(1, page_size))

    # Prepare search pattern
    if case_sensitive:
        pattern = re.compile(re.escape(query))
    else:
        pattern = re.compile(re.escape(query), re.IGNORECASE)

    results = {
        "applications": [],
        "projects": [],
        "applicationsets": [],
        "clusters": []
    }

    # Helper function to check if pattern matches in any field
    def matches_pattern(text: str) -> bool:
        if text is None:
            return False
        return pattern.search(str(text)) is not None

    def matches_dict(d: dict) -> bool:
        """Recursively search for pattern in dictionary values."""
        if not d:
            return False
        for value in d.values():
            if isinstance(value, str) and matches_pattern(value):
                return True
            elif isinstance(value, dict) and matches_dict(value):
                return True
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and matches_pattern(item):
                        return True
                    elif isinstance(item, dict) and matches_dict(item):
                        return True
        return False

    # Search applications
    # Note: Fetch in smaller batches to avoid memory spikes
    # For search, we limit to first 500 of each resource type
    if "applications" in resource_types:
        apps_response = await list_applications(summary_only=True, page=1, page_size=100)
        if "items" in apps_response:
            for app in apps_response["items"]:
                # Search in key fields
                if (matches_pattern(app.get("name", "")) or
                    matches_pattern(app.get("namespace", "")) or
                    matches_pattern(app.get("project", "")) or
                    matches_pattern(app.get("repo", "")) or
                    matches_pattern(app.get("path", "")) or
                    matches_pattern(app.get("sync_status", "")) or
                    matches_pattern(app.get("health_status", ""))):
                    results["applications"].append(app)

    # Search projects
    if "projects" in resource_types:
        projects_response = await project_list(summary_only=True, page=1, page_size=100)
        if "items" in projects_response:
            for project in projects_response["items"]:
                # Search in key fields
                if (matches_pattern(project.get("name", "")) or
                    matches_pattern(project.get("description", "")) or
                    matches_dict({"repos": project.get("source_repos", [])})):
                    results["projects"].append(project)

    # Search applicationsets
    if "applicationsets" in resource_types:
        appsets_response = await applicationset_list(summary_only=True, page=1, page_size=100)
        if "items" in appsets_response:
            for appset in appsets_response["items"]:
                # Search in key fields
                if (matches_pattern(appset.get("name", "")) or
                    matches_pattern(appset.get("namespace", "")) or
                    matches_pattern(appset.get("template_name", "")) or
                    matches_pattern(appset.get("template_project", "")) or
                    matches_pattern(appset.get("template_repo", "")) or
                    matches_pattern(appset.get("template_path", ""))):
                    results["applicationsets"].append(appset)

    # Search clusters
    if "clusters" in resource_types:
        clusters_response = await cluster_service__list(summary_only=True, page=1, page_size=100)
        if "items" in clusters_response:
            for cluster in clusters_response["items"]:
                # Search in key fields
                if (matches_pattern(cluster.get("name", "")) or
                    matches_pattern(cluster.get("server", "")) or
                    matches_pattern(cluster.get("project", "")) or
                    matches_dict(cluster.get("labels", {})) or
                    matches_dict(cluster.get("annotations", {}))):
                    results["clusters"].append(cluster)

    # Flatten all results for pagination
    all_results = []
    for resource_type, items in results.items():
        for item in items:
            all_results.append({
                "resource_type": resource_type,
                "data": item
            })

    total_matches = len(all_results)

    # Safety check: Enforce max search results to prevent OOM
    if total_matches > MAX_SEARCH_RESULTS:
        logger.error(
            f"Search query '{query}' returned {total_matches} results, "
            f"exceeding safety limit of {MAX_SEARCH_RESULTS}. Request rejected."
        )
        return {
            "error": f"Query returned {total_matches} results, exceeding safety limit of {MAX_SEARCH_RESULTS}.",
            "suggestion": "Please refine your search with more specific terms or filter by resource_types.",
            "query": query,
            "total_matches": total_matches,
            "limit": MAX_SEARCH_RESULTS,
            "breakdown": {
                "applications": len(results["applications"]),
                "projects": len(results["projects"]),
                "applicationsets": len(results["applicationsets"]),
                "clusters": len(results["clusters"])
            }
        }

    # Warning for large result sets
    if total_matches > WARN_SEARCH_RESULTS:
        logger.warning(
            f"Search query '{query}' returned {total_matches} results. "
            f"Consider refining search terms."
        )
    total_pages = (total_matches + page_size - 1) // page_size if total_matches > 0 else 1

    # Paginate
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size

    # Check if page is out of bounds
    if start_idx >= total_matches and total_matches > 0:
        return {
            "error": f"Page {page} out of bounds. Total pages: {total_pages}",
            "query": query,
            "total_matches": total_matches,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_items": total_matches,
                "total_pages": total_pages,
                "has_next": False,
                "has_prev": page > 1
            }
        }

    paginated_results = all_results[start_idx:end_idx]

    # Group paginated results back by type
    paginated_by_type = {
        "applications": [],
        "projects": [],
        "applicationsets": [],
        "clusters": []
    }

    for result in paginated_results:
        resource_type = result["resource_type"]
        paginated_by_type[resource_type].append(result["data"])

    return {
        "query": query,
        "case_sensitive": case_sensitive,
        "searched_resource_types": resource_types,
        "results": paginated_by_type,
        "total_matches": total_matches,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_items": total_matches,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
            "showing_from": start_idx + 1 if paginated_results else 0,
            "showing_to": start_idx + len(paginated_results)
        }
    }


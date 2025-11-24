#!/usr/bin/env python3
"""
Search tool for ArgoCD resources.

This module provides a unified search capability across all ArgoCD resources
(applications, projects, applicationsets, clusters) using keyword-based filtering
on names, descriptions, labels, annotations, etc.
"""

from typing import Dict, Any, List
import re
import logging
from mcp_argocd.tools.api_v1_applications import (
    list_applications,
    _get_argocd_base_url,
    _add_argocd_link_to_app
)
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
    Search across ArgoCD resources using two-tier search strategy.

    This tool uses a smart search approach:
    1. **Basic Search (Fast)**: First searches through the first page (up to 100 items per type)
    2. **Exhaustive Search (Fallback)**: If basic search returns 0 results, automatically
       paginates through ALL pages to ensure nothing is missed.

    It searches for the query string across multiple fields:
    - Names (application, project, applicationset, cluster names)
    - Descriptions
    - Labels and annotations
    - Repository URLs
    - Namespaces
    - Server URLs (for clusters)
    - Paths (for applications)

    Progress information is included in the response, especially when exhaustive search is performed.

    Args:
        query (str): The search term to look for. Supports partial matches and regex patterns.
        resource_types (List[str], optional): Resource types to search.
            Valid values: ["applications", "projects", "applicationsets", "clusters"].
            Defaults to all types.
        case_sensitive (bool, optional): Whether the search should be case-sensitive.
            Defaults to False.
        page (int, optional): Page number for paginated results. Defaults to 1.
        page_size (int, optional): Number of results per page. Defaults to 20, max 100.

    Returns:
        Dict[str, Any]: Search results with progress information:
            {
                "query": str,
                "exhaustive_search": bool,  # True if exhaustive search was performed
                "results": {
                    "applications": [...],
                    "projects": [...],
                    "applicationsets": [...],
                    "clusters": [...]
                },
                "total_matches": int,
                "resources_searched": {
                    "applications": int,  # Total apps examined
                    "projects": int,
                    "applicationsets": int,
                    "clusters": int
                },
                "progress": {
                    "status": "completed",
                    "message": "Basic search completed" or "Exhaustive search completed. Examined 819 applications",
                    "total_resources_examined": int
                },
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
        # Search for "my-app" - tries basic first, then exhaustive if needed
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

    # Prepare search pattern - support regex if query contains regex characters
    # If query looks like regex (contains special chars), use it as-is, otherwise escape it
    query_is_regex = any(char in query for char in ['*', '+', '?', '^', '$', '[', ']', '(', ')', '{', '}', '|', '.'])

    if query_is_regex:
        try:
            if case_sensitive:
                pattern = re.compile(query)
            else:
                pattern = re.compile(query, re.IGNORECASE)
        except re.error:
            # If regex is invalid, fall back to literal search
            if case_sensitive:
                pattern = re.compile(re.escape(query))
            else:
                pattern = re.compile(re.escape(query), re.IGNORECASE)
    else:
        # Literal search with substring matching
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

    resources_searched = {
        "applications": 0,
        "projects": 0,
        "applicationsets": 0,
        "clusters": 0
    }

    # Track which resource types required exhaustive search
    exhaustive_performed = False

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

    async def fetch_all_pages(list_func, resource_type: str, max_pages: int = None):
        """Fetch all pages of a resource type (always exhaustive search)."""
        all_items = []
        page = 1
        page_size = 100  # Use max page size for efficiency

        while True:
            try:
                # All list functions have the same signature: summary_only, page, page_size
                response = await list_func(summary_only=True, page=page, page_size=page_size)

                if "error" in response:
                    logger.warning(f"Error fetching {resource_type} page {page}: {response.get('error')}")
                    break

                items = response.get("items", [])
                if not items:
                    break

                all_items.extend(items)
                resources_searched[resource_type] += len(items)

                pagination = response.get("pagination", {})
                if not pagination.get("has_next", False):
                    break

                page += 1
                if max_pages and page > max_pages:
                    break

            except Exception as e:
                logger.error(f"Error fetching {resource_type} page {page}: {e}")
                break

        return all_items

    # Search applications - try basic search first, then exhaustive if needed
    if "applications" in resource_types:
        # Basic search: first page only
        apps_response = await list_applications(summary_only=True, page=1, page_size=100)
        all_apps = apps_response.get("items", [])
        resources_searched["applications"] = len(all_apps)

        # Filter basic results
        basic_matches = []
        for app in all_apps:
            if (matches_pattern(app.get("name", "")) or
                matches_pattern(app.get("namespace", "")) or
                matches_pattern(app.get("project", "")) or
                matches_pattern(app.get("repo", "")) or
                matches_pattern(app.get("path", "")) or
                matches_pattern(app.get("sync_status", "")) or
                matches_pattern(app.get("health_status", ""))):
                # Add ArgoCD link using common helper
                app_with_link = app.copy() if isinstance(app, dict) else app
                if isinstance(app_with_link, dict):
                    _add_argocd_link_to_app(app_with_link)
                basic_matches.append(app_with_link)

        # If basic search found results, use them. Otherwise do exhaustive search
        if basic_matches:
            results["applications"] = basic_matches
            logger.info(f"Basic search found {len(basic_matches)} matching applications")
        else:
            # Exhaustive search: fetch all pages
            logger.info("Basic search returned 0 results, performing exhaustive search...")
            exhaustive_performed = True
            all_apps = await fetch_all_pages(list_applications, "applications")
            logger.info(f"Exhaustive search: Fetched {len(all_apps)} applications")

            # Search through all apps
            for app in all_apps:
                if (matches_pattern(app.get("name", "")) or
                    matches_pattern(app.get("namespace", "")) or
                    matches_pattern(app.get("project", "")) or
                    matches_pattern(app.get("repo", "")) or
                    matches_pattern(app.get("path", "")) or
                    matches_pattern(app.get("sync_status", "")) or
                    matches_pattern(app.get("health_status", ""))):
                    # Add ArgoCD link using common helper
                    app_with_link = app.copy() if isinstance(app, dict) else app
                    if isinstance(app_with_link, dict):
                        _add_argocd_link_to_app(app_with_link)
                    results["applications"].append(app_with_link)

    # Search projects - try basic search first, then exhaustive if needed
    if "projects" in resource_types:
        # Basic search: first page only
        projects_response = await project_list(summary_only=True, page=1, page_size=100)
        all_projects = projects_response.get("items", [])
        resources_searched["projects"] = len(all_projects)

        # Filter basic results
        basic_matches = []
        for project in all_projects:
            if (matches_pattern(project.get("name", "")) or
                matches_pattern(project.get("description", "")) or
                matches_dict({"repos": project.get("source_repos", [])})):
                basic_matches.append(project)

        # If basic search found results, use them. Otherwise do exhaustive search
        if basic_matches:
            results["projects"] = basic_matches
            logger.info(f"Basic search found {len(basic_matches)} matching projects")
        else:
            # Exhaustive search: fetch all pages
            logger.info("Basic search returned 0 results, performing exhaustive search...")
            exhaustive_performed = True
            all_projects = await fetch_all_pages(project_list, "projects")
            logger.info(f"Exhaustive search: Fetched {len(all_projects)} projects")

            # Search through all projects
            for project in all_projects:
                if (matches_pattern(project.get("name", "")) or
                    matches_pattern(project.get("description", "")) or
                    matches_dict({"repos": project.get("source_repos", [])})):
                    results["projects"].append(project)

    # Search applicationsets - try basic search first, then exhaustive if needed
    if "applicationsets" in resource_types:
        # Basic search: first page only
        appsets_response = await applicationset_list(summary_only=True, page=1, page_size=100)
        all_appsets = appsets_response.get("items", [])
        resources_searched["applicationsets"] = len(all_appsets)

        # Filter basic results
        basic_matches = []
        for appset in all_appsets:
            if (matches_pattern(appset.get("name", "")) or
                matches_pattern(appset.get("namespace", "")) or
                matches_pattern(appset.get("template_name", "")) or
                matches_pattern(appset.get("template_project", "")) or
                matches_pattern(appset.get("template_repo", "")) or
                matches_pattern(appset.get("template_path", ""))):
                basic_matches.append(appset)

        # If basic search found results, use them. Otherwise do exhaustive search
        if basic_matches:
            results["applicationsets"] = basic_matches
            logger.info(f"Basic search found {len(basic_matches)} matching applicationsets")
        else:
            # Exhaustive search: fetch all pages
            logger.info("Basic search returned 0 results, performing exhaustive search...")
            exhaustive_performed = True
            all_appsets = await fetch_all_pages(applicationset_list, "applicationsets")
            logger.info(f"Exhaustive search: Fetched {len(all_appsets)} applicationsets")

            # Search through all applicationsets
            for appset in all_appsets:
                if (matches_pattern(appset.get("name", "")) or
                    matches_pattern(appset.get("namespace", "")) or
                    matches_pattern(appset.get("template_name", "")) or
                    matches_pattern(appset.get("template_project", "")) or
                    matches_pattern(appset.get("template_repo", "")) or
                    matches_pattern(appset.get("template_path", ""))):
                    results["applicationsets"].append(appset)

    # Search clusters - try basic search first, then exhaustive if needed
    if "clusters" in resource_types:
        # Basic search: first page only
        clusters_response = await cluster_service__list(summary_only=True, page=1, page_size=100)
        all_clusters = clusters_response.get("items", [])
        resources_searched["clusters"] = len(all_clusters)

        # Filter basic results
        basic_matches = []
        for cluster in all_clusters:
            if (matches_pattern(cluster.get("name", "")) or
                matches_pattern(cluster.get("server", "")) or
                matches_pattern(cluster.get("project", "")) or
                matches_dict(cluster.get("labels", {})) or
                matches_dict(cluster.get("annotations", {}))):
                basic_matches.append(cluster)

        # If basic search found results, use them. Otherwise do exhaustive search
        if basic_matches:
            results["clusters"] = basic_matches
            logger.info(f"Basic search found {len(basic_matches)} matching clusters")
        else:
            # Exhaustive search: fetch all pages
            logger.info("Basic search returned 0 results, performing exhaustive search...")
            exhaustive_performed = True
            all_clusters = await fetch_all_pages(cluster_service__list, "clusters")
            logger.info(f"Exhaustive search: Fetched {len(all_clusters)} clusters")

            # Search through all clusters
            for cluster in all_clusters:
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

    # exhaustive_performed flag is set during search if any resource type required exhaustive search

    # Build progress information
    total_searched = sum(resources_searched.values())
    progress_parts = []
    if resources_searched.get("applications", 0) > 0:
        progress_parts.append(f"{resources_searched['applications']} applications")
    if resources_searched.get("projects", 0) > 0:
        progress_parts.append(f"{resources_searched['projects']} projects")
    if resources_searched.get("applicationsets", 0) > 0:
        progress_parts.append(f"{resources_searched['applicationsets']} applicationsets")
    if resources_searched.get("clusters", 0) > 0:
        progress_parts.append(f"{resources_searched['clusters']} clusters")

    if exhaustive_performed:
        progress_message = f"Exhaustive search completed. Examined {total_searched} total resources"
        if progress_parts:
            progress_message += f" ({', '.join(progress_parts)})"
        user_message = None  # No message needed for exhaustive search
    else:
        progress_message = f"Basic search completed. Examined {total_searched} total resources"
        if progress_parts:
            progress_message += f" ({', '.join(progress_parts)})"
        # Add user-facing message for basic search
        user_message = "Quick search for ArgoCD resources is done. If you would like to do an enhanced search for all resources, please ask."

    # Add ArgoCD base URL to response
    argocd_base_url = _get_argocd_base_url()

    response = {
        "query": query,
        "case_sensitive": case_sensitive,
        "exhaustive_search": exhaustive_performed,
        "searched_resource_types": resource_types,
        "results": paginated_by_type,
        "total_matches": total_matches,
        "resources_searched": resources_searched,
        "argocd_base_url": argocd_base_url,
        "progress": {
            "status": "completed",
            "message": progress_message,
            "total_resources_examined": total_searched
        },
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

    # Add user message if basic search was performed
    if user_message:
        response["user_message"] = user_message

    return response




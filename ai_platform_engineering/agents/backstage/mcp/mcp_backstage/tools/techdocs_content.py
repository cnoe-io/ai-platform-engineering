"""Tools for reading TechDocs content"""

import logging
from typing import Dict, Any, Optional
import yaml

from mcp_backstage.api.client import (
    make_api_request,
)

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_techdocs_page(
    kind: str,
    namespace: str,
    name: str,
    path: str = "index.html",
) -> Dict[str, Any]:
    """
    Retrieves a specific TechDocs page content for an entity.

    Args:
        kind (str): The kind of the entity (e.g., 'component', 'api', 'system')
        namespace (str): The namespace of the entity (defaults to 'default' if not specified)
        name (str): The name of the entity
        path (str, optional): The path to the documentation page (e.g., 'index.html', 'getting-started/index.html'). Defaults to 'index.html'

    Returns:
        Dict[str, Any]: The documentation page content or error information

    Raises:
        Exception: If the API request fails or returns an error

    Example paths:
        - 'index.html' - Main documentation page
        - 'getting-started/index.html' - Getting started guide
        - 'api/index.html' - API documentation
        - 'architecture/index.html' - Architecture documentation
    """
    logger.debug(f"Getting TechDocs page for {kind}/{namespace}/{name} at path: {path}")
    
    # Use 'default' namespace if not provided
    namespace = namespace or "default"
    
    # Ensure path doesn't start with /
    path = path.lstrip('/')
    
    success, response = await make_api_request(
        f"/api/techdocs/static/docs/{namespace}/{kind}/{name}/{path}",
        method="GET",
        raw_response=True  # Get raw HTML content
    )
    
    if not success:
        error_msg = response.get("error", "Failed to retrieve TechDocs page") if isinstance(response, dict) else str(response)
        logger.error(f"Request failed: {error_msg}")
        return {
            "error": error_msg,
            "entity": f"{kind}/{namespace}/{name}",
            "path": path
        }
    
    logger.info(f"Successfully retrieved TechDocs page for {kind}/{namespace}/{name}")
    
    # Return structured response with content
    return {
        "entity": f"{kind}/{namespace}/{name}",
        "path": path,
        "content": response if isinstance(response, str) else str(response),
        "content_type": "html"
    }


async def get_techdocs_mkdocs_yml(
    kind: str,
    namespace: str,
    name: str,
) -> Dict[str, Any]:
    """
    Retrieves the mkdocs.yml configuration for an entity's TechDocs, which contains the documentation structure and navigation.

    Args:
        kind (str): The kind of the entity (e.g., 'component', 'api', 'system')
        namespace (str): The namespace of the entity (defaults to 'default' if not specified)
        name (str): The name of the entity

    Returns:
        Dict[str, Any]: The mkdocs.yml content parsed as JSON, including navigation structure

    Raises:
        Exception: If the API request fails or returns an error

    Example Response:
        {
            "site_name": "My Service Documentation",
            "nav": [
                {"Home": "index.md"},
                {"Getting Started": "getting-started.md"},
                {"API Reference": "api/index.md"}
            ],
            "site_description": "Technical documentation for My Service"
        }
    """
    logger.debug(f"Getting mkdocs.yml for {kind}/{namespace}/{name}")
    
    # Use 'default' namespace if not provided
    namespace = namespace or "default"
    
    success, response = await make_api_request(
        f"/api/techdocs/static/docs/{namespace}/{kind}/{name}/mkdocs.yml",
        method="GET",
        raw_response=True
    )
    
    if not success:
        # Try alternate path for mkdocs.json (some versions use JSON instead of YAML)
        success, response = await make_api_request(
            f"/api/techdocs/static/docs/{namespace}/{kind}/{name}/mkdocs.json",
            method="GET"
        )
        
        if not success:
            error_msg = response.get("error", "Failed to retrieve mkdocs configuration") if isinstance(response, dict) else str(response)
            logger.error(f"Request failed: {error_msg}")
            return {
                "error": error_msg,
                "entity": f"{kind}/{namespace}/{name}"
            }
    
    logger.info(f"Successfully retrieved mkdocs configuration for {kind}/{namespace}/{name}")
    
    # Parse the response based on type
    if isinstance(response, str):
        # Try to parse as YAML or return as raw
        try:
            parsed = yaml.safe_load(response)
            return {
                "entity": f"{kind}/{namespace}/{name}",
                "config": parsed,
                "format": "yaml"
            }
        except yaml.YAMLError:
            logger.warning(f"Could not parse mkdocs.yml for {kind}/{namespace}/{name}. Returning raw content.")
            return {
                "entity": f"{kind}/{namespace}/{name}",
                "config_raw": response,
                "format": "raw"
            }
    else:
        # Already JSON
        return {
            "entity": f"{kind}/{namespace}/{name}",
            "config": response,
            "format": "json"
        }


async def search_techdocs(
    query: str,
    filters: Optional[Dict[str, str]] = None,
    limit: int = 25,
) -> Dict[str, Any]:
    """
    Searches across all TechDocs content for the given query.

    Args:
        query (str): The search query string
        filters (Dict[str, str], optional): Additional filters like kind, namespace, etc.
        limit (int, optional): Maximum number of results to return. Defaults to 25

    Returns:
        Dict[str, Any]: Search results with matching documentation pages

    Raises:
        Exception: If the API request fails or returns an error

    Note: This endpoint might not be available in all Backstage instances.
    """
    logger.debug(f"Searching TechDocs for query: {query}")
    
    params = {
        "term": query,
        "limit": limit
    }
    
    if filters:
        params.update(filters)
    
    success, response = await make_api_request(
        "/api/search/query",
        method="GET",
        params=params
    )
    
    if not success:
        error_msg = response.get("error", "Failed to search TechDocs") if isinstance(response, dict) else str(response)
        logger.error(f"Request failed: {error_msg}")
        return {
            "error": error_msg,
            "query": query
        }
    
    logger.info(f"Successfully searched TechDocs for: {query}")
    
    # Filter for TechDocs results
    if isinstance(response, dict) and "results" in response:
        techdocs_results = [
            result for result in response.get("results", [])
            if result.get("type") == "techdocs" or result.get("location", "").startswith("/docs/")
        ]
        return {
            "query": query,
            "results": techdocs_results,
            "total": len(techdocs_results)
        }
    
    return {
        "query": query,
        "results": response if isinstance(response, list) else [],
        "total": len(response) if isinstance(response, list) else 0
    }
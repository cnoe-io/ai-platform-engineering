"""Tools for TechDocs index and navigation operations"""

import logging
import re
from typing import Dict, Any, List, Optional

from mcp_backstage.api.client import (
    make_api_request,
)

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_techdocs_index(
    kind: str,
    namespace: str,
    name: str,
) -> Dict[str, Any]:
    """
    Retrieves the documentation index/table of contents for an entity's TechDocs.

    Args:
        kind (str): The kind of the entity (e.g., 'component', 'api', 'system')
        namespace (str): The namespace of the entity (defaults to 'default' if not specified)
        name (str): The name of the entity

    Returns:
        Dict[str, Any]: The documentation index including available pages and navigation structure

    Raises:
        Exception: If the API request fails or returns an error

    Example Response:
        {
            "entity": "component/default/my-service",
            "index": {
                "pages": [
                    {"title": "Home", "path": "index.html"},
                    {"title": "Getting Started", "path": "getting-started/index.html"},
                    {"title": "API Reference", "path": "api/index.html"}
                ],
                "sections": [
                    {
                        "title": "Guides",
                        "pages": [
                            {"title": "Installation", "path": "guides/installation.html"},
                            {"title": "Configuration", "path": "guides/configuration.html"}
                        ]
                    }
                ]
            }
        }
    """
    logger.debug(f"Getting TechDocs index for {kind}/{namespace}/{name}")
    
    # Use 'default' namespace if not provided
    namespace = namespace or "default"
    
    # First try to get the search index which contains all pages
    success, response = await make_api_request(
        f"/api/techdocs/static/docs/{namespace}/{kind}/{name}/search/search_index.json",
        method="GET"
    )
    
    if success and isinstance(response, dict):
        # Extract page information from search index
        docs = response.get("docs", [])
        pages = []
        for doc in docs:
            pages.append({
                "title": doc.get("title", "Untitled"),
                "path": doc.get("location", ""),
                "text_preview": doc.get("text", "")[:200] if doc.get("text") else ""
            })
        
        logger.info(f"Successfully retrieved TechDocs index from search index for {kind}/{namespace}/{name}")
        return {
            "entity": f"{kind}/{namespace}/{name}",
            "pages": pages,
            "total_pages": len(pages),
            "source": "search_index"
        }
    
    # Fallback: Try to get the site navigation from the rendered HTML
    success, response = await make_api_request(
        f"/api/techdocs/static/docs/{namespace}/{kind}/{name}/index.html",
        method="GET",
        raw_response=True
    )
    
    if not success:
        error_msg = response.get("error", "Failed to retrieve TechDocs index") if isinstance(response, dict) else str(response)
        logger.error(f"Request failed: {error_msg}")
        return {
            "error": error_msg,
            "entity": f"{kind}/{namespace}/{name}"
        }
    
    # Parse navigation from HTML (basic extraction)
    if isinstance(response, str):
        # Extract links from navigation
        nav_pattern = r'<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>'
        matches = re.findall(nav_pattern, response)
        
        pages = []
        for href, title in matches:
            if href.endswith('.html') and not href.startswith('http'):
                pages.append({
                    "title": title.strip(),
                    "path": href
                })
        
        logger.info(f"Successfully extracted TechDocs index from HTML for {kind}/{namespace}/{name}")
        return {
            "entity": f"{kind}/{namespace}/{name}",
            "pages": pages[:50],  # Limit to first 50 to avoid too much noise
            "total_pages": len(pages),
            "source": "html_extraction"
        }
    
    return {
        "entity": f"{kind}/{namespace}/{name}",
        "pages": [],
        "error": "Could not extract documentation index"
    }


async def list_entities_with_techdocs(
    param_filter: Optional[List[str]] = None,
    param_limit: int = 50,
) -> Dict[str, Any]:
    """
    Lists all entities that have TechDocs documentation available.

    Args:
        param_filter (List[str], optional): Additional filters to apply (e.g., ['kind=component', 'spec.type=service'])
        param_limit (int, optional): Maximum number of entities to return. Defaults to 50

    Returns:
        Dict[str, Any]: List of entities with TechDocs documentation

    Example Response:
        {
            "entities_with_docs": [
                {
                    "name": "my-service",
                    "namespace": "default", 
                    "kind": "Component",
                    "type": "service",
                    "techdocs_ref": "dir:.",
                    "owner": "team-a"
                }
            ],
            "total": 15
        }
    """
    logger.debug("Listing entities with TechDocs")
    
    # Build filter to find entities with TechDocs annotation
    filters = param_filter or []
    # Add TechDocs annotation filter
    filters.append("metadata.annotations.backstage.io/techdocs-ref")
    
    params = {
        "filter": filters,
        "fields": ["metadata.name", "metadata.namespace", "kind", "spec.type", "spec.owner", 
                   "metadata.annotations.backstage.io/techdocs-ref", "metadata.description"],
        "limit": param_limit
    }
    
    success, response = await make_api_request(
        "/api/catalog/entities",
        method="GET",
        params=params
    )
    
    if not success:
        error_msg = response.get("error", "Failed to list entities with TechDocs") if isinstance(response, dict) else str(response)
        logger.error(f"Request failed: {error_msg}")
        return {"error": error_msg}
    
    # Process the response
    entities = response.get("items", []) if isinstance(response, dict) else response
    
    entities_with_docs = []
    for entity in entities:
        metadata = entity.get("metadata", {})
        spec = entity.get("spec", {})
        annotations = metadata.get("annotations", {})
        
        if "backstage.io/techdocs-ref" in annotations:
            entities_with_docs.append({
                "name": metadata.get("name"),
                "namespace": metadata.get("namespace", "default"),
                "kind": entity.get("kind"),
                "type": spec.get("type"),
                "owner": spec.get("owner"),
                "description": metadata.get("description", ""),
                "techdocs_ref": annotations.get("backstage.io/techdocs-ref")
            })
    
    logger.info(f"Found {len(entities_with_docs)} entities with TechDocs")
    
    return {
        "entities_with_docs": entities_with_docs,
        "total": len(entities_with_docs)
    }
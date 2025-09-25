"""Tools for TechDocs metadata operations"""

import logging
from typing import Dict, Any

from mcp_backstage.api.client import (
    make_api_request,
)

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_techdocs_metadata(
    kind: str,
    namespace: str,
    name: str,
) -> Dict[str, Any]:
    """
    Retrieves TechDocs metadata for a specific entity to check if documentation exists and get its build status.

    Args:
        kind (str): The kind of the entity (e.g., 'component', 'api', 'system')
        namespace (str): The namespace of the entity (defaults to 'default' if not specified)
        name (str): The name of the entity

    Returns:
        Dict[str, Any]: The TechDocs metadata including build status, last updated time, and available documentation

    Raises:
        Exception: If the API request fails or returns an error

    Example Response:
        {
            "build": {
                "status": "complete",
                "lastUpdated": "2024-01-15T10:30:00Z"
            },
            "site_name": "My Service Documentation",
            "site_description": "Technical documentation for My Service"
        }
    """
    logger.debug(f"Getting TechDocs metadata for {kind}/{namespace}/{name}")
    
    # Use 'default' namespace if not provided
    namespace = namespace or "default"
    
    success, response = await make_api_request(
        f"/api/techdocs/metadata/techdocs/{namespace}/{kind}/{name}",
        method="GET"
    )
    
    if not success:
        error_msg = response.get("error", "Failed to retrieve TechDocs metadata") if isinstance(response, dict) else str(response)
        logger.error(f"Request failed: {error_msg}")
        return {"error": error_msg, "has_docs": False}
    
    logger.info(f"Successfully retrieved TechDocs metadata for {kind}/{namespace}/{name}")
    return {**response, "has_docs": True}


async def get_techdocs_entity_metadata(
    kind: str,
    namespace: str,
    name: str,
) -> Dict[str, Any]:
    """
    Retrieves entity-specific TechDocs metadata, including the documentation reference and build information.

    Args:
        kind (str): The kind of the entity (e.g., 'component', 'api', 'system')
        namespace (str): The namespace of the entity (defaults to 'default' if not specified)
        name (str): The name of the entity

    Returns:
        Dict[str, Any]: Entity metadata related to TechDocs configuration

    Raises:
        Exception: If the API request fails or returns an error

    Example Response:
        {
            "metadata": {
                "uid": "abc123",
                "etag": "xyz789",
                "name": "my-service",
                "namespace": "default",
                "kind": "Component",
                "spec": {
                    "type": "service",
                    "owner": "team-a"
                }
            },
            "apiVersion": "backstage.io/v1alpha1",
            "kind": "Component",
            "spec": {
                "type": "service"
            }
        }
    """
    logger.debug(f"Getting entity TechDocs metadata for {kind}/{namespace}/{name}")
    
    # Use 'default' namespace if not provided
    namespace = namespace or "default"
    
    success, response = await make_api_request(
        f"/api/techdocs/metadata/entity/{namespace}/{kind}/{name}",
        method="GET"
    )
    
    if not success:
        error_msg = response.get("error", "Failed to retrieve entity TechDocs metadata") if isinstance(response, dict) else str(response)
        logger.error(f"Request failed: {error_msg}")
        return {"error": error_msg}
    
    logger.info(f"Successfully retrieved entity TechDocs metadata for {kind}/{namespace}/{name}")
    return response
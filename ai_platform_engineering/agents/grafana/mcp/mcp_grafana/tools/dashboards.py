"""Dashboard-related MCP tools."""

import logging
from typing import List, Optional
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from ..client import get_client
from ..models.dashboard import DashboardSearchResult, Dashboard

logger = logging.getLogger(__name__)


def dashboard_tools(mcp: FastMCP) -> None:
    """Register dashboard-related tools."""
    
    @mcp.tool()
    async def search_dashboards(
        query: str = "",
        tag: str = "",
        limit: int = 50
    ) -> List[dict]:
        """
        Search for dashboards in Grafana.
        
        Args:
            query: Search query (searches title and tags)
            tag: Filter by specific tag
            limit: Maximum number of results to return (default: 50)
            
        Returns:
            List of dashboard search results
        """
        try:
            async with get_client() as client:
                result = await client.search_dashboards(query=query, tag=tag, limit=limit)
                
                # Filter for dashboards only
                dashboards = [item for item in result if item.get("type") == "dash-db"]
                
                return [
                    {
                        "id": d.get("id"),
                        "uid": d.get("uid"),
                        "title": d.get("title"),
                        "uri": d.get("uri"),
                        "url": d.get("url"),
                        "slug": d.get("slug"),
                        "tags": d.get("tags", []),
                        "isStarred": d.get("isStarred", False),
                        "folderId": d.get("folderId"),
                        "folderUid": d.get("folderUid"),
                        "folderTitle": d.get("folderTitle"),
                        "folderUrl": d.get("folderUrl"),
                    }
                    for d in dashboards
                ]
        except Exception as e:
            logger.error(f"Error searching dashboards: {e}")
            raise
    
    @mcp.tool()
    async def get_dashboard(uid: str) -> dict:
        """
        Get a specific dashboard by UID.
        
        Args:
            uid: Dashboard UID
            
        Returns:
            Dashboard details
        """
        try:
            async with get_client() as client:
                result = await client.get_dashboard(uid)
                dashboard = result.get("dashboard", {})
                meta = result.get("meta", {})
                
                return {
                    "id": dashboard.get("id"),
                    "uid": dashboard.get("uid"),
                    "title": dashboard.get("title"),
                    "description": dashboard.get("description"),
                    "tags": dashboard.get("tags", []),
                    "timezone": dashboard.get("timezone"),
                    "refresh": dashboard.get("refresh"),
                    "time": dashboard.get("time", {}),
                    "panels": dashboard.get("panels", []),
                    "links": dashboard.get("links", []),
                    "created": meta.get("created"),
                    "createdBy": meta.get("createdBy"),
                    "updated": meta.get("updated"),
                    "updatedBy": meta.get("updatedBy"),
                    "folderId": meta.get("folderId"),
                    "folderTitle": meta.get("folderTitle"),
                    "folderUrl": meta.get("folderUrl"),
                    "url": meta.get("url"),
                }
        except Exception as e:
            logger.error(f"Error getting dashboard {uid}: {e}")
            raise
    
    @mcp.tool()
    async def get_dashboard_by_id(dashboard_id: int) -> dict:
        """
        Get a specific dashboard by ID.
        
        Args:
            dashboard_id: Dashboard ID
            
        Returns:
            Dashboard details
        """
        try:
            async with get_client() as client:
                result = await client.get_dashboard_by_id(dashboard_id)
                dashboard = result.get("dashboard", {})
                meta = result.get("meta", {})
                
                return {
                    "id": dashboard.get("id"),
                    "uid": dashboard.get("uid"),
                    "title": dashboard.get("title"),
                    "description": dashboard.get("description"),
                    "tags": dashboard.get("tags", []),
                    "timezone": dashboard.get("timezone"),
                    "refresh": dashboard.get("refresh"),
                    "time": dashboard.get("time", {}),
                    "panels": dashboard.get("panels", []),
                    "links": dashboard.get("links", []),
                    "created": meta.get("created"),
                    "createdBy": meta.get("createdBy"),
                    "updated": meta.get("updated"),
                    "updatedBy": meta.get("updatedBy"),
                    "folderId": meta.get("folderId"),
                    "folderTitle": meta.get("folderTitle"),
                    "folderUrl": meta.get("folderUrl"),
                    "url": meta.get("url"),
                }
        except Exception as e:
            logger.error(f"Error getting dashboard {dashboard_id}: {e}")
            raise
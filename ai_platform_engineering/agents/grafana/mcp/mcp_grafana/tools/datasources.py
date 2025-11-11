"""Datasource-related MCP tools."""

import logging
from typing import List, Optional
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from ..client import get_client
from ..models.datasource import Datasource

logger = logging.getLogger(__name__)


def datasource_tools(mcp: FastMCP) -> None:
    """Register datasource-related tools."""
    
    @mcp.tool()
    async def get_datasources() -> List[dict]:
        """
        Get all datasources from Grafana.
        
        Returns:
            List of datasources
        """
        try:
            async with get_client() as client:
                result = await client.get_datasources()
                
                return [
                    {
                        "id": ds.get("id"),
                        "uid": ds.get("uid"),
                        "orgId": ds.get("orgId"),
                        "name": ds.get("name"),
                        "type": ds.get("type"),
                        "typeName": ds.get("typeName"),
                        "typeLogoUrl": ds.get("typeLogoUrl"),
                        "access": ds.get("access"),
                        "url": ds.get("url"),
                        "database": ds.get("database"),
                        "basicAuth": ds.get("basicAuth", False),
                        "basicAuthUser": ds.get("basicAuthUser"),
                        "withCredentials": ds.get("withCredentials", False),
                        "isDefault": ds.get("isDefault", False),
                        "jsonData": ds.get("jsonData", {}),
                        "version": ds.get("version", 0),
                        "readOnly": ds.get("readOnly", False),
                        "editable": ds.get("editable", True),
                        "created": ds.get("created"),
                        "updated": ds.get("updated"),
                        "updatedBy": ds.get("updatedBy"),
                        "secureJsonFields": ds.get("secureJsonFields", {}),
                        "health": ds.get("health"),
                        "healthError": ds.get("healthError"),
                    }
                    for ds in result
                ]
        except Exception as e:
            logger.error(f"Error getting datasources: {e}")
            raise
    
    @mcp.tool()
    async def get_datasource(datasource_id: int) -> dict:
        """
        Get a specific datasource by ID.
        
        Args:
            datasource_id: Datasource ID
            
        Returns:
            Datasource details
        """
        try:
            async with get_client() as client:
                result = await client.get_datasource(datasource_id)
                
                return {
                    "id": result.get("id"),
                    "uid": result.get("uid"),
                    "orgId": result.get("orgId"),
                    "name": result.get("name"),
                    "type": result.get("type"),
                    "typeName": result.get("typeName"),
                    "typeLogoUrl": result.get("typeLogoUrl"),
                    "access": result.get("access"),
                    "url": result.get("url"),
                    "database": result.get("database"),
                    "basicAuth": result.get("basicAuth", False),
                    "basicAuthUser": result.get("basicAuthUser"),
                    "withCredentials": result.get("withCredentials", False),
                    "isDefault": result.get("isDefault", False),
                    "jsonData": result.get("jsonData", {}),
                    "version": result.get("version", 0),
                    "readOnly": result.get("readOnly", False),
                    "editable": result.get("editable", True),
                    "created": result.get("created"),
                    "updated": result.get("updated"),
                    "updatedBy": result.get("updatedBy"),
                    "secureJsonFields": result.get("secureJsonFields", {}),
                    "health": result.get("health"),
                    "healthError": result.get("healthError"),
                }
        except Exception as e:
            logger.error(f"Error getting datasource {datasource_id}: {e}")
            raise
    
    @mcp.tool()
    async def query_datasource(
        datasource_id: int,
        query: str,
        from_time: str = "now-1h",
        to_time: str = "now"
    ) -> dict:
        """
        Query a datasource (e.g., Prometheus).
        
        Args:
            datasource_id: Datasource ID
            query: Query string (e.g., PromQL expression)
            from_time: Start time (default: "now-1h")
            to_time: End time (default: "now")
            
        Returns:
            Query results
        """
        try:
            async with get_client() as client:
                result = await client.query_datasource(
                    datasource_id=datasource_id,
                    query=query,
                    from_time=from_time,
                    to_time=to_time
                )
                
                return result
        except Exception as e:
            logger.error(f"Error querying datasource {datasource_id}: {e}")
            raise
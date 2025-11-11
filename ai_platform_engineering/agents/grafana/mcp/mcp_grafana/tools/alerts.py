"""Alert-related MCP tools."""

import logging
from typing import List, Optional
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from ..client import get_client
from ..models.alert import Alert, AlertRule

logger = logging.getLogger(__name__)


def alert_tools(mcp: FastMCP) -> None:
    """Register alert-related tools."""
    
    @mcp.tool()
    async def get_alerts(
        state: str = "",
        limit: int = 50
    ) -> List[dict]:
        """
        Get alerts from Grafana.
        
        Args:
            state: Filter by alert state (e.g., "alerting", "ok", "no_data", "pending")
            limit: Maximum number of results to return (default: 50)
            
        Returns:
            List of alerts
        """
        try:
            async with get_client() as client:
                result = await client.get_alerts(state=state, limit=limit)
                
                return [
                    {
                        "id": alert.get("id"),
                        "dashboardId": alert.get("dashboardId"),
                        "dashboardUid": alert.get("dashboardUid"),
                        "dashboardSlug": alert.get("dashboardSlug"),
                        "dashboardTitle": alert.get("dashboardTitle"),
                        "panelId": alert.get("panelId"),
                        "name": alert.get("name"),
                        "state": alert.get("state"),
                        "newStateDate": alert.get("newStateDate"),
                        "prevStateDate": alert.get("prevStateDate"),
                        "evalDate": alert.get("evalDate"),
                        "evalData": alert.get("evalData"),
                        "executionError": alert.get("executionError"),
                        "url": alert.get("url"),
                    }
                    for alert in result
                ]
        except Exception as e:
            logger.error(f"Error getting alerts: {e}")
            raise
    
    @mcp.tool()
    async def get_alert_rules(limit: int = 50) -> List[dict]:
        """
        Get alert rules from Grafana.
        
        Args:
            limit: Maximum number of results to return (default: 50)
            
        Returns:
            List of alert rules
        """
        try:
            async with get_client() as client:
                result = await client.get_alert_rules(limit=limit)
                
                # Flatten the nested structure
                rules = []
                for namespace, groups in result.items():
                    for group_name, group_data in groups.items():
                        for rule in group_data.get("rules", []):
                            rules.append({
                                "id": rule.get("id"),
                                "uid": rule.get("uid"),
                                "title": rule.get("title"),
                                "condition": rule.get("condition"),
                                "data": rule.get("data", []),
                                "intervalSeconds": rule.get("intervalSeconds"),
                                "maxDataPoints": rule.get("maxDataPoints"),
                                "noDataState": rule.get("noDataState"),
                                "execErrState": rule.get("execErrState"),
                                "forDuration": rule.get("forDuration"),
                                "annotations": rule.get("annotations", {}),
                                "labels": rule.get("labels", {}),
                                "isPaused": rule.get("isPaused", False),
                                "notificationSettings": rule.get("notificationSettings"),
                                "created": rule.get("created"),
                                "updated": rule.get("updated"),
                                "updatedBy": rule.get("updatedBy"),
                                "provenance": rule.get("provenance"),
                                "folderUid": rule.get("folderUid"),
                                "folderTitle": rule.get("folderTitle"),
                                "namespace": namespace,
                                "group": group_name,
                            })
                
                return rules[:limit]
        except Exception as e:
            logger.error(f"Error getting alert rules: {e}")
            raise
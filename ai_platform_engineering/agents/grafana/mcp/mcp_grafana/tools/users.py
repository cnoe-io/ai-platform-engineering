"""User and team-related MCP tools."""

import logging
from typing import List, Optional
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from ..client import get_client
from ..models.user import User, Team

logger = logging.getLogger(__name__)


def user_tools(mcp: FastMCP) -> None:
    """Register user and team-related tools."""
    
    @mcp.tool()
    async def get_users(limit: int = 50) -> List[dict]:
        """
        Get users from Grafana.
        
        Args:
            limit: Maximum number of results to return (default: 50)
            
        Returns:
            List of users
        """
        try:
            async with get_client() as client:
                result = await client.get_users(limit=limit)
                
                return [
                    {
                        "id": user.get("id"),
                        "login": user.get("login"),
                        "email": user.get("email"),
                        "name": user.get("name"),
                        "avatarUrl": user.get("avatarUrl"),
                        "isAdmin": user.get("isAdmin", False),
                        "isDisabled": user.get("isDisabled", False),
                        "lastSeenAt": user.get("lastSeenAt"),
                        "lastSeenAtAge": user.get("lastSeenAtAge"),
                        "authLabels": user.get("authLabels", []),
                        "isGrafanaAdmin": user.get("isGrafanaAdmin", False),
                        "isExternal": user.get("isExternal", False),
                        "isGrafanaUser": user.get("isGrafanaUser", True),
                        "authModule": user.get("authModule"),
                        "teams": user.get("teams", []),
                        "orgs": user.get("orgs", []),
                    }
                    for user in result
                ]
        except Exception as e:
            logger.error(f"Error getting users: {e}")
            raise
    
    @mcp.tool()
    async def get_teams(limit: int = 50) -> List[dict]:
        """
        Get teams from Grafana.
        
        Args:
            limit: Maximum number of results to return (default: 50)
            
        Returns:
            List of teams
        """
        try:
            async with get_client() as client:
                result = await client.get_teams(limit=limit)
                teams = result.get("teams", [])
                
                return [
                    {
                        "id": team.get("id"),
                        "orgId": team.get("orgId"),
                        "name": team.get("name"),
                        "email": team.get("email"),
                        "avatarUrl": team.get("avatarUrl"),
                        "memberCount": team.get("memberCount", 0),
                        "permission": team.get("permission", 0),
                        "accessControl": team.get("accessControl"),
                        "created": team.get("created"),
                        "updated": team.get("updated"),
                        "members": team.get("members", []),
                    }
                    for team in teams
                ]
        except Exception as e:
            logger.error(f"Error getting teams: {e}")
            raise
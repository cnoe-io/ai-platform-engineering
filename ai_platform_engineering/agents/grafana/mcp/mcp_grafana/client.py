"""
Grafana API client for MCP server.
"""

import os
import logging
from typing import Dict, Any, Optional
import httpx
from httpx import HTTPError

logger = logging.getLogger(__name__)


class GrafanaClient:
    """Client for interacting with Grafana API."""
    
    def __init__(self):
        self.api_key = os.getenv("GRAFANA_API_KEY")
        self.base_url = os.getenv("GRAFANA_URL")
        
        if not self.api_key:
            raise ValueError("GRAFANA_API_KEY environment variable is required")
        if not self.base_url:
            raise ValueError("GRAFANA_URL environment variable is required")
        
        # Ensure base URL doesn't end with slash
        self.base_url = self.base_url.rstrip('/')
        
        # Set up HTTP client with authentication
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()
    
    async def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Make a GET request to the Grafana API."""
        try:
            response = await self.client.get(endpoint, params=params)
            response.raise_for_status()
            return response.json()
        except HTTPError as e:
            logger.error(f"Grafana API GET error for {endpoint}: {e}")
            raise
    
    async def post(self, endpoint: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Make a POST request to the Grafana API."""
        try:
            response = await self.client.post(endpoint, json=data)
            response.raise_for_status()
            return response.json()
        except HTTPError as e:
            logger.error(f"Grafana API POST error for {endpoint}: {e}")
            raise
    
    async def put(self, endpoint: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Make a PUT request to the Grafana API."""
        try:
            response = await self.client.put(endpoint, json=data)
            response.raise_for_status()
            return response.json()
        except HTTPError as e:
            logger.error(f"Grafana API PUT error for {endpoint}: {e}")
            raise
    
    async def delete(self, endpoint: str) -> Dict[str, Any]:
        """Make a DELETE request to the Grafana API."""
        try:
            response = await self.client.delete(endpoint)
            response.raise_for_status()
            return response.json() if response.content else {}
        except HTTPError as e:
            logger.error(f"Grafana API DELETE error for {endpoint}: {e}")
            raise
    
    # Dashboard methods
    async def search_dashboards(self, query: str = "", tag: str = "", limit: int = 50) -> Dict[str, Any]:
        """Search for dashboards."""
        params = {"query": query, "limit": limit}
        if tag:
            params["tag"] = tag
        return await self.get("/api/search", params=params)
    
    async def get_dashboard(self, uid: str) -> Dict[str, Any]:
        """Get a specific dashboard by UID."""
        return await self.get(f"/api/dashboards/uid/{uid}")
    
    async def get_dashboard_by_id(self, dashboard_id: int) -> Dict[str, Any]:
        """Get a specific dashboard by ID."""
        return await self.get(f"/api/dashboards/id/{dashboard_id}")
    
    # Alerting methods
    async def get_alerts(self, state: str = "", limit: int = 50) -> Dict[str, Any]:
        """Get alerts."""
        params = {"limit": limit}
        if state:
            params["state"] = state
        return await self.get("/api/alerts", params=params)
    
    async def get_alert_rules(self, limit: int = 50) -> Dict[str, Any]:
        """Get alert rules."""
        params = {"limit": limit}
        return await self.get("/api/ruler/grafana/api/v1/rules", params=params)
    
    # Datasource methods
    async def get_datasources(self) -> Dict[str, Any]:
        """Get all datasources."""
        return await self.get("/api/datasources")
    
    async def get_datasource(self, datasource_id: int) -> Dict[str, Any]:
        """Get a specific datasource."""
        return await self.get(f"/api/datasources/{datasource_id}")
    
    # Query methods
    async def query_datasource(self, datasource_id: int, query: str, from_time: str, to_time: str) -> Dict[str, Any]:
        """Query a datasource."""
        data = {
            "queries": [{
                "refId": "A",
                "datasource": {"type": "prometheus", "uid": str(datasource_id)},
                "expr": query,
                "interval": "",
                "legendFormat": "",
                "range": True,
                "instant": False
            }],
            "from": from_time,
            "to": to_time
        }
        return await self.post(f"/api/ds/query", data=data)
    
    # User and team methods
    async def get_users(self, limit: int = 50) -> Dict[str, Any]:
        """Get users."""
        params = {"limit": limit}
        return await self.get("/api/users", params=params)
    
    async def get_teams(self, limit: int = 50) -> Dict[str, Any]:
        """Get teams."""
        params = {"limit": limit}
        return await self.get("/api/teams/search", params=params)


def get_client() -> GrafanaClient:
    """Get a Grafana client instance."""
    return GrafanaClient()
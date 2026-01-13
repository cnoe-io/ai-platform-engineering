#!/usr/bin/env python3
"""
Integration tests for single-graph mode evaluations.

These tests send prompts from multi_agent.yaml to the running server
and verify that responses are received successfully.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
import logging

import httpx
import pytest
import yaml

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Server configuration
PLATFORM_ENGINEER_URL = os.getenv("PLATFORM_ENGINEER_URL", "http://localhost:8002")
REQUEST_TIMEOUT = float(os.getenv("EVAL_REQUEST_TIMEOUT", "120.0"))


class TestSingleGraphEvaluations:
    """Integration tests for single-graph mode."""
    
    @classmethod
    def setup_class(cls):
        """Load the dataset and check server connectivity."""
        dataset_path = Path(__file__).parent.parent / "datasets" / "multi_agent.yaml"
        
        with open(dataset_path, 'r') as f:
            cls.dataset = yaml.safe_load(f)
        
        cls.prompts = cls.dataset.get('prompts', [])
        logger.info(f"Loaded {len(cls.prompts)} prompts from dataset")
    
    @pytest.fixture(autouse=True)
    async def check_server(self):
        """Check that server is running before each test."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(f"{PLATFORM_ENGINEER_URL}/.well-known/agent-card.json")
                response.raise_for_status()
                logger.info(f"Server is available at {PLATFORM_ENGINEER_URL}")
            except Exception as e:
                pytest.skip(f"Server not available at {PLATFORM_ENGINEER_URL}: {e}")
    
    async def send_message(self, prompt: str) -> dict:
        """Send a message to the platform engineer and collect response."""
        import uuid
        
        message_id = str(uuid.uuid4())
        request_id = str(uuid.uuid4())
        
        payload = {
            "jsonrpc": "2.0",
            "method": "message/stream",
            "params": {
                "message": {
                    "role": "user",
                    "parts": [{"kind": "text", "text": prompt}],
                    "messageId": message_id
                }
            },
            "id": request_id
        }
        
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response_text = ""
            events_received = 0
            status = None
            
            async with client.stream("POST", PLATFORM_ENGINEER_URL, json=payload) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    
                    try:
                        data = json.loads(line[6:])
                        result = data.get("result", {})
                        kind = result.get("kind")
                        events_received += 1
                        
                        if kind == "artifact-update":
                            artifact = result.get("artifact", {})
                            parts = artifact.get("parts", [])
                            for part in parts:
                                if part.get("kind") == "text":
                                    response_text += part.get("text", "")
                        
                        elif kind == "status-update":
                            status = result.get("status", {}).get("state")
                            if status == "completed":
                                break
                    
                    except json.JSONDecodeError:
                        continue
            
            return {
                "response_text": response_text,
                "events_received": events_received,
                "status": status,
                "prompt": prompt
            }
    
    # =========================================================================
    # ARGOCD AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_argocd_version(self):
        """Test ArgoCD version query."""
        result = await self.send_message("Show me the ArgoCD version")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        assert len(result["response_text"]) > 0, "Empty response"
        logger.info(f"✅ ArgoCD version test passed. Response length: {len(result['response_text'])}")
    
    @pytest.mark.asyncio
    async def test_argocd_list_applications(self):
        """Test ArgoCD list applications."""
        result = await self.send_message("List all ArgoCD applications")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ ArgoCD list apps test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # JIRA AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_jira_list_projects(self):
        """Test Jira list projects."""
        result = await self.send_message("List all Jira projects I have access to")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ Jira list projects test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # GITHUB AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_github_list_repos(self):
        """Test GitHub list repositories."""
        result = await self.send_message("List repositories in cnoe-io organization")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ GitHub list repos test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # PAGERDUTY AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_pagerduty_list_incidents(self):
        """Test PagerDuty list incidents."""
        result = await self.send_message("Show current open incidents in PagerDuty")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ PagerDuty list incidents test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # CONFLUENCE AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_confluence_list_spaces(self):
        """Test Confluence list spaces."""
        result = await self.send_message("List all Confluence spaces")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ Confluence list spaces test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # SPLUNK AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_splunk_list_indexes(self):
        """Test Splunk list indexes."""
        result = await self.send_message("List available Splunk indexes")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ Splunk list indexes test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # KOMODOR AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_komodor_list_services(self):
        """Test Komodor list services."""
        result = await self.send_message("List Kubernetes services in Komodor")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ Komodor list services test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # SLACK AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_slack_list_channels(self):
        """Test Slack list channels."""
        result = await self.send_message("List Slack channels I have access to")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ Slack list channels test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # BACKSTAGE AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_backstage_list_entities(self):
        """Test Backstage list entities."""
        result = await self.send_message("List all entities in Backstage catalog")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ Backstage list entities test passed. Events: {result['events_received']}")
    
    # =========================================================================
    # WEATHER AGENT TESTS
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_weather_current(self):
        """Test Weather current conditions."""
        result = await self.send_message("What's the current weather in San Francisco?")
        
        assert result["status"] == "completed", f"Request did not complete: {result}"
        assert result["events_received"] > 0, "No events received"
        logger.info(f"✅ Weather current test passed. Events: {result['events_received']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

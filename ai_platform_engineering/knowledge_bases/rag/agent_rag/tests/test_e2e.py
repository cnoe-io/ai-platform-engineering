#!/usr/bin/env python3
"""
End-to-End Tests for RAG Agent with A2A Interface

This test suite validates the RAG agent functionality through the A2A protocol,
including document ingestion and query capabilities.
"""

import os
import time
from uuid import uuid4

import httpx
import pytest
import requests

from a2a.client import A2ACardResolver, A2AClient
from a2a.types import (
    MessageSendParams,
    SendMessageRequest,
)
from a2a.utils.constants import AGENT_CARD_WELL_KNOWN_PATH


class TestRAGAgentEndToEnd:
    """End-to-end tests for RAG agent functionality."""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test environment."""
        self.rag_server_url = "http://localhost:9446"
        self.agent_url = "http://localhost:8099" 
        self.test_website_url = "http://testwebsite"
        self.timeout = 120  # seconds
        
        print(f"Testing RAG Agent at {self.agent_url}")
        print(f"RAG Server at {self.rag_server_url}")

    async def invoke_agent_a2a(self, message: str) -> str:
        """
        Simple function to invoke the agent using A2A protocol.
        
        Args:
            message: The message to send to the agent
            
        Returns:
            The agent's response content
        """
        async with httpx.AsyncClient(timeout=30.0) as httpx_client:
            # Initialize A2ACardResolver
            resolver = A2ACardResolver(
                httpx_client=httpx_client,
                base_url=self.agent_url,
            )
            
            # Fetch agent card
            agent_card = await resolver.get_agent_card()
            
            # Initialize client
            client = A2AClient(
                httpx_client=httpx_client, 
                agent_card=agent_card
            )
            
            # Prepare message payload
            send_message_payload = {
                'message': {
                    'role': 'user',
                    'parts': [
                        {'kind': 'text', 'text': message}
                    ],
                    'messageId': uuid4().hex,
                },
            }
            
            request = SendMessageRequest(
                id=str(uuid4()), 
                params=MessageSendParams(**send_message_payload)
            )
            
            # Send message and get response
            response = await client.send_message(request)
            
            # Extract content from response
            if hasattr(response, 'response') and hasattr(response.response, 'content'):
                return response.response.content
            elif hasattr(response, 'content'):
                return response.content
            else:
                # Fallback: convert to string and extract content
                response_str = str(response)
                return response_str

    def wait_for_agent_ready(self, max_attempts: int = 30):
        """Wait for the A2A agent to be ready."""
        for attempt in range(max_attempts):
            try:
                response = requests.get(f"{self.agent_url}{AGENT_CARD_WELL_KNOWN_PATH}", timeout=10)
                if response.status_code == 200:
                    agent_card_data = response.json()
                    print(f"✅ RAG Agent is ready (attempt {attempt + 1})")
                    print(f"Agent card: {agent_card_data.get('name', 'Unknown')}")
                    return
                else:
                    print(f"⏳ Agent not ready yet: HTTP {response.status_code} (attempt {attempt + 1})")
                    
            except requests.exceptions.RequestException as e:
                print(f"⏳ Waiting for RAG Agent... (attempt {attempt + 1}): {e}")
                
            time.sleep(5)
            
        raise Exception("RAG Agent failed to become ready within timeout period")

    def check_and_cleanup_existing_datasources(self):
        """Check for existing datasources and delete ALL of them for clean test state."""
        print("🧹 Checking for existing datasources...")
        
        try:
            # List all datasources
            response = requests.get(f"{self.rag_server_url}/v1/datasources", timeout=10)
            if response.status_code != 200:
                print(f"⚠️ Could not fetch datasources list: {response.text}")
                return
                
            datasources = response.json().get("datasources", [])
            
            if not datasources:
                print("✅ No existing datasources found")
                return
                
            print(f"🗑️ Found {len(datasources)} existing datasource(s) to delete for clean test state")
            
            # Delete each datasource
            for ds in datasources:
                datasource_id = ds.get("id") or ds.get("datasource_id")
                if not datasource_id:
                    print(f"⚠️ Skipping datasource with missing ID: {ds}")
                    continue
                    
                print(f"🗑️ Deleting datasource: {datasource_id} ({ds.get('description', 'No description')})")
                
                delete_response = requests.delete(
                    f"{self.rag_server_url}/v1/datasource/delete",
                    params={"datasource_id": datasource_id},
                    timeout=30
                )
                
                if delete_response.status_code == 200:
                    print(f"✅ Successfully deleted datasource: {datasource_id}")
                else:
                    print(f"⚠️ Failed to delete datasource {datasource_id}: {delete_response.text}")
                    
        except requests.exceptions.RequestException as e:
            print(f"⚠️ Error during datasource cleanup: {e}")
        except Exception as e:
            print(f"⚠️ Unexpected error during cleanup: {e}")

    def ingest_test_website(self):
        """Ingest the test website into RAG server."""
        # First, cleanup any existing test website datasources
        self.check_and_cleanup_existing_datasources()
        
        print("📥 Starting website ingestion...")
        
        ingest_data = {
            "url": self.test_website_url,
            "description": "Information about ACME Corporation and its products",
            "default_chunk_size": 1000,
            "default_chunk_overlap": 100,
            "check_for_site_map": True,
            "sitemap_max_urls": 10
        }
        
        response = requests.post(f"{self.rag_server_url}/v1/datasource/ingest/url", json=ingest_data)
        assert response.status_code == 200, f"Ingestion failed: {response.text}"
        
        job_id = response.json()["job_id"]
        print(f"✅ Ingestion started with job ID: {job_id}")
        
        # Wait for job completion
        start_time = time.time()
        while time.time() - start_time < self.timeout:
            response = requests.get(f"{self.rag_server_url}/v1/job/{job_id}")
            assert response.status_code == 200, f"Failed to get job status: {response.text}"
            
            job_data = response.json()
            status = job_data.get("status")
            
            print(f"⏳ Ingestion job status: {status} (processed: {job_data.get('processed_counter', 0)}/{job_data.get('total', '?')})")
            
            if status in ["completed", "completed_with_errors"]:
                print(f"✅ Ingestion completed with status: {status}")
                return
            elif status == "failed":
                raise Exception(f"Ingestion job failed: {job_data.get('message', 'Unknown error')}")
                
            time.sleep(3)
            
        raise Exception(f"Ingestion job did not complete within {self.timeout} seconds")

    def test_agent_readiness(self):
        """Test that the agent is ready and responds to A2A requests."""
        print("\n🔍 Testing agent readiness...")
        self.wait_for_agent_ready()

    def test_website_ingestion(self):
        """Test ingesting the test website."""
        print("\n📥 Testing website ingestion...")
        self.ingest_test_website()
        
        # Verify content is available
        query_data = {
            "query": "Acme Corporation",
            "limit": 5,
            "similarity_threshold": 0.1
        }
        
        response = requests.post(f"{self.rag_server_url}/v1/query", json=query_data)
        assert response.status_code == 200, f"Query failed: {response.text}"
        
        results = response.json()
        assert "results" in results, "Query results missing"
        assert len(results["results"]) > 0, "No search results found for ingested content"
        
        print(f"✅ Website ingestion verified - found {len(results['results'])} results for 'Acme Corporation'")

    @pytest.mark.asyncio
    async def test_acme_phone_number_query(self):
        """Test asking for Acme Corp phone number - should contain '555'."""
        print("\n📞 Testing Acme Corp phone number query...")
        
        # Wait a moment for ingestion to be fully indexed
        time.sleep(5)
        
        response = await self.invoke_agent_a2a("What's the phone number for Acme corp?")
        print(f"Agent response: {response}")
        
        # The test website has phone number (555) 123-9446
        assert "9446" in response, f"Expected phone number containing '9446' not found in response: {response}"
        print("✅ Phone number query test passed - found '9446' in response")

    @pytest.mark.asyncio
    @pytest.mark.skipif(os.getenv("ENABLE_GRAPH_RAG", "true").lower() != "true", 
                       reason="Graph RAG disabled")
    async def test_aws_accounts_query(self):
        """Test asking about AWS accounts - should contain '3'.""" 
        print("\n☁️ Testing AWS accounts query...")
        
        response = await self.invoke_agent_a2a("How many AWS accounts are there?")
        print(f"Agent response: {response}")
        
        # Check if response contains '3' as requested
        assert "3" in response or "three" in response.lower(), f"Expected '3' or 'three' not found in response: {response}"
        
    @pytest.mark.asyncio  
    async def test_company_information_query(self):
        """Test querying for general company information."""
        print("\n🏢 Testing company information query...")
        
        response = await self.invoke_agent_a2a("Tell me about Acme Corporation")
        print(f"Agent response: {response}")
        
        # Should contain key information from our test data
        assert any(keyword in response.lower() for keyword in ["acme", "corporation", "technology", "founded"]), \
            f"Expected company information not found in response: {response}"
        print("✅ Company information query test passed")

    @pytest.mark.asyncio
    async def test_product_query(self):
        """Test querying for product information."""
        print("\n📦 Testing product query...")
        
        response = await self.invoke_agent_a2a("What products does Acme Corporation offer?")
        print(f"Agent response: {response}")
        
        # Should mention Widget Pro, DataFlow, or CloudSync
        assert any(product in response for product in ["Widget Pro", "DataFlow", "CloudSync"]), \
            f"Expected product names not found in response: {response}"
        print("✅ Product query test passed")


if __name__ == "__main__":
    # Allow running tests directly
    pytest.main([__file__, "-v", "-s"])
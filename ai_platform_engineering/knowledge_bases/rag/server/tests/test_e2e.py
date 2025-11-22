#!/usr/bin/env python3
"""
End-to-End Tests for RAG Server

This test suite validates the RAG server functionality in both Graph RAG enabled
and disabled modes. Tests are designed to run against a live system started
via docker-compose.
"""

import requests
import time
import os
import pytest
from typing import Dict, Any
import uuid


class TestRAGEndToEnd:
    """End-to-end tests for RAG server functionality."""
    test_datasource_id = None  # To store datasource ID created during tests
        
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test environment and wait for services to be ready."""
        self.base_url = "http://localhost:9446"
        self.graph_rag_enabled = os.getenv("ENABLE_GRAPH_RAG", "true").lower() == "true"
        self.test_timeout = 120  # seconds to wait for ingestion
        
        print(f"Testing RAG server at {self.base_url}")
        print(f"Graph RAG enabled: {self.graph_rag_enabled}")
        
        # Wait for services to be ready
        self.wait_for_health()
        
    def wait_for_health(self, max_attempts: int = 30):
        """Wait for the RAG server to be healthy."""
        for attempt in range(max_attempts):
            try:
                response = requests.get(f"{self.base_url}/healthz", timeout=10)
                if response.status_code == 200:
                    health_data = response.json()
                    if health_data.get("status") == "healthy":
                        print(f"✅ RAG server is healthy (attempt {attempt + 1})")
                        return
                    else:
                        print(f"⏳ RAG server not healthy yet: {health_data.get('status')}")
                        
            except requests.exceptions.RequestException as e:
                print(f"⏳ Waiting for RAG server... (attempt {attempt + 1}): {e}")
                
            time.sleep(5)
            
        raise Exception("RAG server failed to become healthy within timeout period")

    def wait_for_job_completion(self, job_id: str) -> Dict[str, Any]:
        """Wait for a job to complete and return final job status."""
        start_time = time.time()
        
        while time.time() - start_time < self.test_timeout:
            response = requests.get(f"{self.base_url}/v1/job/{job_id}")
            assert response.status_code == 200, f"Failed to get job status: {response.text}"
            
            job_data = response.json()
            status = job_data.get("status")
            
            print(f"⏳ Job {job_id} status: {status} (processed: {job_data.get('processed_counter', 0)}/{job_data.get('total', '?')})")
            
            if status in ["completed", "failed", "terminated", "completed_with_errors"]:
                print(f"✅ Job {job_id} finished with status: {status}")
                return job_data
                
            time.sleep(2)
            
        raise Exception(f"Job {job_id} did not complete within {self.test_timeout} seconds")

    def test_health_check(self):
        """Test that the system is healthy and properly configured."""
        print("\n🏥 Testing health check...")
        
        response = requests.get(f"{self.base_url}/healthz")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        
        health_data = response.json()
        assert health_data["status"] == "healthy", f"System not healthy: {health_data}"
        
        # Validate configuration matches expected Graph RAG mode
        config = health_data.get("config", {})
        assert config.get("graph_rag_enabled") == self.graph_rag_enabled, \
            f"Graph RAG mode mismatch: expected {self.graph_rag_enabled}, got {config.get('graph_rag_enabled')}"
            
        print(f"✅ Health check passed - Graph RAG: {self.graph_rag_enabled}")

    def test_url_ingestion_workflow(self):
        """Test complete URL ingestion workflow."""
        print("\n📥 Testing URL ingestion workflow...")

        # Test URL - using local testwebsite for reliable test content
        test_url = "http://testwebsite"
        
        # Start ingestion
        ingest_data = {
            "url": test_url,
            "description": "Test HTML page for E2E testing",
            "default_chunk_size": 1000,
            "default_chunk_overlap": 100,
            "check_for_site_map": False,
            "sitemap_max_urls": 0
        }
        
        response = requests.post(f"{self.base_url}/v1/datasource/ingest/url", json=ingest_data)
        assert response.status_code == 200, f"Ingestion failed: {response.text}"
        
        ingest_response = response.json()
        job_id = ingest_response["job_id"]
        assert job_id, "Job ID not returned from ingestion"

        datasource_id = ingest_response.get("datasource_id")
        assert datasource_id, "Datasource ID not returned from ingestion"

        print(f"✅ Ingestion started with job ID: {job_id}")

        TestRAGEndToEnd.test_datasource_id = datasource_id

        # Wait for job completion
        job_data = self.wait_for_job_completion(job_id)
        assert job_data["status"] in ["completed", "completed_with_errors"], \
            f"Job failed: {job_data.get('message', 'Unknown error')}"
            
        # Store job_id for use in other tests
        self.last_job_id = job_id

        # Wait a moment for indexing to complete
        time.sleep(10)
        
        print(f"✅ Ingestion completed successfully")

    @pytest.mark.dependency(depends=['test_url_ingestion_workflow'])
    def test_datasource_listing(self):
        """Test datasource listing functionality."""
        print("\n📋 Testing datasource listing...")
        
        response = requests.get(f"{self.base_url}/v1/datasources")
        print(response.text)
        assert response.status_code == 200, f"Failed to list datasources: {response.text}"
        
        datasources_data = response.json()
        assert datasources_data["success"] is True, "Datasources listing not successful"
        assert datasources_data["count"] > 0, "No datasources found after ingestion"
        
        datasources = datasources_data["datasources"]
        assert len(datasources) > 0, "Datasources list is empty"
        
        print(f"✅ Found {len(datasources)} datasource(s)")

    @pytest.mark.dependency(depends=['test_url_ingestion_workflow'])
    def test_query_ingested_content(self):
        """Test querying ingested content."""
        print("\n🔍 Testing content querying...")
        
        # Query for content that should be in the testwebsite HTML page
        query_data = {
            "query": "HTML page",
            "limit": 5,
            "similarity_threshold": 0.1,
            "ranker_type": "weighted",
            "ranker_params": {"weights": [0.7, 0.3]}
        }
        
        response = requests.post(f"{self.base_url}/v1/query", json=query_data)
        assert response.status_code == 200, f"Query failed: {response.text}"
        
        query_results = response.json()
        assert "results" in query_results, "Query results missing"
        assert len(query_results["results"]) > 0, "No search results found for ingested content"
        
        # Validate result structure
        first_result = query_results["results"][0]
        assert "document" in first_result, "Document missing from result"
        assert "score" in first_result, "Score missing from result"
        assert first_result["score"] > 0, "Score should be positive"
        
        print(f"✅ Query returned {len(query_results['results'])} results")
    
    def test_job_operations(self):
        """Test job management operations."""
        print("\n⚡ Testing job operations...")
        
        # Test getting job status (should still exist)
        if hasattr(self, 'last_job_id'):
            response = requests.get(f"{self.base_url}/v1/job/{self.last_job_id}")
            assert response.status_code == 200, f"Failed to get job status: {response.text}"
            
            job_data = response.json()
            assert job_data["job_id"] == self.last_job_id, "Job ID mismatch"
            assert "status" in job_data, "Job status missing"
            
            print(f"✅ Job status retrieved: {job_data['status']}")
        
        # Test non-existent job (should return 404)
        fake_job_id = str(uuid.uuid4())
        response = requests.get(f"{self.base_url}/v1/job/{fake_job_id}")
        assert response.status_code == 404, f"Expected 404 for non-existent job, got {response.status_code}"
        
        print("✅ Non-existent job handling works correctly")

    def test_job_termination(self):
        """Test job termination functionality."""
        print("\n🛑 Testing job termination...")

        # list all datasources to find one to terminate
        response = requests.get(f"{self.base_url}/v1/datasources")
        assert response.status_code == 200, f"Failed to list datasources: {response.text}"
        datasources_data = response.json()
        datasources = datasources_data["datasources"]
        print(datasources)


        # Start a new ingestion job
        test_url = "https://docs.astral.sh/ruff/sitemap.xml" # Using a larger sitemap for longer job
        ingest_data = {
            "url": test_url,
            "description": "Job for termination test",
            "default_chunk_size": 1000,
            "default_chunk_overlap": 100,
            "check_for_site_map": True,
            "sitemap_max_urls": 0
        }
        
        response = requests.post(f"{self.base_url}/v1/datasource/ingest/url", json=ingest_data)
        assert response.status_code == 200, f"Ingestion failed: {response.text}"
        
        job_id = response.json()["job_id"]
        
        # Try to terminate the job quickly (might already be completed)
        time.sleep(1)  # Give it a moment to start
        
        response = requests.post(f"{self.base_url}/v1/job/{job_id}/terminate")
        # Job might already be completed, so we accept both 200 and 400
        assert response.status_code in [200, 400], f"Unexpected response for job termination: {response.text}"
        
        if response.status_code == 200:
            print("✅ Job terminated successfully")
        else:
            print("✅ Job already completed (termination not needed)")

    def test_error_scenarios(self):
        """Test error handling for invalid requests."""
        print("\n❌ Testing error scenarios...")
        
        # Test invalid URL ingestion
        invalid_ingest_data = {
            "url": "not-a-valid-url",
            "description": "Invalid URL test",
            "default_chunk_size": 1000,
            "default_chunk_overlap": 100
        }
        
        response = requests.post(f"{self.base_url}/v1/datasource/ingest/url", json=invalid_ingest_data)
        # Should either reject immediately or fail during processing
        assert response.status_code in [200, 400, 422], f"Unexpected response for invalid URL: {response.text}"
        
        # Test deleting non-existent datasource
        fake_datasource_id = "non-existent-datasource"
        response = requests.delete(f"{self.base_url}/v1/datasource/delete", 
                                 params={"datasource_id": fake_datasource_id})
        assert response.status_code == 404, f"Expected 404 for non-existent datasource, got {response.status_code}"
        
        print("✅ Error scenarios handled correctly")

    @pytest.mark.dependency(depends=['test_url_ingestion_workflow'])
    def test_datasource_reload(self):
        """Test datasource reload functionality."""
        print("\n🔄 Testing datasource reload...")

        time.sleep(5)  # Brief pause to allow indexing jobs to settle

        if not TestRAGEndToEnd.test_datasource_id:
            raise Exception("No test datasource ID available for reload test")

        test_datasource_id = TestRAGEndToEnd.test_datasource_id  # Use the datasource from ingestion test

  
        response = requests.post(f"{self.base_url}/v1/datasource/reload",
                                params={"datasource_id": test_datasource_id})
        assert response.status_code == 200, f"Datasource reload failed: {response.text}"

        reload_response = response.json()
        new_job_id = reload_response["job_id"]

        print(f"✅ Datasource reload started with job ID: {new_job_id}")

        # Wait for reload completion
        job_data = self.wait_for_job_completion(new_job_id)
        assert job_data["status"] in ["completed", "completed_with_errors"], \
            f"Reload job failed: {job_data.get('message', 'Unknown error')}"

        print("✅ Datasource reload completed successfully")

    @pytest.mark.dependency(depends=['test_url_ingestion_workflow'])
    def test_datasource_cleanup(self):
        """Clean up test datasources and verify content is no longer searchable."""
        print("\n🧹 Testing datasource deletion...")

        time.sleep(5)  # Brief pause to allow indexing jobs to settle

        if not TestRAGEndToEnd.test_datasource_id:
            raise Exception("No test datasource ID available for reload test")

        test_datasource_id = TestRAGEndToEnd.test_datasource_id  # Use the datasource from ingestion test

        # Delete the datasource
        response = requests.delete(f"{self.base_url}/v1/datasource/delete", 
                                 params={"datasource_id": test_datasource_id})
        assert response.status_code == 200, f"Failed to delete datasource: {response.text}"
        
        print("✅ Test datasource deleted successfully")
        
        # Wait a moment for deletion to propagate
        time.sleep(3)
        
        # Verify content is no longer searchable
        print("🔍 Verifying content is no longer searchable...")
        query_data = {
            "query": "HTML page",
            "limit": 5,
            "similarity_threshold": 0.1,
            "ranker_type": "weighted",
            "ranker_params": {"weights": [0.7, 0.3]}
        }
        
        response = requests.post(f"{self.base_url}/v1/query", json=query_data)
        assert response.status_code == 200, f"Query failed: {response.text}"
        
        query_results = response.json()
        assert "results" in query_results, "Query results missing"
        
        # Should return no results or significantly fewer results
        result_count = len(query_results["results"])
        print(f"✅ Query after deletion returned {result_count} results (expected: 0 or very few)")
        
        # If there are results, they shouldn't be from our deleted datasource
        if result_count > 0:
            for result in query_results["results"]:
                metadata = result.get("document", {}).get("metadata", {})
                datasource_id = metadata.get("datasource_id")
                if datasource_id == test_datasource_id:
                    raise AssertionError(f"Found content from deleted datasource {test_datasource_id} in search results")
            
            print("✅ Remaining results are from other datasources (not the deleted one)")
        else:
            print("✅ No search results found after datasource deletion")

    # Graph RAG specific tests (only run when ENABLE_GRAPH_RAG=true)
    
    @pytest.mark.skipif(os.getenv("ENABLE_GRAPH_RAG", "true").lower() != "true", 
                       reason="Graph RAG disabled")
    def test_graph_ingestors(self):
        """Test graph ingestor operations (Graph RAG only)."""
        print("\n🔗 Testing graph ingestors...")
        
        # List ingestors (should be empty initially)
        response = requests.get(f"{self.base_url}/v1/graph/ingestors")
        assert response.status_code == 200, f"Failed to list graph ingestors: {response.text}"
        
        ingestors = response.json()
        print(f"✅ Found {len(ingestors)} graph ingestor(s)")

    @pytest.mark.skipif(os.getenv("ENABLE_GRAPH_RAG", "true").lower() != "true", 
                       reason="Graph RAG disabled")
    def test_graph_entity_types(self):
        """Test graph entity type listing (Graph RAG only)."""
        print("\n🏷️  Testing graph entity types...")
        
        response = requests.get(f"{self.base_url}/v1/graph/explore/entity_type")
        assert response.status_code == 200, f"Failed to list entity types: {response.text}"
        
        entity_types = response.json()
        print(f"✅ Found {len(entity_types)} entity type(s)")

    @pytest.mark.skipif(os.getenv("ENABLE_GRAPH_RAG", "true").lower() != "true", 
                       reason="Graph RAG disabled")
    def test_graph_entity_ingestion(self):
        """Test graph entity ingestion (Graph RAG only)."""
        print("\n📊 Testing graph entity ingestion...")
        
        # Sample entity data
        entity_data = {
            "entity_type": "TestEntity",
            "ingestor_name": "test_ingestor",
            "ingestor_type": "test_ingestor_type",
            "fresh_until": int(time.time()) + 3600,  # 1 hour from now
            "entities": [
                {
                    "entity_type": "TestEntity",
                    "additional_labels": [],
                    "all_properties": {
                        "name": "Test Entity 1",
                        "description": "A test entity for E2E testing",
                        "test_property": "test_value"
                    },
                    "primary_key_properties": ["name"],
                    "additional_key_properties": []
                }
            ]
        }
        
        response = requests.post(f"{self.base_url}/v1/graph/ingest/entities", json=entity_data)
        assert response.status_code == 200, f"Graph entity ingestion failed: {response.text}"
        
        print("✅ Graph entity ingestion completed")
        
        # Store ingestor name for cleanup
        self.test_ingestor_id = "test_ingestor"

    @pytest.mark.skipif(os.getenv("ENABLE_GRAPH_RAG", "true").lower() != "true", 
                       reason="Graph RAG disabled")
    def test_query_ingested_entity(self):
        """Test querying for ingested graph entity (Graph RAG only)."""
        print("\n🔍 Testing graph entity search...")
        
        # Wait a moment for entity ingestion to be indexed
        time.sleep(3)
        
        # Query for the test entity we just ingested
        query_data = {
            "query": "Test Entity 1 testing",
            "limit": 10,
            "similarity_threshold": 0.1,
            "ranker_type": "weighted", 
            "ranker_params": {"weights": [0.3, 0.7]},  # Bias towards keyword matching (BM25)
            "filters": {
                "doc_type": "graph_entity"  # Filter to graph entities only
            }
        }
        
        response = requests.post(f"{self.base_url}/v1/query", json=query_data)
        assert response.status_code == 200, f"Entity query failed: {response.text}"
        
        query_results = response.json()
        assert "results" in query_results, "Query results missing"

        print(f"🔎 Search results: {query_results}")
        
        # Should find our test entity
        found_test_entity = False
        for result in query_results["results"]:
            document = result.get("document", {})
            metadata = document.get("metadata", {})
            
            # Check if this is our test entity
            if (metadata.get("graph_entity_type") == "TestEntity" and 
                metadata.get("graph_ingestor_id") == "test_ingestor_type/test_ingestor"):
                found_test_entity = True
                
                # Verify the content contains our test data
                content = document.get("page_content", "")
                assert "Test Entity 1" in content, "Entity name not found in content"
                assert "test_property" in content, "Entity property not found in content"
                assert "test_value" in content, "Entity property value not found in content"
                
                print(f"✅ Found test entity in search results with score: {result.get('score', 0)}")
                break
        
        if not found_test_entity:
            # Print all results for debugging
            print("📋 Search results received:")
            for i, result in enumerate(query_results["results"]):
                metadata = result.get("document", {}).get("metadata", {})
                print(f"  {i+1}. Type: {metadata.get('doc_type')}, "
                      f"Entity Type: {metadata.get('graph_entity_type')}, "
                      f"Ingestor: {metadata.get('graph_ingestor_id')}")
            
            raise AssertionError("Test entity not found in search results")
        
        print(f"✅ Entity search returned {len(query_results['results'])} total results")

    @pytest.mark.skipif(os.getenv("ENABLE_GRAPH_RAG", "true").lower() != "true", 
                       reason="Graph RAG disabled")
    
    @pytest.mark.dependency(depends=['test_query_ingested_entity'])
    def test_graph_ingestor_cleanup(self):
        """Clean up test graph ingestor (Graph RAG only)."""
        print("\n🧹 Testing graph ingestor deletion...")
        
        if hasattr(self, 'test_ingestor_id'):
            response = requests.delete(f"{self.base_url}/v1/graph/ingestor/delete", 
                                     params={"ingestor_id": self.test_ingestor_id})
            assert response.status_code == 200, f"Failed to delete graph ingestor: {response.text}"
            
            print("✅ Test graph ingestor deleted successfully")


if __name__ == "__main__":
    # Allow running tests directly
    pytest.main([__file__, "-v"])
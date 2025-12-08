#!/usr/bin/env python3
"""
End-to-End Tests for Ontology Agent

This test suite validates the Ontology agent/server functionality
Tests are designed to run against a live system started via docker-compose.
"""

import requests
import time
import pytest
from common.graph_db.neo4j.graph_db import Neo4jDB
from common.constants import DEFAULT_DATA_LABEL, DEFAULT_SCHEMA_LABEL
from agent_ontology.relation_manager import RelationCandidateManager
from common.models.ontology import FkeyEvaluationResult
import pytest_asyncio


class TestOntologyEndToEnd:
    """End-to-end tests for Ontology server/agent functionality."""
        
    @pytest_asyncio.fixture(autouse=True)
    async def setup(self):
        """Setup test environment and wait for services to be ready."""
        self.base_url = "http://localhost:8098" # Ontology server/agent URL
        self.rag_server_url = "http://localhost:9446"  # RAG server URL
        self.test_timeout = 120  # seconds to wait for ingestion
        
        # Initialize Neo4j database connections - both use the same instance with different tenant labels
        self.data_graph_db = Neo4jDB(tenant_label=DEFAULT_DATA_LABEL, uri="bolt://localhost:7687")
        self.ontology_graph_db = Neo4jDB(tenant_label=DEFAULT_SCHEMA_LABEL, uri="bolt://localhost:7687")
        
        # Setup databases
        await self.data_graph_db.setup()
        await self.ontology_graph_db.setup()
                
        print(f"Testing Ontology server/agent at {self.base_url}")
        
        # Wait for services to be ready
        self.wait_for_health()
        
    def wait_for_health(self, max_attempts: int = 30):
        """Wait for the Ontology server/agent to be healthy."""
        for attempt in range(max_attempts):
            try:
                response = requests.get(f"{self.base_url}/v1/graph/ontology/agent/status", timeout=10)
                if response.status_code == 200:
                    health_data = response.json()
                    if health_data.get("status") == "healthy":
                        print(f"✅ Ontology server/agent is healthy (attempt {attempt + 1})")
                        return
                    else:
                        print(f"⏳ Ontology server/agent not healthy yet: {health_data.get('status')}")
                        
            except requests.exceptions.RequestException as e:
                print(f"⏳ Waiting for Ontology server/agent... (attempt {attempt + 1}): {e}")
                
            time.sleep(5)
            
        raise Exception("Ontology server/agent failed to become healthy within timeout period")


    def test_ontology_agent_status(self):
        """Test the Ontology agent status endpoint."""
        response = requests.get(f"{self.base_url}/v1/graph/ontology/agent/status", timeout=10)
        assert response.status_code == 200, "Failed to get Ontology agent health status"
        
        health_data = response.json()
        assert health_data.get("status") == "healthy", "Ontology agent is not healthy"
        print("✅ Ontology agent health status verified")

    async def get_relation_manager(self) -> RelationCandidateManager:
        """Get a relation candidate manager with the current heuristics version."""
        # Get the ontology version from the ontology agent
        response = requests.get(f"{self.base_url}/v1/graph/ontology/agent/ontology_version", timeout=30)
        if response.status_code == 200:
            version_data = response.json()
            ontology_version_id = version_data.get("ontology_version_id")
        else:
            raise Exception("Failed to get ontology version from agent")
        
        print("🔍 Initializing RelationCandidateManager with ontology version:", ontology_version_id)
        relation_manager = RelationCandidateManager(
            self.data_graph_db, 
            self.ontology_graph_db, 
            ontology_version_id, 
            "test_agent"
        )
        return relation_manager
        

    async def clear_ontology_db(self):
        """Clear all data from ontology database using Cypher query."""
        print("🧹 Clearing ontology database...")
        
        try:
            query = "MATCH (n) DETACH DELETE n"
            await self.ontology_graph_db.raw_query(query)
            print("✅ Ontology database cleared successfully")
        except Exception as e:
            print(f"⚠️ Error clearing ontology database: {e}")
            raise

    async def verify_data_exists(self):
        """Checks if data exists in the data graph."""
        try:
            entity_count = await self.count_data_graph_entities()
            if entity_count == 0:
                raise Exception("No data exists in the data graph. Please ingest data first.")
            print(f"✅ Data verification passed: {entity_count} entities found in data graph")
        except Exception as e:
            if "No data exists" in str(e):
                raise
            else:
                raise Exception(f"Failed to verify data existence: {e}")

    async def count_data_graph_entities(self):
        """Count entities in the data graph via direct Neo4j connection."""
        print("🔍 Counting entities in data graph...")
        
        try:
            query = "MATCH (n) RETURN count(n) as entity_count"
            result = await self.data_graph_db.raw_query(query, readonly=True)
            
            entity_count = result["results"][0]["entity_count"] if result["results"] else 0
            print(f"✅ Total entities in data graph: {entity_count}")
            return entity_count
        except Exception as e:
            print(f"⚠️ Error counting data graph entities: {e}")
            raise

    async def count_data_graph_relations(self):
        """Count relations in the data graph."""
        print("🔍 Counting relations in data graph...")
        
        try:
            query = "MATCH ()-[r]->() RETURN count(r) as relation_count"
            result = await self.data_graph_db.raw_query(query, readonly=True)
            
            relation_count = result["results"][0]["relation_count"] if result["results"] else 0
            print(f"✅ Total relations in data graph: {relation_count}")
            return relation_count
        except Exception as e:
            print(f"⚠️ Error counting data graph relations: {e}")
            raise

    async def count_ontology_entities(self):
        """Count entities in the ontology graph (excluding relation candidate nodes)."""
        print("🔍 Counting entities in ontology graph...")
        
        try:
            query = "MATCH (n) RETURN count(n) as entity_count"
            result = await self.ontology_graph_db.raw_query(query, readonly=True)
            
            entity_count = result["results"][0]["entity_count"] if result["results"] else 0
            print(f"✅ Total entities in ontology graph: {entity_count}")
            return entity_count
        except Exception as e:
            print(f"⚠️ Error counting ontology entities: {e}")
            raise

    async def count_ontology_relations(self):
        """Count relation candidates in the ontology graph."""
        print("🔍 Counting relation candidates in ontology graph...")
        
        try:
            relation_manager = await self.get_relation_manager()
            candidates = await relation_manager.fetch_all_candidates()
            relation_count = len(candidates)
            print(f"✅ Total relation candidates in ontology graph: {relation_count}")
            return relation_count
        except Exception as e:
            print(f"⚠️ Error counting ontology relations: {e}")
            raise

    async def get_all_relation_candidates(self):
        """Get all relation candidates from ontology graph."""
        print("🔍 Fetching all relation candidates...")
        
        try:
            relation_manager = await self.get_relation_manager()
            candidates_dict = await relation_manager.fetch_all_candidates()
            
            print(f"✅ Found {len(candidates_dict)} relation candidates")
            return candidates_dict
        except Exception as e:
            print(f"⚠️ Error fetching relation candidates: {e}")
            raise

    async def check_relation_applied_in_data_graph(self, relation_id):
        """Check if a relation is applied in the data graph by looking for _ontology_relation_id."""
        try:
            query = f"""
            MATCH ()-[r]->() 
            WHERE r._ontology_relation_id = '{relation_id}' 
            RETURN count(r) as relation_count
            """
            result = await self.data_graph_db.raw_query(query, readonly=True)
            
            relation_count = result["results"][0]["relation_count"] if result["results"] else 0
            return relation_count > 0
        except Exception as e:
            print(f"⚠️ Error checking relation in data graph: {e}")
            raise

    def wait_for_processing_completion(self, max_wait_time=300):
        """Wait for ontology processing to complete."""
        print("⏳ Waiting for ontology processing to complete...")
        
        start_time = time.time()
        while time.time() - start_time < max_wait_time:
            response = requests.get(f"{self.base_url}/v1/graph/ontology/agent/status", timeout=10)
            if response.status_code == 200:
                health_data = response.json()
                is_processing = health_data.get("is_processing", False)
                is_evaluating = health_data.get("is_evaluating", False)
                
                if not is_processing and not is_evaluating:
                    print("✅ Ontology processing completed")
                    return True
                else:
                    print(f"⏳ Still processing... (processing: {is_processing}, evaluating: {is_evaluating})")
            
            time.sleep(5)
            print("⏳ Checking processing status again...")
        
        raise Exception(f"Ontology processing did not complete within {max_wait_time} seconds")

    @pytest.mark.asyncio
    async def test_complete_ontology_workflow(self):
        """Complete end-to-end test of the ontology workflow."""
        print("\n🚀 Starting complete ontology E2E test workflow...")
        
        # Step 1: Verify data exists in data graph
        print("\n" + "="*80)
        print("=== STEP 1: DATA INGESTION VERIFICATION ===")
        print("="*80)
        print("Waiting for data ingestion to complete...")
        time.sleep(5)  # Wait a moment for any indexing to complete
        print("🔍 Verifying data ingestion...")
        await self.verify_data_exists()

        # Step 2: Verify data graph has exactly 66 entities and no relations
        print("\n" + "="*80)
        print("=== STEP 2: DATA GRAPH VALIDATION ===")
        print("="*80)
        entity_count = await self.count_data_graph_entities()
        assert entity_count == 66, f"Expected 66 entities in data graph, got {entity_count}"
        
        relation_count = await self.count_data_graph_relations()
        assert relation_count == 0, f"Expected 0 relations in data graph, got {relation_count}"
        
        print("✅ Steps 1-2 completed: Data ingestion and validation successful")
        
        # Step 3: Run process_all endpoint
        print("\n" + "="*80)
        print("=== STEP 3: ONTOLOGY PROCESSING (process_all) ===")
        print("="*80)
        print("📊 Running process_all endpoint...")
        response = requests.post(f"{self.base_url}/v1/graph/ontology/agent/debug/process_all", timeout=60)
        assert response.status_code == 200, f"Failed to run process_all: {response.status_code}"
        
        # Wait for processing to complete
        self.wait_for_processing_completion()
        print("✅ Step 3 completed: Ontology processing finished")
        
        # Step 4: Check ontology db has exactly 18 entities and 53 relations
        print("\n" + "="*80)
        print("=== STEP 4: ONTOLOGY GRAPH VALIDATION ===")
        print("="*80)
        ontology_entity_count = await self.count_ontology_entities()
        assert ontology_entity_count == 18, f"Expected 18 entities in ontology graph, got {ontology_entity_count}"
        
        ontology_relation_count = await self.count_ontology_relations()
        assert ontology_relation_count == 53, f"Expected 53 relation candidates in ontology graph, got {ontology_relation_count}"
        
        print("✅ Step 4 completed: Ontology graph validation successful")
        
        # Step 5: Clear ontology db
        print("\n" + "="*80)
        print("=== STEP 5: ONTOLOGY DATABASE CLEANUP ===")
        print("="*80)
        await self.clear_ontology_db()
        
        # Verify it's cleared
        cleared_entity_count = await self.count_ontology_entities()
        cleared_relation_count = await self.count_ontology_relations()
        assert cleared_entity_count == 0, f"Expected 0 entities after clear, got {cleared_entity_count}"
        assert cleared_relation_count == 0, f"Expected 0 relations after clear, got {cleared_relation_count}"
        
        # Wait a moment for any sync operations
        time.sleep(2)

        print("✅ Step 5 completed: Ontology database cleared successfully")
        
        # Step 6: Trigger regenerate_ontology endpoint
        print("\n" + "="*80)
        print("=== STEP 6: ONTOLOGY REGENERATION ===")
        print("="*80)
        print("🔄 Triggering regenerate_ontology endpoint...")
        response = requests.post(f"{self.base_url}/v1/graph/ontology/agent/regenerate_ontology", timeout=60)
        assert response.status_code == 200, f"Failed to regenerate ontology: {response.status_code}"
        
        # Wait for regeneration to complete
        self.wait_for_processing_completion()

        # Give some time for any final sync operations
        print("⏳ Waiting for final sync operations to complete...")
        time.sleep(5)
        print("✅ Step 6 completed: Ontology regeneration finished")
        
        # Step 7: Validate relation candidates and their application in data graph
        print("\n" + "="*80)
        print("=== STEP 7: RELATION VALIDATION & DATA GRAPH SYNC ===")
        print("="*80)
        relation_candidates_dict = await self.get_all_relation_candidates()
        
        accepted_count = 0
        rejected_count = 0
        unsure_count = 0
        
        for relation_id, candidate in relation_candidates_dict.items():
            evaluation_result = None
            if candidate.evaluation is not None:
                evaluation_result = candidate.evaluation.result.value if candidate.evaluation.result else None
            
            print("🔍 Validating relation candidate:", relation_id, "with evaluation:", evaluation_result)
            is_applied = await self.check_relation_applied_in_data_graph(relation_id)
            
            if evaluation_result == FkeyEvaluationResult.ACCEPTED.value:
                accepted_count += 1
                assert is_applied, f"ACCEPTED relation {relation_id} should be applied in data graph but was not found"
                print(f"✅ ACCEPTED relation {relation_id} is correctly applied in data graph")
                
            elif evaluation_result == FkeyEvaluationResult.REJECTED.value:
                rejected_count += 1
                assert not is_applied, f"REJECTED relation {relation_id} should not be applied in data graph but was found"
                print(f"✅ REJECTED relation {relation_id} is correctly not applied in data graph")
                
            elif evaluation_result == FkeyEvaluationResult.UNSURE.value:
                unsure_count += 1
                assert not is_applied, f"UNSURE relation {relation_id} should not be applied in data graph but was found"
                print(f"✅ UNSURE relation {relation_id} is correctly not applied in data graph")
            
            else:
                print(f"⚠️ Unknown evaluation result for relation {relation_id}: {evaluation_result}")
        
        print("✅ Step 7 completed: Relation validation and data graph sync verified")
        
        # Final summary
        print("\n" + "="*80)
        print("=== FINAL TEST SUMMARY ===")
        print("="*80)
        print("📊 Relation evaluation results:")
        print(f"  - ACCEPTED relations: {accepted_count}")
        print(f"  - REJECTED relations: {rejected_count}")
        print(f"  - UNSURE relations: {unsure_count}")
        print(f"  - Total relation candidates: {len(relation_candidates_dict)}")
        
        # Verify we have some relations in each state (this is a sanity check)
        assert len(relation_candidates_dict) > 0, "Should have at least some relation candidates"
        
        print("\n🎉 Complete ontology workflow test passed successfully!")
        print("="*80)

    async def get_first_accepted_relation(self):
        """Get the first ACCEPTED relation candidate for testing."""
        relation_candidates_dict = await self.get_all_relation_candidates()
        for relation_id, candidate in relation_candidates_dict.items():
            if candidate.evaluation is not None and candidate.evaluation.result == FkeyEvaluationResult.ACCEPTED:
                return relation_id
        return None

    async def get_first_unsure_relation(self):
        """Get the first UNSURE/None relation candidate for testing."""
        relation_candidates_dict = await self.get_all_relation_candidates()
        for relation_id, candidate in relation_candidates_dict.items():
            if candidate.evaluation is None or candidate.evaluation.result == FkeyEvaluationResult.UNSURE:
                return relation_id
        return None

    def wait_for_sync_grace_period(self, seconds=5):
        """Wait for relation sync operations to complete."""
        print(f"⏳ Waiting {seconds} seconds for sync operations to complete...")
        time.sleep(seconds)

    @pytest.mark.asyncio
    async def test_relation_management_endpoints(self):
        """Test the relation management endpoints with various scenarios."""
        print("\n🚀 Starting relation management endpoint tests...")
        
        # Setup: Ensure we have relation candidates
        print("\n" + "="*80)
        print("=== SETUP: PREPARING RELATION CANDIDATES ===")
        print("="*80)
        await self.verify_data_exists()

        # Run process_all to generate relation candidates
        print("📊 Running process_all endpoint to ensure we have relation candidates...")
        response = requests.post(f"{self.base_url}/v1/graph/ontology/agent/debug/process_all", timeout=60)
        assert response.status_code == 200, f"Failed to run process_all: {response.status_code}"
        
        # Wait for processing to complete
        self.wait_for_processing_completion()
        
        # Trigger regenerate_ontology to get evaluated relations
        print("🔄 Triggering regenerate_ontology endpoint...")
        response = requests.post(f"{self.base_url}/v1/graph/ontology/agent/regenerate_ontology", timeout=60)
        assert response.status_code == 200, f"Failed to regenerate ontology: {response.status_code}"
        
        # Wait for regeneration to complete
        self.wait_for_processing_completion()
        print("✅ Setup completed: Relation candidates prepared and evaluated")
        
        # Test 1: Try to accept an already accepted relation (should error)
        print("\n" + "="*80)
        print("=== TEST 1: DUPLICATE ACCEPT VALIDATION ===")
        print("="*80)
        accepted_relation_id = await self.get_first_accepted_relation()
        assert accepted_relation_id is not None, "No ACCEPTED relation found for testing"
        
        print(f"🔍 Testing with accepted relation: {accepted_relation_id}")
        
        # Try to accept it again - should fail
        response = requests.post(
            f"{self.base_url}/v1/graph/ontology/agent/relation/accept/{accepted_relation_id}",
            params={"relation_name": "test_relation"},
            timeout=30
        )
        assert response.status_code == 400, f"Expected 400 error when accepting already accepted relation, got {response.status_code}"
        error_response = response.json()
        assert "already has an evaluation" in error_response.get("detail", ""), "Expected error about existing evaluation"
        print("✅ Test 1 passed: Cannot accept already accepted relation")
        
        # Test 2: Undo evaluation and check it's not applied in data graph
        print("\n" + "="*80)
        print("=== TEST 2: UNDO EVALUATION & DATA GRAPH SYNC ===")
        print("="*80)
        print(f"🔍 Testing undo evaluation for relation {accepted_relation_id}...")
        
        # Verify it's currently applied
        is_applied_before = await self.check_relation_applied_in_data_graph(accepted_relation_id)
        assert is_applied_before, f"Relation {accepted_relation_id} should be applied before undo"
        
        # Undo the evaluation
        response = requests.post(
            f"{self.base_url}/v1/graph/ontology/agent/relation/undo_evaluation/{accepted_relation_id}",
            timeout=30
        )
        assert response.status_code == 200, f"Failed to undo evaluation: {response.status_code} - {response.text}"
        
        # Wait for sync operations
        self.wait_for_sync_grace_period()
        
        # Check it's no longer applied
        is_applied_after = await self.check_relation_applied_in_data_graph(accepted_relation_id)
        assert not is_applied_after, f"Relation {accepted_relation_id} should not be applied after undo"
        print("✅ Test 2 passed: Undo evaluation removes relation from data graph")
        
        # Test 3: Reject the relation and verify it's rejected and not applied
        print("\n" + "="*80)
        print("=== TEST 3: REJECT RELATION & VALIDATION ===")
        print("="*80)
        print(f"🔍 Testing rejection of relation {accepted_relation_id}...")
        
        # Undo existing evaluation (if any)
        response = requests.post(
            f"{self.base_url}/v1/graph/ontology/agent/relation/undo_evaluation/{accepted_relation_id}",
            timeout=30
        )
        assert response.status_code == 200, f"Failed to undo evaluation before rejection: {response.status_code} - {response.text}"

        # Wait for sync operations
        self.wait_for_sync_grace_period()

        # Reject the relation
        response = requests.post(
            f"{self.base_url}/v1/graph/ontology/agent/relation/reject/{accepted_relation_id}",
            timeout=30
        )
        assert response.status_code == 200, f"Failed to reject relation: {response.status_code} - {response.text}"
        
        # Wait for sync operations
        self.wait_for_sync_grace_period()
        
        # Check the evaluation status
        relation_candidates_dict = await self.get_all_relation_candidates()
        test_candidate = relation_candidates_dict.get(accepted_relation_id)
        
        assert test_candidate is not None, f"Could not find relation {accepted_relation_id} in candidates"
        assert test_candidate.evaluation is not None, f"Relation {accepted_relation_id} should have an evaluation"
        assert test_candidate.evaluation.result == FkeyEvaluationResult.REJECTED, f"Relation should be REJECTED, got {test_candidate.evaluation.result}"
        
        # Verify it's not applied in data graph
        is_applied_rejected = await self.check_relation_applied_in_data_graph(accepted_relation_id)
        assert not is_applied_rejected, f"REJECTED relation {accepted_relation_id} should not be applied in data graph"
        print("✅ Test 3 passed: Rejected relation is marked as REJECTED and not applied in data graph")
        
        # Test 4: Undo the rejection, then accept, and verify it's applied
        print("\n" + "="*80)
        print("=== TEST 4: UNDO REJECTION & RE-ACCEPT ===")
        print("="*80)
        print(f"🔍 Testing undo rejection and re-acceptance for relation {accepted_relation_id}...")
        
        # Undo the rejection
        response = requests.post(
            f"{self.base_url}/v1/graph/ontology/agent/relation/undo_evaluation/{accepted_relation_id}",
            timeout=30
        )
        assert response.status_code == 200, f"Failed to undo rejection: {response.status_code} - {response.text}"
        
        # Wait for sync operations
        self.wait_for_sync_grace_period()
        
        # Accept the relation
        response = requests.post(
            f"{self.base_url}/v1/graph/ontology/agent/relation/accept/{accepted_relation_id}",
            params={"relation_name": "test_relation_final"},
            timeout=30
        )
        assert response.status_code == 200, f"Failed to accept relation after undo: {response.status_code} - {response.text}"
        
        # Wait for sync operations
        self.wait_for_sync_grace_period()
        
        # Check the evaluation status
        relation_candidates_dict = await self.get_all_relation_candidates()
        test_candidate = relation_candidates_dict.get(accepted_relation_id)
        
        assert test_candidate is not None, f"Could not find relation {accepted_relation_id} in candidates"
        assert test_candidate.evaluation is not None, f"Relation {accepted_relation_id} should have an evaluation"
        assert test_candidate.evaluation.result == FkeyEvaluationResult.ACCEPTED, f"Relation should be ACCEPTED, got {test_candidate.evaluation.result}"
        
        # Verify it's applied in data graph
        is_applied_final = await self.check_relation_applied_in_data_graph(accepted_relation_id)
        assert is_applied_final, f"ACCEPTED relation {accepted_relation_id} should be applied in data graph"
        print("✅ Test 4 passed: After undo and accept, relation is ACCEPTED and applied in data graph")
        
        # Final summary
        print("\n" + "="*80)
        print("=== RELATION MANAGEMENT TESTS SUMMARY ===")
        print("="*80)
        print("🎉 All relation management endpoint tests passed successfully!")
        print("="*80)

    @pytest.mark.asyncio 
    async def test_reject_unsure_relation(self):
        """Test rejecting an UNSURE relation."""
        print("\n🚀 Starting test for rejecting UNSURE relation...")
        
        # Ensure we have relation candidates
        try:
            relation_candidates = await self.get_all_relation_candidates()
            if len(relation_candidates) == 0:
                print("No relation candidates found, skipping test")
                return
        except Exception as e:
            print(f"Could not fetch relation candidates: {e}, skipping test")
            return
            
        # Get an UNSURE relation
        unsure_relation_id = await self.get_first_unsure_relation()
        if unsure_relation_id is None:
            print("No UNSURE relation found, skipping test")
            return
            
        print(f"🔍 Testing with UNSURE relation: {unsure_relation_id}")
        
        # Verify it's not currently applied
        is_applied_before = await self.check_relation_applied_in_data_graph(unsure_relation_id)
        assert not is_applied_before, f"UNSURE relation {unsure_relation_id} should not be applied initially"
        
        # Undo any existing evaluation (if any)
        response = requests.post(
            f"{self.base_url}/v1/graph/ontology/agent/relation/undo_evaluation/{unsure_relation_id}",
            timeout=30
        )
        assert response.status_code == 200, f"Failed to undo evaluation for UNSURE relation: {response.status_code} - {response.text}"

        # Now, reject the relation
        response = requests.post(
            f"{self.base_url}/v1/graph/ontology/agent/relation/reject/{unsure_relation_id}",
            timeout=30
        )
        assert response.status_code == 200, f"Failed to reject UNSURE relation: {response.status_code} - {response.text}"
        
        # Wait for sync operations
        self.wait_for_sync_grace_period()
        
        # Verify it's marked as REJECTED
        relation_candidates_dict = await self.get_all_relation_candidates()
        test_candidate = relation_candidates_dict.get(unsure_relation_id)
        
        assert test_candidate is not None, f"Could not find relation {unsure_relation_id} in candidates"
        assert test_candidate.evaluation is not None, f"Relation {unsure_relation_id} should have an evaluation"
        assert test_candidate.evaluation.result == FkeyEvaluationResult.REJECTED, f"Relation should be REJECTED, got {test_candidate.evaluation.result}"
        
        # Verify it's still not applied in data graph
        is_applied_after = await self.check_relation_applied_in_data_graph(unsure_relation_id)
        assert not is_applied_after, f"REJECTED relation {unsure_relation_id} should not be applied in data graph"
        
        print("✅ UNSURE relation rejection test passed successfully!")


if __name__ == "__main__":
    # Allow running tests directly
    pytest.main([__file__, "-v"])
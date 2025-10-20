"""
Unit tests for RAG API endpoints.
"""
import datetime
from unittest.mock import AsyncMock, patch
from common.job_manager import JobInfo, JobStatus
from common.models.rag import DataSourceInfo
import uuid

class TestHealthCheck:
    """Test health check endpoint."""

    def test_health_check_success(self, test_client, mock_redis, mock_vector_db, mock_metadata_storage, mock_job_manager, mock_query_service):
        """Test successful health check."""

        with patch("server.restapi.vector_db", mock_vector_db):
            response = test_client.get("/healthz")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "healthy"
            assert "timestamp" in data


class TestDatasourceEndpoints:
    """Test datasource ingestion endpoints."""

    def test_ingest_url_success(self, test_client, mock_redis, mock_metadata_storage):
        """Test successful URL ingestion."""
        url_data = {
            "url": f"https://example-{uuid.uuid4()}.com",
        }

        mock_redis.get.return_value = None
        mock_metadata_storage.get_datasource_info.return_value = None

        response = test_client.post("/v1/datasource/ingest/url", json=url_data)

        assert response.status_code == 200
        data = response.json()
        assert "job_id" in data

    def test_get_ingestion_status_success(self, test_client, mock_job_manager):

        with patch('server.restapi.jobmanager', mock_job_manager):
            """Test successful job status retrieval."""
            mock_job_manager.get_job.return_value = JobInfo(
                job_id="test-job-id",
                status=JobStatus.IN_PROGRESS,
                message="Processing...",
                processed_counter=5,
                failed_counter=0,
                total=10,
                created_at=datetime.datetime.now(),
                completed_at=None,
                errors=[]
            )

            response = test_client.get("/v1/job/test-job-id")

            assert response.status_code == 200
            data = response.json()
            assert data["job_id"] == "test-job-id"
            assert data["status"] == "in_progress"

    def test_get_ingestion_status_not_found(self, test_client, mock_redis):
        """Test job status retrieval when job not found."""
        mock_redis.get.return_value = None

        response = test_client.get("/v1/datasource/ingest/status/nonexistent-job")

        assert response.status_code == 404

    def test_clear_all_datasources_specific_collection(self, test_client, mock_vector_db, mock_metadata_storage):

        """Test clearing all datasources from specific collection."""
        with patch('server.restapi.vector_db') as mock_vector_db:
            with patch('server.restapi.metadata_storage') as mock_metadata_storage:
                mock_metadata_storage.get_datasource_info = AsyncMock(return_value=DataSourceInfo(
                    datasource_id="test_collection",
                    description="test_collection",
                    source_type="web",
                    path="https://example.com",
                    default_chunk_size=1000,
                    default_chunk_overlap=200,
                    check_for_site_map=True,
                    sitemap_max_urls=2000,
                    created_at=datetime.datetime.now(),
                    last_updated=datetime.datetime.now(),
                    total_documents=0,
                    metadata={},
                    job_id="test_job_id",
                    total_chunks=0,
                ))
                mock_metadata_storage.delete_datasource_info = AsyncMock(return_value=None)
                mock_vector_db.adelete = AsyncMock(return_value=None)
                response = test_client.delete("/v1/datasource/delete?datasource_id=test_collection")
                print(f"Response: {response.json()}")

                assert response.status_code == 200
                mock_vector_db.adelete.assert_called()


class TestQueryEndpoints:
    """Test query endpoints."""

    def test_query_success(self, test_client, mock_vector_db, mock_query_service, sample_document):
        """Test successful document query."""
        mock_vector_db.asimilarity_search_with_score = AsyncMock(return_value=[
            (sample_document, 0.9)
        ])

        with patch('server.restapi.vector_db', mock_vector_db):
            with patch('server.restapi.vector_db_query_service', mock_query_service):
                query_data = {
                    "query": "test query",
                    "limit": 5,
                    "similarity_threshold": 0.8
                }

                response = test_client.post("/v1/query", json=query_data)

                assert response.status_code == 200
                data = response.json()
                assert len(data["results"]) == 1
                assert data["results"][0]["document"]["page_content"] == "This is a test document content."
"""
Unit tests for RAG API endpoints.
"""
import json
from unittest.mock import patch



class TestHealthCheck:
    """Test health check endpoint."""

    def test_health_check_success(self, test_client, mock_redis):
        """Test successful health check."""
        mock_redis.ping.return_value = True

        response = test_client.get("/healthz")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        assert data["redis_status"] == "connected"

    def test_health_check_redis_error(self, test_client, mock_redis):
        """Test health check with Redis error."""
        mock_redis.ping.side_effect = Exception("Redis connection failed")

        response = test_client.get("/healthz")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["redis_status"] == "error"


class TestConfigurationEndpoints:
    """Test configuration management endpoints."""

    def test_set_collection_config_success(self, test_client, mock_redis):
        """Test successful configuration creation."""
        config_data = {
            "collection_name": "test_collection",
            "url": "https://example.com",
            "chunk_size": 1000,
            "chunk_overlap": 200,
            "metadata": {"test": "data"}
        }

        response = test_client.post("/v1/config", json=config_data)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "Configuration saved successfully" in data["message"]
        assert data["config"]["collection_name"] == "test_collection"
        assert mock_redis.setex.call_count == 2  # Called for both collection and URL keys

    def test_set_collection_config_existing(self, test_client, mock_redis):
        """Test configuration update for existing collection."""
        # Mock existing config
        existing_config = {
            "collection_name": "test_collection",
            "url": "https://example.com",
            "chunk_size": 500,
            "chunk_overlap": 100,
            "created_at": "2024-01-01T00:00:00Z",
            "last_updated": "2024-01-01T00:00:00Z"
        }
        mock_redis.get.return_value = json.dumps(existing_config)

        config_data = {
            "collection_name": "test_collection",
            "url": "https://example.com",
            "chunk_size": 1000,
            "chunk_overlap": 200
        }

        response = test_client.post("/v1/config", json=config_data)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # Should preserve original created_at
        assert data["config"]["created_at"] == "2024-01-01T00:00:00Z"

    def test_get_collection_config_by_name_success(self, test_client, mock_redis):
        """Test successful config retrieval by collection name."""
        config_data = {
            "collection_name": "test_collection",
            "url": "https://example.com",
            "chunk_size": 1000,
            "chunk_overlap": 200,
            "created_at": "2024-01-01T00:00:00Z",
            "last_updated": "2024-01-01T00:00:00Z"
        }
        mock_redis.get.return_value = json.dumps(config_data)

        response = test_client.get("/v1/config/collection/test_collection")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["config"]["collection_name"] == "test_collection"

    def test_get_collection_config_by_name_not_found(self, test_client, mock_redis):
        """Test config retrieval when collection not found."""
        mock_redis.get.return_value = None

        response = test_client.get("/v1/config/collection/nonexistent")

        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"]

    def test_get_collection_config_by_url_success(self, test_client, mock_redis):
        """Test successful config retrieval by URL."""
        config_data = {
            "collection_name": "test_collection",
            "url": "https://example.com",
            "chunk_size": 1000,
            "chunk_overlap": 200,
            "created_at": "2024-01-01T00:00:00Z",
            "last_updated": "2024-01-01T00:00:00Z"
        }
        mock_redis.get.return_value = json.dumps(config_data)

        response = test_client.get("/v1/config/url?url=https://example.com")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["config"]["url"] == "https://example.com"

    def test_list_collections_success(self, test_client, mock_redis):
        """Test successful collection listing."""
        mock_redis.keys.return_value = [
            "config:collection:collection1",
            "config:collection:collection2"
        ]

        response = test_client.get("/v1/config/collections")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["collections"] == ["collection1", "collection2"]
        assert data["count"] == 2


class TestDatasourceEndpoints:
    """Test datasource ingestion endpoints."""

    def test_ingest_url_success(self, test_client, mock_redis, mock_loader):
        """Test successful URL ingestion."""
        url_data = {
            "url": "https://example.com",
            "collection_name": "test_collection"
        }

        response = test_client.post("/v1/datasource/ingest/url", json=url_data)

        assert response.status_code == 200
        data = response.json()
        assert "job_id" in data
        assert data["status"] == "pending"
        assert "Ingestion job started" in data["message"]

        # Verify job info was stored
        mock_redis.setex.assert_called()

    def test_ingest_url_without_collection(self, test_client, mock_redis, mock_loader):
        """Test URL ingestion without collection name."""
        url_data = {
            "url": "https://example.com"
        }

        response = test_client.post("/v1/datasource/ingest/url", json=url_data)

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "pending"

    def test_get_ingestion_status_success(self, test_client, mock_redis):
        """Test successful job status retrieval."""
        job_data = {
            "job_id": "test-job-id",
            "status": "in_progress",
            "progress": {"message": "Processing...", "processed": 5, "total": 10},
            "created_at": "2024-01-01T00:00:00Z",
            "completed_at": None,
            "error": None
        }
        mock_redis.get.return_value = json.dumps(job_data)

        response = test_client.get("/v1/datasource/ingest/status/test-job-id")

        assert response.status_code == 200
        data = response.json()
        assert data["job_id"] == "test-job-id"
        assert data["status"] == "in_progress"

    def test_get_ingestion_status_not_found(self, test_client, mock_redis):
        """Test job status retrieval when job not found."""
        mock_redis.get.return_value = None

        response = test_client.get("/v1/datasource/ingest/status/nonexistent-job")

        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"]

    def test_clear_all_datasources_default(self, test_client, mock_vector_db):
        """Test clearing all datasources from default collection."""
        with patch('server.rag_api.get_vector_db', return_value=mock_vector_db):
            response = test_client.post("/v1/datasource/clear_all")

            assert response.status_code == 200
            mock_vector_db.adelete.assert_called_with(expr="pk > 0")

    def test_clear_all_datasources_specific_collection(self, test_client, mock_vector_db):
        """Test clearing all datasources from specific collection."""
        with patch('server.rag_api.get_vector_db', return_value=mock_vector_db):
            response = test_client.post("/v1/datasource/clear_all?collection_name=test_collection")

            assert response.status_code == 200
            mock_vector_db.adelete.assert_called_with(expr="pk > 0")


class TestQueryEndpoints:
    """Test query endpoints."""

    def test_query_success(self, test_client, mock_vector_db, sample_document):
        """Test successful document query."""
        mock_vector_db.asimilarity_search.return_value = [sample_document]

        with patch('server.rag_api.get_vector_db', return_value=mock_vector_db):
            query_data = {
                "query": "test query",
                "limit": 5,
                "similarity_threshold": 0.8
            }

            response = test_client.post("/v1/query", json=query_data)

            assert response.status_code == 200
            data = response.json()
            assert data["query"] == "test query"
            assert len(data["results"]) == 1
            assert data["results"][0]["page_content"] == "This is a test document content."

    def test_query_with_collection_name(self, test_client, mock_vector_db):
        """Test query with specific collection name."""
        mock_vector_db.asimilarity_search.return_value = []

        with patch('server.rag_api.get_vector_db', return_value=mock_vector_db):
            query_data = {
                "query": "test query",
                "collection_name": "test_collection"
            }

            response = test_client.post("/v1/query", json=query_data)

            assert response.status_code == 200
            # Verify get_vector_db was called with correct collection name
            with patch('server.rag_api.get_vector_db') as mock_get_vdb:
                mock_get_vdb.return_value = mock_vector_db
                test_client.post("/v1/query", json=query_data)
                mock_get_vdb.assert_called_with("test_collection")

    def test_query_default_parameters(self, test_client, mock_vector_db):
        """Test query with default parameters."""
        mock_vector_db.asimilarity_search.return_value = []

        with patch('server.rag_api.get_vector_db', return_value=mock_vector_db):
            query_data = {"query": "test query"}

            response = test_client.post("/v1/query", json=query_data)

            assert response.status_code == 200
            mock_vector_db.asimilarity_search.assert_called_with(
                "test query",
                k=3,  # default limit
                score_threshold=0.7  # default threshold
            )


class TestDebugEndpoints:
    """Test debug endpoints."""

    def test_debug_redis_keys(self, test_client, mock_redis):
        """Test debug Redis keys endpoint."""
        mock_redis.keys.side_effect = [
            ["config:collection:test1", "config:collection:test2"],
            ["job:job1", "job:job2"]
        ]

        response = test_client.get("/v1/debug/redis-keys")

        assert response.status_code == 200
        data = response.json()
        assert "config_keys" in data
        assert "job_keys" in data
        assert data["total_keys"] == 4

    def test_debug_test_config(self, test_client, mock_redis):
        """Test debug test config endpoint."""
        response = test_client.post("/v1/debug/test-config?url=https://example.com")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "Test configuration saved" in data["message"]
        assert data["config"]["collection_name"] == "debug-test"
        assert data["config"]["url"] == "https://example.com"

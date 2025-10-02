# RAG Server Test Suite Documentation

This document provides a comprehensive overview of the test suite for the RAG (Retrieval-Augmented Generation) server. The tests are designed to ensure the correctness, reliability, and performance of the API endpoints, data loaders, and ingestion pipeline.

## Overview of Testing Strategy

The test suite is organized into several categories:

1.  **Unit Tests**: Focused on individual components in isolation, such as the `Loader` class (`test_loader.py`) and web scrapers (`test_scrapers.py`).
2.  **Integration Tests**: Verify the interaction between different components, primarily through API endpoint testing (`test_rag_api.py`).
3.  **Scale and Memory Tests**: Specialized tests (`test_scale_ingestion.py`) designed to assess the performance and memory efficiency of the data ingestion pipeline under heavy load.

## Test Suite Structure

The `tests/` directory contains the following key files:

-   `conftest.py`
    -   The central configuration file for `pytest`.
    -   Defines shared fixtures used across multiple test files, such as `test_client`, `mock_redis`, `mock_vector_storage`, and `mock_metadata_storage`. It is responsible for mocking external services and dependencies to create a controlled test environment.

-   `test_rag_api.py`
    -   Contains integration tests for the FastAPI endpoints.
    -   It tests API routes like `/healthz`, `/v1/datasource/ingest/url`, and `/v1/query` to ensure they behave as expected, handle valid and invalid inputs correctly, and interact properly with mocked backend services.

-   `test_loader.py`
    -   Contains unit tests for the `Loader` class, which is responsible for fetching, parsing, and processing documents.
    -   These tests verify the logic for sitemap discovery, document parsing, and chunking in isolation.

-   `test_scale_ingestion.py`
    -   Contains performance and memory-efficiency tests for the data ingestion pipeline.
    -   It includes tests marked with `@pytest.mark.scale` and `@pytest.mark.memory`.
    -   A key test, `test_scale_ingestion_ruff_docs`, ingests the entire documentation site for **Ruff** (`https://docs.astral.sh/ruff/`) from its sitemap to provide a real-world benchmark for memory usage and processing time.

-   `test_scrapers.py`
    -   Unit tests for the various web scraping utilities used by the `Loader`.

-   `platform_docs_memory_optimization.py` & `run_memory_test.py`
    -   Older, more specific memory tests focused on the Material for MkDocs documentation. These can be used for historical reference or specific regression testing.

-   `requirements.txt`
    -   Contains Python dependencies required to run the test suite, such as `pytest`, `psutil`, and `pytest-asyncio`.

## Running the Tests

### 1. Installation

First, install the required dependencies from within your virtual environment:

```bash
pip install -r server/tests/requirements.txt
```

### 2. Running All Tests

To run the entire test suite (excluding scale tests, which must be run explicitly), navigate to the project root and run `pytest`:

```bash
pytest server/tests/
```

### 3. Running Specific Tests

You can run specific categories of tests or individual files.

-   **Run only the API tests:**
    ```bash
    pytest server/tests/test_rag_api.py
    ```

-   **Run the Scale and Memory Tests:**
    The scale tests are marked and can be run using the `-m` flag. These tests may take several minutes and will make live network requests.
    ```bash
    pytest -m scale -sv
    ```
    *   `-m scale`: Runs only tests marked with `@pytest.mark.scale`.
    *   `-s`: Shows `print` statements in the output.
    *   `-v`: Enables verbose mode.

## Key Fixtures (`conftest.py`)

-   `test_client`: An instance of `TestClient` for making HTTP requests to the FastAPI application in a test context.
-   `mock_redis`: A mocked `redis.asyncio.Redis` client to simulate Redis interactions without a live connection.
-   `mock_vector_storage`, `mock_metadata_storage`, `mock_job_manager`: Mocked instances of the core service classes, allowing tests to assert how they are called without relying on real backend infrastructure.

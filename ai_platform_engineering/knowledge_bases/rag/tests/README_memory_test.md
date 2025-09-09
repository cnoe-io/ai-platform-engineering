# Memory Optimization Test for Material for MkDocs Documentation

This test suite validates the memory-optimized URL loading functionality using the Material for MkDocs documentation as a real-world example.

## Overview

The test demonstrates how the improved `Loader` class processes URLs from `https://squidfunk.github.io/mkdocs-material/` without loading all documents into memory at once, preventing out-of-memory (OOM) issues.

## Key Features Tested

1. **Sitemap Discovery**: Tests the ability to find and parse sitemaps from the Material for MkDocs documentation site
2. **Memory-Efficient Processing**: Validates that URLs are processed individually rather than in bulk
3. **Batch Processing**: Tests different batch sizes to demonstrate memory control
4. **Memory Monitoring**: Tracks memory usage throughout the process
5. **Error Handling**: Ensures robust processing even with network issues

## Test Components

### `test_memory_optimization.py`
The main test file containing:
- `MockVectorStore`: Simulates a vector store for testing
- `TestProgressTracker`: Tracks memory usage and timing
- `test_outshift_platform_docs()`: Main test function
- `test_sitemap_discovery()`: Tests sitemap functionality
- `test_memory_efficiency()`: Compares memory usage patterns

### `run_memory_test.py`
Simple script to execute the test with proper error handling.

## Running the Test

### Option 1: Direct execution
```bash
cd ai_platform_engineering/knowledge_bases/rag/tests/
python test_memory_optimization.py
```

### Option 2: Using the runner script
```bash
cd ai_platform_engineering/knowledge_bases/rag/tests/
python run_memory_test.py
```

### Option 3: From project root
```bash
python -m ai_platform_engineering.knowledge_bases.rag.tests.test_memory_optimization
```

## Expected Output

The test will show:
- 🔍 Sitemap discovery results
- 📊 Memory usage statistics for different batch sizes
- 📄 Document processing details
- 💾 Memory monitoring throughout the process
- ✅ Success/failure status for each test phase

## Memory Optimization Improvements

The test validates these key improvements:

1. **Individual URL Processing**: Instead of loading all URLs at once with `WebBaseLoader(urls)`, each URL is processed individually
2. **Configurable Batch Sizes**: Memory usage can be controlled by adjusting batch size (default: 10)
3. **Memory Monitoring**: Real-time tracking of RSS, VMS, and percentage memory usage
4. **Garbage Collection**: Forced cleanup after each batch to free memory
5. **Progress Tracking**: Detailed logging of processing progress and memory usage

## Dependencies

The test requires:
- `psutil` for memory monitoring
- `aiohttp` for HTTP requests
- `beautifulsoup4` for HTML parsing
- `langchain` components for document processing

## Troubleshooting

If the test fails:
1. Check network connectivity to `https://squidfunk.github.io/mkdocs-material/`
2. Ensure all dependencies are installed
3. Verify the import paths are correct for your environment
4. Check that the `Loader` class is properly updated with memory optimizations

## Performance Notes

- The test processes URLs in small batches to demonstrate memory efficiency
- Memory usage is logged before and after each batch
- The test includes a limited subset of URLs for faster execution
- Real-world usage would process all URLs from the sitemap

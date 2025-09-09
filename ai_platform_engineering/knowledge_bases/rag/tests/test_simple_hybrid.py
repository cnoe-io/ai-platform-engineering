#!/usr/bin/env python3
"""
Simple integration tests for hybrid loader functionality.
"""
import asyncio
import os
import sys
import logging
import pytest

# Add the parent directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from server.loader.loader import Loader

class MockVectorStore:
    """Mock vector store for testing."""
    def __init__(self):
        self.documents_added = 0
        self.documents = []

    async def aadd_documents(self, documents):
        self.documents_added += len(documents)
        self.documents.extend(documents)
        print(f'📄 Added {len(documents)} documents (total: {self.documents_added})')
        return [f'doc_id_{i}' for i in range(len(documents))]

@pytest.mark.asyncio
async def test_generator_detection():
    """Test generator detection with real websites."""
    print("🔍 Testing Generator Detection")
    print("=" * 40)

    logger = logging.getLogger(__name__)
    mock_vstore = MockVectorStore()
    loader = Loader(vstore=mock_vstore, logger=logger)

    try:
        test_cases = [
            {
                "name": "Docusaurus (CAIPE)",
                "url": "https://cnoe-io.github.io/ai-platform-engineering/",
                "expected": "docusaurus"
            },
            {
                "name": "MkDocs (A2A Protocol)",
                "url": "https://a2a-protocol.org/latest/",
                "expected": "mkdocs"
            },
            {
                "name": "Generic (Wikipedia Mars)",
                "url": "https://en.wikipedia.org/wiki/Mars",
                "expected": "generic"
            }
        ]

        for test_case in test_cases:
            print(f"\n🔍 Testing: {test_case['name']}")
            print(f"URL: {test_case['url']}")

            try:
                generator = await loader.detect_generator(test_case['url'])
                print(f"   Detected: {generator}")

                if generator == test_case['expected']:
                    print(f"   ✅ Correct detection")
                else:
                    print(f"   ❌ Expected: {test_case['expected']}, Got: {generator}")

            except Exception as e:
                print(f"   ❌ Error: {str(e)}")
    finally:
        await loader.cleanup()

@pytest.mark.asyncio
async def test_parser_selection():
    """Test parser selection logic."""
    print("\n🎯 Testing Parser Selection Logic")
    print("=" * 40)

    logger = logging.getLogger(__name__)
    mock_vstore = MockVectorStore()
    loader = Loader(vstore=mock_vstore, logger=logger)

    # Test hybrid approach
    loader.use_hybrid_approach = True

    test_cases = [
        ("docusaurus", True, "Custom Parser"),
        ("mkdocs", True, "Custom Parser"),
        ("generic", False, "WebBaseLoader"),
        ("gatsby", False, "WebBaseLoader"),
        ("nextjs", False, "WebBaseLoader")
    ]

    for generator, expected_custom, expected_parser in test_cases:
        use_custom = loader.should_use_custom_parser(generator)
        parser_type = "Custom Parser" if use_custom else "WebBaseLoader"

        print(f"   {generator:12} -> {parser_type:15} ({'✅' if use_custom == expected_custom else '❌'})")

@pytest.mark.asyncio
async def test_hybrid_vs_webloader():
    """Test hybrid approach vs pure WebBaseLoader."""
    print("\n🔄 Testing Hybrid vs WebBaseLoader Performance")
    print("=" * 50)

    test_url = "https://cnoe-io.github.io/ai-platform-engineering/"

    # Test Hybrid Approach
    print("\n1️⃣ Testing Hybrid Approach")
    logger = logging.getLogger(__name__)
    mock_vstore_hybrid = MockVectorStore()
    loader_hybrid = Loader(vstore=mock_vstore_hybrid, logger=logger)
    loader_hybrid.use_hybrid_approach = True

    try:
        start_time = asyncio.get_event_loop().time()
        await loader_hybrid.load_url(test_url, None)  # No job_id to avoid Redis warnings
        hybrid_time = asyncio.get_event_loop().time() - start_time
        print(f"   ✅ Hybrid approach completed in {hybrid_time:.2f}s")
        print(f"   Documents processed: {mock_vstore_hybrid.documents_added}")
    except Exception as e:
        print(f"   ❌ Hybrid approach failed: {str(e)}")
        hybrid_time = 0
    finally:
        await loader_hybrid.cleanup()

    # Test WebBaseLoader Only
    print("\n2️⃣ Testing WebBaseLoader Only")
    mock_vstore_webloader = MockVectorStore()
    loader_webloader = Loader(vstore=mock_vstore_webloader, logger=logger)
    loader_webloader.use_hybrid_approach = False
    loader_webloader.use_custom_parser = False

    try:
        start_time = asyncio.get_event_loop().time()
        await loader_webloader.load_url(test_url, None)  # No job_id to avoid Redis warnings
        webloader_time = asyncio.get_event_loop().time() - start_time
        print(f"   ✅ WebBaseLoader approach completed in {webloader_time:.2f}s")
        print(f"   Documents processed: {mock_vstore_webloader.documents_added}")
    except Exception as e:
        print(f"   ❌ WebBaseLoader approach failed: {str(e)}")
        webloader_time = 0
    finally:
        await loader_webloader.cleanup()

    # Compare results
    print(f"\n📈 Performance Comparison:")
    if hybrid_time > 0 and webloader_time > 0:
        speed_improvement = ((webloader_time - hybrid_time) / webloader_time) * 100
        print(f"   Speed improvement: {speed_improvement:.1f}%")

    print(f"   Hybrid documents: {mock_vstore_hybrid.documents_added}")
    print(f"   WebBaseLoader documents: {mock_vstore_webloader.documents_added}")

async def main():
    """Run all tests."""
    print("🚀 Hybrid Loader Test Suite")
    print("=" * 50)

    try:
        # Test generator detection
        await test_generator_detection()

        # Test parser selection
        await test_parser_selection()

        # Test performance comparison
        await test_hybrid_vs_webloader()

        print("\n🎉 All tests completed!")
    finally:
        # Clean up any remaining sessions
        print("\n🧹 Cleaning up resources...")

if __name__ == "__main__":
    asyncio.run(main())

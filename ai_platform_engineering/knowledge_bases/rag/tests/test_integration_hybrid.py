import asyncio
import os
import logging
import sys
import pytest

# Add the parent directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from server.loader.loader import Loader

class MockVectorStore:
    """Mock vector store for integration testing."""
    def __init__(self):
        self.documents_added = 0
        self.documents = []

    async def aadd_documents(self, documents):
        self.documents_added += len(documents)
        self.documents.extend(documents)
        print(f'📄 Added {len(documents)} documents (total: {self.documents_added})')
        for doc in documents:
            print(f'   Source: {doc.metadata.get("source", "unknown")}')
            print(f'   Title: {doc.metadata.get("title", "No title")}')
            print(f'   Content length: {len(doc.page_content)} characters')
            print(f'   Content preview: {doc.page_content[:200]}...')
            print('---')
        return [f'doc_id_{i}' for i in range(len(documents))]

@pytest.mark.asyncio
async def test_hybrid_loader_integration():
    """Integration test for hybrid loader with real websites."""
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)

    mock_vstore = MockVectorStore()
    loader = Loader(vstore=mock_vstore, logger=logger)

    # Test URLs
    test_cases = [
        {
            "name": "MkDocs (Material for MkDocs)",
            "url": "https://squidfunk.github.io/mkdocs-material/",
            "expected_generator": "mkdocs",
            "expected_parser": "custom"
        },
        {
            "name": "MkDocs (A2A Protocol)",
            "url": "https://a2a-protocol.org/latest/",
            "expected_generator": "mkdocs",
            "expected_parser": "custom"
        },
        {
            "name": "Generic (Wikipedia Mars)",
            "url": "https://en.wikipedia.org/wiki/Mars",
            "expected_generator": "generic",
            "expected_parser": "webloader"
        }
    ]

    print("🧪 Testing Hybrid Loader Integration")
    print("=" * 50)

    for test_case in test_cases:
        print(f"\n🔍 Testing: {test_case['name']}")
        print(f"URL: {test_case['url']}")

        try:
            # Test generator detection
            print("   Detecting generator...")
            generator = await loader.detect_generator(test_case['url'])
            print(f"   Detected generator: {generator}")

            # Verify generator detection
            if generator == test_case['expected_generator']:
                print("   ✅ Generator detection correct")
            else:
                print(f"   ❌ Generator detection incorrect. Expected: {test_case['expected_generator']}, Got: {generator}")

            # Test parser selection
            should_use_custom = loader.should_use_custom_parser(generator)
            parser_type = "custom" if should_use_custom else "webloader"
            print(f"   Parser type: {parser_type}")

            if parser_type == test_case['expected_parser']:
                print("   ✅ Parser selection correct")
            else:
                print(f"   ❌ Parser selection incorrect. Expected: {test_case['expected_parser']}, Got: {parser_type}")

            # Test actual loading (single URL)
            print("   Testing single URL loading...")
            try:
                await loader.load_url(test_case['url'], f"test_job_{test_case['name'].lower().replace(' ', '_')}")
                print("   ✅ Single URL loading successful")
            except Exception as e:
                print(f"   ❌ Single URL loading failed: {str(e)}")

        except Exception as e:
            print(f"   ❌ Test failed: {str(e)}")

        print("-" * 30)

    print("\n📊 Final Results:")
    print(f"Total documents processed: {mock_vstore.documents_added}")
    print("Documents by source:")
    for doc in mock_vstore.documents:
        source = doc.metadata.get("source", "unknown")
        title = doc.metadata.get("title", "No title")
        print(f"  - {source}: {title}")

@pytest.mark.asyncio
async def test_hybrid_vs_webloader_comparison():
    """Compare hybrid approach vs pure WebBaseLoader approach."""
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)

    test_url = "https://squidfunk.github.io/mkdocs-material/"

    print("\n🔄 Comparing Hybrid vs WebBaseLoader Approaches")
    print("=" * 60)

    # Test Hybrid Approach
    print("\n1️⃣ Testing Hybrid Approach")
    mock_vstore_hybrid = MockVectorStore()
    loader_hybrid = Loader(vstore=mock_vstore_hybrid, logger=logger)
    loader_hybrid.use_hybrid_approach = True

    try:
        start_time = asyncio.get_event_loop().time()
        await loader_hybrid.load_url(test_url, "hybrid_test")
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
        await loader_webloader.load_url(test_url, "webloader_test")
        webloader_time = asyncio.get_event_loop().time() - start_time
        print(f"   ✅ WebBaseLoader approach completed in {webloader_time:.2f}s")
        print(f"   Documents processed: {mock_vstore_webloader.documents_added}")
    except Exception as e:
        print(f"   ❌ WebBaseLoader approach failed: {str(e)}")
        webloader_time = 0
    finally:
        await loader_webloader.cleanup()

    # Compare results
    print("\n📈 Comparison Results:")
    if hybrid_time > 0 and webloader_time > 0:
        speed_improvement = ((webloader_time - hybrid_time) / webloader_time) * 100
        print(f"   Speed improvement: {speed_improvement:.1f}%")

    print(f"   Hybrid documents: {mock_vstore_hybrid.documents_added}")
    print(f"   WebBaseLoader documents: {mock_vstore_webloader.documents_added}")

if __name__ == "__main__":
    # Run integration tests
    asyncio.run(test_hybrid_loader_integration())
    asyncio.run(test_hybrid_vs_webloader_comparison())

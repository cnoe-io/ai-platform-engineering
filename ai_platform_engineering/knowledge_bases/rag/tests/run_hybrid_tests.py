#!/usr/bin/env python3
"""
Test runner for hybrid loader tests.
"""
import asyncio
import sys
import os

# Add the parent directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

async def run_unit_tests():
    """Run unit tests."""
    print("🧪 Running Unit Tests")
    print("=" * 40)

    try:
        import pytest
        # Run pytest on the test file
        result = pytest.main(["-v", "test_hybrid_loader.py"])
        if result == 0:
            print("✅ All unit tests passed!")
        else:
            print("❌ Some unit tests failed!")
        return result == 0
    except ImportError:
        print("❌ pytest not available. Install with: pip install pytest")
        return False

async def run_integration_tests():
    """Run integration tests."""
    print("\n🔗 Running Integration Tests")
    print("=" * 40)

    try:
        from test_integration_hybrid import test_hybrid_loader_integration, test_hybrid_vs_webloader_comparison

        await test_hybrid_loader_integration()
        await test_hybrid_vs_webloader_comparison()

        print("\n✅ Integration tests completed!")
        return True
    except Exception as e:
        print(f"\n❌ Integration tests failed: {str(e)}")
        return False

async def main():
    """Main test runner."""
    print("🚀 Hybrid Loader Test Suite")
    print("=" * 50)

    # Run unit tests
    unit_success = await run_unit_tests()

    # Run integration tests
    integration_success = await run_integration_tests()

    # Summary
    print("\n📊 Test Summary")
    print("=" * 20)
    print(f"Unit Tests: {'✅ PASSED' if unit_success else '❌ FAILED'}")
    print(f"Integration Tests: {'✅ PASSED' if integration_success else '❌ FAILED'}")

    if unit_success and integration_success:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print("\n💥 Some tests failed!")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)


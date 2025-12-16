#!/usr/bin/env python3
"""
Test LangMem Integration

Quick test to verify LangMem is working correctly.

Usage:
    # From project root with venv activated:
    python integration/test_langmem.py

    # Or with specific model:
    LLM_PROVIDER=azure-openai python integration/test_langmem.py
"""

import asyncio
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def test_langmem():
    """Test LangMem availability and summarization."""
    print("=" * 60)
    print("LangMem Integration Test")
    print("=" * 60)

    # Test 1: Check availability
    print("\n📋 Test 1: Check LangMem availability")
    try:
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            get_langmem_status,
            summarize_messages,
            verify_langmem_on_startup,
        )

        status = get_langmem_status()
        print(f"   Available: {status['available']}")
        print(f"   Verified: {status['verified']}")
        print(f"   Skip verification env: {status['env_skip_verification']}")

        if not status['available']:
            print("\n❌ LangMem is NOT available!")
            print("   Install with: pip install langmem")
            return False

        print("   ✅ LangMem is available")

    except ImportError as e:
        print(f"\n❌ Failed to import langmem_utils: {e}")
        return False

    # Test 2: Get model from LLMFactory
    print("\n📋 Test 2: Initialize LLM via LLMFactory")
    try:
        from cnoe_agent_utils import LLMFactory

        model = LLMFactory().get_llm()
        print(f"   Model type: {type(model).__name__}")
        print(f"   LLM_PROVIDER: {os.getenv('LLM_PROVIDER', 'not set')}")
        print("   ✅ LLM initialized")

    except Exception as e:
        print(f"\n❌ Failed to initialize LLM: {e}")
        print("   Make sure LLM_PROVIDER and related env vars are set")
        return False

    # Test 3: Verify LangMem with test summarization
    print("\n📋 Test 3: Verify LangMem with test summarization")
    try:
        success = await verify_langmem_on_startup(model=model, agent_name="test")

        if success:
            print("   ✅ LangMem verification passed!")
        else:
            print("   ⚠️ LangMem verification failed (will use fallback)")

    except Exception as e:
        print(f"\n❌ Verification failed with error: {e}")
        return False

    # Test 4: Test actual summarization
    print("\n📋 Test 4: Test message summarization")
    try:
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

        # Create test messages
        test_messages = [
            SystemMessage(content="You are a helpful assistant for platform engineering."),
            HumanMessage(content="What are the open PRs in the ai-platform-engineering repo?"),
            AIMessage(content="I found 5 open PRs: PR #545 for prompt optimization, PR #540 for streaming fixes..."),
            HumanMessage(content="Tell me more about PR #545"),
            AIMessage(content="PR #545 is about prompt optimization and adds SOPs for GitHub issues formatting..."),
            HumanMessage(content="Can you also check Jira for related tickets?"),
            AIMessage(content="I found 3 related Jira tickets: CAIPE-123, CAIPE-124, CAIPE-125..."),
        ]

        print(f"   Input: {len(test_messages)} messages")

        result = await summarize_messages(
            messages=test_messages,
            model=model,
            agent_name="test",
        )

        print(f"   Success: {result.success}")
        print(f"   Used LangMem: {result.used_langmem}")
        print(f"   Tokens before: {result.tokens_before:,}")
        print(f"   Tokens after: {result.tokens_after:,}")
        print(f"   Tokens saved: {result.tokens_saved:,}")
        print(f"   Compression ratio: {result.compression_ratio:.1%}")
        print(f"   Duration: {result.duration_ms:.0f}ms")

        if result.summary_message:
            summary_preview = result.summary_message.content[:200] + "..." if len(result.summary_message.content) > 200 else result.summary_message.content
            print(f"\n   Summary preview:\n   {summary_preview}")

        if result.success:
            print("\n   ✅ Summarization test passed!")
        else:
            print(f"\n   ❌ Summarization failed: {result.error}")
            return False

    except Exception as e:
        print(f"\n❌ Summarization test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Final status
    print("\n" + "=" * 60)
    final_status = get_langmem_status()
    if final_status['available'] and final_status['verified']:
        print("✅ ALL TESTS PASSED - LangMem is working correctly!")
        print("=" * 60)
        return True
    else:
        print("⚠️ TESTS COMPLETED WITH WARNINGS")
        print(f"   Available: {final_status['available']}")
        print(f"   Verified: {final_status['verified']}")
        print("=" * 60)
        return False


if __name__ == "__main__":
    success = asyncio.run(test_langmem())
    sys.exit(0 if success else 1)





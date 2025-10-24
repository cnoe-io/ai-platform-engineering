#!/usr/bin/env python3
"""
Test RAG agent token-by-token streaming.

This test verifies that the RAG agent streams tokens in real-time
rather than sending one large chunk at the end.

Usage:
    python integration/test_rag_streaming.py
"""

import asyncio
import httpx
from a2a.client import A2AClient
from a2a.types import SendStreamingMessageRequest, MessageSendParams


async def test_rag_streaming():
    """Test RAG agent's token-by-token streaming."""

    # RAG agent URL (adjust if needed)
    rag_agent_url = "http://localhost:8099"

    print(f"🔍 Testing RAG streaming at {rag_agent_url}")

    # Create A2A client
    async with httpx.AsyncClient(timeout=60.0) as http_client:
        # Fetch agent card
        agent_card_response = await http_client.get(f"{rag_agent_url}/.well-known/agent.json")
        if agent_card_response.status_code != 200:
            print(f"❌ Failed to fetch agent card: {agent_card_response.status_code}")
            return

        agent_card = agent_card_response.json()
        print("✅ Fetched RAG agent card")

        # Create streaming request
        streaming_request = SendStreamingMessageRequest(
            params=MessageSendParams(
                query="What is duo-sso CLI and how do I use it?",
                context_id="test-rag-streaming"
            )
        )

        # Initialize A2A client
        client = A2AClient(agent_card=agent_card, httpx_client=http_client)

        print("\n📝 Sending streaming query to RAG agent...")
        print("Query: 'What is duo-sso CLI and how do I use it?'\n")

        token_count = 0
        chunk_count = 0
        start_time = asyncio.get_event_loop().time()

        try:
            async for response_wrapper in client.send_message_streaming(streaming_request):
                chunk_count += 1

                # Extract event from wrapper
                response_dict = response_wrapper.model_dump()
                result_data = response_dict.get('result', {})
                event_kind = result_data.get('kind', '')

                # Track artifact updates (token chunks)
                if event_kind == 'artifact-update':
                    artifact_data = result_data.get('artifact', {})
                    parts_data = artifact_data.get('parts', [])

                    for part in parts_data:
                        if isinstance(part, dict):
                            text_content = part.get('text', '')
                            if text_content:
                                token_count += len(text_content)
                                print(text_content, end='', flush=True)

                # Track status updates (may also contain content)
                elif event_kind == 'status-update':
                    status_data = result_data.get('status', {})
                    message_data = status_data.get('message')

                    if message_data:
                        parts_data = message_data.get('parts', [])
                        for part in parts_data:
                            if isinstance(part, dict):
                                text_content = part.get('text', '')
                                if text_content and not text_content.startswith(('🔧', '✅', '❌', '🔍')):
                                    token_count += len(text_content)
                                    print(text_content, end='', flush=True)

                    state = status_data.get('state', '')
                    if state == 'completed':
                        break

        except Exception as e:
            print(f"\n❌ Error during streaming: {e}")
            import traceback
            traceback.print_exc()
            return

        end_time = asyncio.get_event_loop().time()
        duration = end_time - start_time

        print("\n\n✅ Streaming test completed!")
        print(f"   Total chunks: {chunk_count}")
        print(f"   Total characters: {token_count}")
        print(f"   Duration: {duration:.2f}s")

        if chunk_count > 10:
            print(f"   ✅ Token streaming verified (received {chunk_count} chunks)")
        else:
            print(f"   ⚠️  Only {chunk_count} chunks received - may not be token-level streaming")


if __name__ == "__main__":
    asyncio.run(test_rag_streaming())

